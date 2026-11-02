import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { run } from "../exec.js";
import { dataDir, rulesDir, safeJoin } from "../paths.js";
import { parseGitleaks, parseOsv, parseSemgrep } from "./normalize.js";
import type { RawFinding, ScannerRun, Tool } from "./types.js";

function fileReader(root: string) {
  return (rel: string) => {
    const full = safeJoin(root, rel);
    if (!full) return null;
    try {
      return fs.readFileSync(full, "utf8");
    } catch {
      return null;
    }
  };
}

export interface SemgrepMatch {
  ruleId: string;
  path: string;
  line: number;
  startOffset: number;
  endOffset: number;
  fix: string | null;
  fixSummary: string | null;
}

/** Raw semgrep JSON for a directory (optionally limited to some files). */
export async function semgrepJson(root: string, files?: string[]) {
  const args = [
    "scan",
    "--metrics=off",
    "--disable-version-check",
    "--json",
    "--quiet",
    "--timeout",
    "30",
    "--config",
    rulesDir(),
    "--exclude",
    "node_modules",
    "--exclude",
    ".repo-medic",
  ];
  args.push(...(files && files.length ? files : ["."]));
  const r = await run("semgrep", args, { cwd: root, timeoutMs: 180_000 });
  let json: any = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    throw new Error(
      `semgrep failed (exit ${r.code}${r.timedOut ? ", timed out" : ""}): ${r.stderr.trim().slice(0, 400) || "no output"}`,
    );
  }
  return json as { results?: any[]; errors?: any[] };
}

export function semgrepMatches(json: { results?: any[] }): SemgrepMatch[] {
  return (json.results ?? []).map((r) => ({
    ruleId: r.check_id.slice(Math.max(0, r.check_id.indexOf("rm."))),
    path: r.path,
    line: r.start.line,
    startOffset: r.start.offset,
    endOffset: r.end.offset,
    fix: typeof r.extra?.fix === "string" ? r.extra.fix : null,
    fixSummary: typeof r.extra?.metadata?.fix_summary === "string" ? r.extra.metadata.fix_summary : null,
  }));
}

export async function runSemgrep(root: string, files?: string[]): Promise<RawFinding[]> {
  return parseSemgrep(await semgrepJson(root, files) as any, fileReader(root));
}

export async function runGitleaks(root: string): Promise<RawFinding[]> {
  const report = path.join(dataDir("reports"), `gitleaks-${randomUUID()}.json`);
  try {
    const r = await run(
      "gitleaks",
      [
        "dir",
        ".",
        "--config",
        path.resolve(rulesDir(), "..", "gitleaks.toml"),
        "--report-format",
        "json",
        "--report-path",
        report,
        "--no-banner",
        "--exit-code",
        "0",
        "--log-level",
        "error",
      ],
      { cwd: root, timeoutMs: 120_000 },
    );
    if (r.code !== 0) throw new Error(`gitleaks failed (exit ${r.code}): ${r.stderr.trim().slice(0, 400)}`);
    return parseGitleaks(JSON.parse(fs.readFileSync(report, "utf8") || "[]"));
  } finally {
    fs.rmSync(report, { force: true });
  }
}

export async function runOsv(root: string): Promise<RawFinding[]> {
  const r = await run(
    "osv-scanner",
    ["scan", "source", "--recursive", "--format", "json", "."],
    { cwd: root, timeoutMs: 180_000 },
  );
  // Exit 0 = clean, 1 = vulnerabilities found, 128 = no lockfiles to scan.
  if (r.code === 128) return [];
  if (r.code !== 0 && r.code !== 1) {
    throw new Error(`osv-scanner failed (exit ${r.code}): ${r.stderr.trim().slice(0, 400)}`);
  }
  const json = JSON.parse(r.stdout || "{}");
  // osv-scanner reports absolute lockfile paths; make them repo-relative.
  return parseOsv(json, fs.realpathSync(root)).map((f) => ({
    ...f,
    filePath: f.filePath.replace(/^\.\//, ""),
  }));
}

const RUNNERS: Record<Tool, (root: string) => Promise<RawFinding[]>> = {
  semgrep: (root) => runSemgrep(root),
  gitleaks: runGitleaks,
  "osv-scanner": runOsv,
};

/** Run the selected scanners in parallel. A failing scanner never hides the others' results. */
export async function runScanners(
  root: string,
  tools: Tool[] = ["semgrep", "gitleaks", "osv-scanner"],
): Promise<ScannerRun[]> {
  return Promise.all(
    tools.map(async (tool) => {
      const started = Date.now();
      try {
        const findings = await RUNNERS[tool](root);
        return { tool, ok: true, findings, durationMs: Date.now() - started };
      } catch (err) {
        return {
          tool,
          ok: false,
          findings: [],
          durationMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}
