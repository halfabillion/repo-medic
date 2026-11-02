import type { Check } from "./verify.js";

export interface PrInput {
  finding: {
    title: string;
    ruleId: string;
    tool: string;
    severity: string;
    filePath: string;
    startLine: number | null;
    cwe: string | null;
    advisories: string[];
    message: string;
  };
  fix: { summary: string; source: string; baseCommit: string };
  checks: Check[];
}

export function branchNameFor(ruleId: string, fixId: string): string {
  const slug = ruleId
    .replace(/^rm\.(js\.)?/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `repo-medic/${slug || "fix"}-${fixId.slice(0, 8)}`;
}

export function prTitleFor(input: PrInput): string {
  return `fix(security): ${input.finding.title}`.slice(0, 120);
}

const ICON = (c: Check) => (c.skipped ? "⏭️" : c.ok ? "✅" : "❌");
const CHECK_LABEL: Record<Check["id"], string> = {
  patch_applies: "Patch applies",
  tests: "Project tests",
  finding_gone: "Finding gone on re-scan",
  no_new_issues: "No new issues",
};

export function prBodyFor(input: PrInput): string {
  const { finding, fix, checks } = input;
  const where = finding.startLine ? `${finding.filePath}:${finding.startLine}` : finding.filePath;
  const refs = finding.advisories.slice(0, 8).map((a) => `- ${a}`);
  return [
    `## What`,
    fix.summary,
    ``,
    `## Why`,
    `**${finding.severity.toUpperCase()}** · ${finding.tool} \`${finding.ruleId}\`${finding.cwe ? ` · ${finding.cwe}` : ""} · \`${where}\``,
    ``,
    finding.message,
    ...(refs.length ? [``, `References:`, ...refs] : []),
    ``,
    `## Verification`,
    `Checked by Repo Medic in a clean worktree at \`${fix.baseCommit.slice(0, 7)}\`:`,
    ``,
    `| Check | Result |`,
    `| --- | --- |`,
    ...checks.map((c) => `| ${ICON(c)} ${CHECK_LABEL[c.id] ?? c.id} | ${c.detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`),
    ``,
    `<sub>Patch source: ${fix.source === "autofix" ? "deterministic autofix" : fix.source === "agent" ? "Repo Medic agent" : "human"}. Review before merging.</sub>`,
  ].join("\n");
}
