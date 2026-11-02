import fs from "node:fs";
import path from "node:path";

import { run } from "./exec.js";
import { withWorktree, worktreeDiff } from "./git.js";
import { safeJoin } from "./paths.js";
import { compareVersions } from "./scanners/normalize.js";
import { semgrepJson, semgrepMatches, type SemgrepMatch } from "./scanners/run.js";

export class NoAutofixError extends Error {}

export interface AutofixFinding {
  tool: string;
  ruleId: string;
  filePath: string;
  startLine: number | null;
  packageName: string | null;
  fixedVersion: string | null;
}

export interface GeneratedFix {
  diff: string;
  summary: string;
}

/** Apply byte-offset replacements right-to-left so earlier offsets stay valid. */
export function applyReplacements(
  source: string,
  edits: Array<{ start: number; end: number; text: string }>,
): string {
  let buf = Buffer.from(source, "utf8");
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    buf = Buffer.concat([buf.subarray(0, e.start), Buffer.from(e.text, "utf8"), buf.subarray(e.end)]);
  }
  return buf.toString("utf8");
}

/** Pick the matches that belong to this finding (same rule/file, nearest line). */
export function matchesForFinding(matches: SemgrepMatch[], f: AutofixFinding): SemgrepMatch[] {
  const same = matches.filter((m) => m.ruleId === f.ruleId && m.path === f.filePath && m.fix !== null);
  if (same.length === 0) return [];
  const onLine = same.filter((m) => m.line === f.startLine);
  if (onLine.length) return onLine;
  // The file moved since the scan: fall back to the closest match.
  const target = f.startLine ?? 0;
  const closest = same.reduce((a, b) => (Math.abs(b.line - target) < Math.abs(a.line - target) ? b : a));
  return same.filter((m) => m.line === closest.line);
}

async function semgrepAutofix(repoDir: string, commit: string, f: AutofixFinding): Promise<GeneratedFix> {
  return withWorktree(repoDir, commit, async (wt) => {
    const matches = matchesForFinding(semgrepMatches(await semgrepJson(wt, [f.filePath])), f);
    if (matches.length === 0) {
      throw new NoAutofixError("This finding has no deterministic autofix at the current commit.");
    }
    const file = safeJoin(wt, f.filePath);
    if (!file) throw new NoAutofixError("Finding path is outside the repository.");
    const before = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      applyReplacements(before, matches.map((m) => ({ start: m.startOffset, end: m.endOffset, text: m.fix! }))),
    );
    const diff = await worktreeDiff(wt);
    if (!diff.trim()) throw new NoAutofixError("Autofix produced no change.");
    return {
      diff,
      summary:
        (matches[0]!.fixSummary ?? `Apply the ${f.ruleId} rewrite.`) +
        ` (${f.filePath}:${matches[0]!.line}${matches.length > 1 ? `, ${matches.length} occurrences` : ""})`,
    };
  });
}

/**
 * The lowest published, non-deprecated, non-prerelease version at or above
 * `minimum`. Upstream sometimes deprecates the very release an advisory names
 * as "fixed" (lodash 4.18.0 is one), so never take the advisory at its word.
 */
export async function pickInstallableVersion(
  pkg: string,
  minimum: string,
  cwd: string,
): Promise<{ version: string; skipped: Array<{ version: string; reason: string }> }> {
  const r = await run("npm", ["view", pkg, "versions", "--json"], { cwd, timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`npm view ${pkg} failed: ${r.stderr.trim().slice(0, 200)}`);
  const all = ([] as string[]).concat(JSON.parse(r.stdout));
  const candidates = all
    .filter((v) => !v.includes("-") && compareVersions(v, minimum) >= 0)
    .sort(compareVersions)
    .slice(0, 6);
  const skipped: Array<{ version: string; reason: string }> = [];
  for (const v of candidates) {
    const d = await run("npm", ["view", `${pkg}@${v}`, "deprecated"], { cwd, timeoutMs: 60_000 });
    const reason = d.stdout.trim();
    if (d.code === 0 && !reason) return { version: v, skipped };
    skipped.push({ version: v, reason: reason || "lookup failed" });
  }
  throw new NoAutofixError(
    `No installable release of ${pkg} at or above ${minimum}: ${skipped.map((s) => `${s.version} (${s.reason})`).join("; ")}`,
  );
}

async function dependencyBump(repoDir: string, commit: string, f: AutofixFinding): Promise<GeneratedFix> {
  if (!f.packageName || !f.fixedVersion) throw new NoAutofixError("No fixed version is known for this package.");
  if (path.basename(f.filePath) !== "package-lock.json") {
    throw new NoAutofixError("Automatic upgrades currently support npm (package-lock.json) only.");
  }
  return withWorktree(repoDir, commit, async (wt) => {
    const projectDir = safeJoin(wt, path.dirname(f.filePath));
    if (!projectDir) throw new NoAutofixError("Lockfile path is outside the repository.");
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    const section = (["dependencies", "devDependencies", "optionalDependencies"] as const).find(
      (s) => pkg[s] && typeof pkg[s][f.packageName!] === "string",
    );
    if (!section) {
      throw new NoAutofixError(
        `${f.packageName} is a transitive dependency. Upgrade the package that pulls it in, or add an npm "overrides" entry — ask the agent to draft that.`,
      );
    }
    const exact = /^\d/.test(pkg[section][f.packageName!]);
    const target = await pickInstallableVersion(f.packageName!, f.fixedVersion!, projectDir);
    const args = [
      "install",
      `${f.packageName}@${target.version}`,
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ];
    if (exact) args.push("--save-exact");
    if (section === "devDependencies") args.push("--save-dev");
    if (section === "optionalDependencies") args.push("--save-optional");
    const r = await run("npm", args, { cwd: projectDir, timeoutMs: 180_000 });
    if (r.code !== 0) throw new Error(`npm install failed: ${r.stderr.trim().slice(0, 400)}`);
    const diff = await worktreeDiff(wt);
    if (!diff.trim()) throw new NoAutofixError("The upgrade produced no change.");
    return {
      diff,
      summary:
        `Upgrade ${f.packageName} to ${target.version}, the lowest clean release that fixes every known advisory` +
        (target.skipped.length
          ? ` (skipped ${target.skipped.map((s) => `${s.version}: deprecated upstream`).join(", ")}).`
          : "."),
    };
  });
}

export async function generateAutofix(repoDir: string, commit: string, f: AutofixFinding): Promise<GeneratedFix> {
  if (f.tool === "semgrep") return semgrepAutofix(repoDir, commit, f);
  if (f.tool === "osv-scanner") return dependencyBump(repoDir, commit, f);
  throw new NoAutofixError(
    "Secrets need a human: move the value to an environment variable, then rotate the key. Ask the agent to draft the code change.",
  );
}
