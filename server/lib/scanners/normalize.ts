/**
 * Pure parsers that turn scanner JSON into RawFinding records.
 * Kept free of I/O so they can be unit-tested against captured fixtures.
 */
import { createHash } from "node:crypto";

import type { RawFinding, Severity } from "./types.js";

export function fingerprintOf(...parts: Array<string | number | null | undefined>): string {
  return createHash("sha256")
    .update(parts.map((p) => String(p ?? "")).join("\u001f"))
    .digest("hex")
    .slice(0, 32);
}

/** Collapse whitespace so a re-indented line keeps the same fingerprint. */
export function normalizeCode(code: string): string {
  return code.replace(/\s+/g, " ").trim();
}

/** Read lines [start, end] (1-based, inclusive) from file text. */
export function sliceLines(text: string, start: number, end: number): string {
  return text
    .split(/\r?\n/)
    .slice(Math.max(0, start - 1), Math.max(start, end))
    .join("\n");
}

// ---------------------------------------------------------------- semgrep

interface SemgrepResult {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    message?: string;
    severity?: string;
    fix?: string;
    metadata?: Record<string, unknown>;
  };
}

/** "repo-medic.scanners.semgrep.rm.js.eval" → "rm.js.eval" */
export function shortRuleId(checkId: string): string {
  const i = checkId.indexOf("rm.");
  return i >= 0 ? checkId.slice(i) : checkId;
}

export function semgrepSeverity(level: string | undefined): Severity {
  switch ((level ?? "").toUpperCase()) {
    case "ERROR":
      return "high";
    case "WARNING":
      return "medium";
    case "INFO":
      return "low";
    default:
      return "info";
  }
}

export function parseSemgrep(
  json: { results?: SemgrepResult[] },
  readFile: (relPath: string) => string | null,
): RawFinding[] {
  // Several matches of one rule on the same line become one finding.
  const grouped = new Map<string, SemgrepResult>();
  for (const r of json.results ?? []) {
    const key = `${r.check_id}|${r.path}|${r.start.line}`;
    if (!grouped.has(key)) grouped.set(key, r);
  }
  const out: RawFinding[] = [];
  for (const r of grouped.values()) {
    const ruleId = shortRuleId(r.check_id);
    const meta = r.extra.metadata ?? {};
    const text = readFile(r.path);
    const snippet = text ? sliceLines(text, r.start.line, r.end.line) : null;
    const cweRaw = meta.cwe;
    const cwe = Array.isArray(cweRaw) ? String(cweRaw[0] ?? "") : cweRaw ? String(cweRaw) : null;
    out.push({
      fingerprint: fingerprintOf("semgrep", ruleId, r.path, normalizeCode(snippet ?? String(r.start.line))),
      tool: "semgrep",
      ruleId,
      title: typeof meta.title === "string" ? meta.title : ruleId,
      message: (r.extra.message ?? "").trim(),
      severity: semgrepSeverity(r.extra.severity),
      filePath: r.path,
      startLine: r.start.line,
      endLine: r.end.line,
      snippet,
      cwe: cwe ? cwe.split(":")[0]!.trim() : null,
      packageName: null,
      packageVersion: null,
      fixedVersion: null,
      advisories: [],
      autofixAvailable: typeof r.extra.fix === "string",
    });
  }
  return out;
}

// --------------------------------------------------------------- gitleaks

interface GitleaksResult {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
  EndLine: number;
  Match: string;
  Secret: string;
}

