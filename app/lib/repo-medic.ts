import type { z } from "zod";

import type { findingSchema, fixSchema, fixSummarySchema } from "../../server/lib/dto";

export type Finding = z.infer<typeof findingSchema>;
export type Fix = z.infer<typeof fixSchema>;
export type FixSummary = z.infer<typeof fixSummarySchema>;
export type Severity = Finding["severity"];
export type FindingStatus = Finding["status"];
export type Tool = Finding["tool"];

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

export const SEVERITY_STYLE: Record<Severity, { label: string; dot: string; chip: string }> = {
  critical: {
    label: "Critical",
    dot: "bg-red-600",
    chip: "border-red-600/30 bg-red-600/10 text-red-700 dark:text-red-300",
  },
  high: {
    label: "High",
    dot: "bg-orange-500",
    chip: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  medium: {
    label: "Medium",
    dot: "bg-amber-400",
    chip: "border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-200",
  },
  low: {
    label: "Low",
    dot: "bg-sky-500",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  info: {
    label: "Info",
    dot: "bg-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
  },
};

export const TOOL_LABEL: Record<Tool, string> = {
  semgrep: "Code · Semgrep",
  gitleaks: "Secret · Gitleaks",
  "osv-scanner": "Dependency · OSV",
};

export const TOOL_SHORT: Record<Tool, string> = {
  semgrep: "Code",
  gitleaks: "Secret",
  "osv-scanner": "Dependency",
};

export interface BoardColumn {
  id: string;
  title: string;
  statuses: FindingStatus[];
  /** Status a dropped card moves to; null when the column is earned, not dragged into. */
  dropStatus: "new" | "confirmed" | "dismissed" | null;
  emptyHint: string;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { id: "new", title: "New", statuses: ["new"], dropStatus: "new", emptyHint: "Nothing waiting for triage." },
  {
    id: "confirmed",
    title: "Confirmed",
    statuses: ["confirmed"],
    dropStatus: "confirmed",
    emptyHint: "Drag real issues here.",
  },
  {
    id: "fix_ready",
    title: "Fix ready",
    statuses: ["fix_ready"],
    dropStatus: null,
    emptyHint: "Fixes land here once tests and a re-scan pass.",
  },
  {
    id: "pr_opened",
    title: "Branch / PR",
    statuses: ["pr_opened"],
    dropStatus: null,
    emptyHint: "Verified fixes you shipped as a branch or PR.",
  },
  {
    id: "closed",
    title: "Closed",
    statuses: ["resolved", "dismissed"],
    dropStatus: "dismissed",
    emptyHint: "Resolved by a re-scan, or dismissed with a reason.",
  },
];

export const EARNED_COLUMN_MESSAGE: Record<string, string> = {
  fix_ready: "Cards move to Fix ready on their own when a fix passes its checks.",
  pr_opened: "Open a verified fix as a branch or PR from the card to move it here.",
};

export function locationLabel(f: Pick<Finding, "filePath" | "startLine" | "packageName" | "packageVersion">): string {
  if (f.packageName) return `${f.packageName}@${f.packageVersion ?? "?"} · ${f.filePath}`;
  return f.startLine ? `${f.filePath}:${f.startLine}` : f.filePath;
}

export function advisoryUrl(id: string): string | null {
  if (id.startsWith("http")) return id;
  if (/^GHSA-/.test(id)) return `https://github.com/advisories/${id}`;
  if (/^CVE-/.test(id)) return `https://nvd.nist.gov/vuln/detail/${id}`;
  return `https://osv.dev/vulnerability/${id}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function askAgentToFix(f: Finding, repoName: string): { message: string; context: string } {
  return {
    message: `Fix "${f.title}" in ${locationLabel(f)}, then verify it.`,
    context: [
      `Repo Medic finding ${f.id} in repo "${repoName}" (${f.tool} rule ${f.ruleId}, ${f.severity}).`,
      `1. Call get-finding with id ${f.id} to read the code and any earlier fixes.`,
      `2. Write the smallest safe fix as a unified git diff against HEAD (a/ and b/ paths). Keep existing behaviour and tests green.`,
      `3. Call propose-fix with findingId ${f.id}, the diff and a one-sentence summary.`,
      `4. Call test-fix with the returned fix id. If a check fails, read it, adjust the diff and try again (at most 3 attempts).`,
      `5. Tell me what changed and the check results. Do not open a pull request unless I ask.`,
    ].join("\n"),
  };
}
