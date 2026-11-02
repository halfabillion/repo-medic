export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Tool = "semgrep" | "gitleaks" | "osv-scanner";

/** Scanner-neutral finding, before it is stored. */
export interface RawFinding {
  fingerprint: string;
  tool: Tool;
  ruleId: string;
  title: string;
  message: string;
  severity: Severity;
  filePath: string;
  startLine: number | null;
  endLine: number | null;
  snippet: string | null;
  cwe: string | null;
  packageName: string | null;
  packageVersion: string | null;
  fixedVersion: string | null;
  advisories: string[];
  autofixAvailable: boolean;
}

export interface ScannerRun {
  tool: Tool;
  ok: boolean;
  findings: RawFinding[];
  durationMs: number;
  error?: string;
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