/** Keep a short prefix so a human can recognise the key, never the full value. */
export function redactSecret(secret: string): string {
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 6)}…${"•".repeat(8)} (${secret.length} chars)`;
}

export function parseGitleaks(json: GitleaksResult[] | null): RawFinding[] {
  return (json ?? []).map((r) => {
    const redacted = redactSecret(r.Secret);
    return {
      fingerprint: fingerprintOf(
        "gitleaks",
        r.RuleID,
        r.File,
        createHash("sha256").update(r.Secret).digest("hex"),
      ),
      tool: "gitleaks" as const,
      ruleId: r.RuleID,
      title: `Hard-coded secret: ${r.RuleID.replace(/-/g, " ")}`,
      message: `${r.Description} Remove it from the code, load it from the environment or a secret store, and rotate the key: anything committed to git history must be treated as leaked.`,
      severity: "critical" as const,
      filePath: r.File,
      startLine: r.StartLine,
      endLine: r.EndLine,
      snippet: r.Match.split(r.Secret).join(redacted),
      cwe: "CWE-798",
      packageName: null,
      packageVersion: null,
      fixedVersion: null,
      advisories: [],
      autofixAvailable: false,
    };
  });
}

// ------------------------------------------------------------ osv-scanner

interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}
interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  affected?: Array<{
    package?: { name?: string; ecosystem?: string };
    ranges?: Array<{ type?: string; events?: OsvEvent[] }>;
  }>;
  database_specific?: { severity?: string; cwe_ids?: string[] };
}
interface OsvPackage {
  package: { name: string; version: string; ecosystem: string };
  vulnerabilities?: OsvVuln[];
  groups?: Array<{ ids: string[]; aliases?: string[]; max_severity?: string }>;
}
interface OsvJson {
  results?: Array<{ source: { path: string }; packages?: OsvPackage[] }>;
}

/** Compare dotted numeric versions ("4.17.21" vs "4.17.3"). Pre-release tags sort first. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.+-]/);
  const pb = b.replace(/^v/, "").split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Smallest version that fixes every advisory for this package: for each
 * advisory take the lowest `fixed` above the installed version, then the max.
 * Returns null when any advisory has no fixed release.
 */
export function minimumSafeVersion(pkg: OsvPackage): string | null {
  let target: string | null = null;
  for (const v of pkg.vulnerabilities ?? []) {
    const fixes: string[] = [];
    for (const a of v.affected ?? []) {
      if (a.package?.name !== pkg.package.name) continue;
      for (const r of a.ranges ?? []) {
        for (const e of r.events ?? []) {
          if (e.fixed && compareVersions(e.fixed, pkg.package.version) > 0) fixes.push(e.fixed);
        }
      }
    }
    if (fixes.length === 0) return null;
    const lowest = fixes.sort(compareVersions)[0]!;
    if (!target || compareVersions(lowest, target) > 0) target = lowest;
  }
  return target;
}

export function cvssToSeverity(score: number | null): Severity {
  if (score === null || Number.isNaN(score)) return "medium";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "info";
}

export function parseOsv(json: OsvJson, repoRoot: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const result of json.results ?? []) {
    const lockfile = result.source.path.startsWith(repoRoot)
      ? result.source.path.slice(repoRoot.length).replace(/^\/+/, "")
      : result.source.path;
    for (const pkg of result.packages ?? []) {
      const vulns = pkg.vulnerabilities ?? [];
      if (vulns.length === 0) continue;
      const scores = (pkg.groups ?? [])
        .map((g) => Number(g.max_severity))
        .filter((n) => !Number.isNaN(n));
      const maxScore = scores.length ? Math.max(...scores) : null;
      const ids = (pkg.groups ?? []).map((g) =>
        (g.aliases ?? g.ids).find((x) => x.startsWith("CVE-")) ?? g.ids[0]!,
      );
      const advisoryIds = ids.length ? ids : vulns.map((v) => v.id);
      const fixed = minimumSafeVersion(pkg);
      const summaries = vulns.map((v) => v.summary).filter(Boolean) as string[];
      const cwe = vulns.flatMap((v) => v.database_specific?.cwe_ids ?? [])[0] ?? null;
      out.push({
        fingerprint: fingerprintOf("osv", pkg.package.ecosystem, pkg.package.name, lockfile),
        tool: "osv-scanner",
        ruleId: `${pkg.package.ecosystem}:${pkg.package.name}`,
        title: `Vulnerable dependency: ${pkg.package.name}@${pkg.package.version}`,
        message:
          `${advisoryIds.length} known ${advisoryIds.length === 1 ? "advisory" : "advisories"}: ${[...new Set(summaries)].slice(0, 4).join("; ")}.` +
          (fixed ? ` Upgrading to ${fixed} fixes all of them.` : " At least one advisory has no fixed release yet."),
        severity: cvssToSeverity(maxScore),
        filePath: lockfile,
        startLine: null,
        endLine: null,
        snippet: `${pkg.package.name}@${pkg.package.version}`,
        cwe,
        packageName: pkg.package.name,
        packageVersion: pkg.package.version,
        fixedVersion: fixed,
        advisories: advisoryIds,
        autofixAvailable: Boolean(fixed) && pkg.package.ecosystem === "npm",
      });
    }
  }
  return out;
}
