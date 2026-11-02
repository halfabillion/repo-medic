import { sql } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import {
  createSharesTable,
  ownableColumns,
} from "@agent-native/core/db/schema";

/** A repository under care. Shareable: private to its creator, or org-visible. */
export const repos = pgTable("repos", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Where it came from: an absolute local path or an https://github.com/... URL. */
  source: text("source").notNull(),
  sourceKind: text("source_kind", { enum: ["local", "github"] }).notNull(),
  /** Working checkout Repo Medic scans (a clone for GitHub sources). */
  checkoutPath: text("checkout_path").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  lastScanId: text("last_scan_id"),
  lastScannedAt: text("last_scanned_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  ...ownableColumns(),
});
export const repoShares = createSharesTable("repo_shares");

/** One run of the scanner suite over a repo. */
export const scans = pgTable("scans", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] })
    .notNull()
    .default("running"),
  commitSha: text("commit_sha"),
  /** JSON: per-scanner { ok, findings, durationMs, error? }. */
  toolSummary: text("tool_summary").notNull().default("{}"),
  newCount: integer("new_count").notNull().default(0),
  resolvedCount: integer("resolved_count").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const FINDING_STATUSES = [
  "new",
  "confirmed",
  "fix_ready",
  "pr_opened",
  "resolved",
  "dismissed",
] as const;
export const SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;
export const TOOLS = ["semgrep", "gitleaks", "osv-scanner"] as const;

/** A de-duplicated issue in a repo. Child of `repos`; inherits its access. */
export const findings = pgTable("findings", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  tool: text("tool", { enum: TOOLS }).notNull(),
  ruleId: text("rule_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity", { enum: SEVERITIES }).notNull(),
  /** Severity as the scanner reported it, before any human edit. */
  scannerSeverity: text("scanner_severity", { enum: SEVERITIES }).notNull(),
  status: text("status", { enum: FINDING_STATUSES }).notNull().default("new"),
  filePath: text("file_path").notNull(),
  startLine: integer("start_line"),
  endLine: integer("end_line"),
  /** Matched code, with any secret value redacted. */
  snippet: text("snippet"),
  cwe: text("cwe"),
  packageName: text("package_name"),
  packageVersion: text("package_version"),
  fixedVersion: text("fixed_version"),
  /** JSON array of advisory ids / reference URLs. */
  advisories: text("advisories").notNull().default("[]"),
  autofixAvailable: integer("autofix_available").notNull().default(0),
  dismissReason: text("dismiss_reason"),
  note: text("note"),
  firstSeenScanId: text("first_seen_scan_id").notNull(),
  lastSeenScanId: text("last_seen_scan_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const FIX_STATUSES = [
  "draft",
  "passed",
  "failed",
  "pr_opened",
  "discarded",
] as const;

/** A proposed patch for a finding, plus its verification result. */
export const fixes = pgTable("fixes", {
  id: text("id").primaryKey(),
  findingId: text("finding_id").notNull(),
  repoId: text("repo_id").notNull(),
  source: text("source", { enum: ["autofix", "agent", "human"] }).notNull(),
  summary: text("summary").notNull(),
  diff: text("diff").notNull(),
  baseCommit: text("base_commit").notNull(),
  status: text("status", { enum: FIX_STATUSES }).notNull().default("draft"),
  /** JSON array of { id, ok, detail } verification checks. */
  checks: text("checks").notNull().default("[]"),
  testOutput: text("test_output"),
  branch: text("branch"),
  prUrl: text("pr_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});

export const EVENT_ACTORS = ["agent", "human", "system"] as const;
export const EVENT_KINDS = [
  "detected",
  "reopened",
  "resolved",
  "status_changed",
  "severity_changed",
  "note_changed",
  "fix_proposed",
  "fix_rejected",
  "fix_passed",
  "fix_failed",
  "branch_created",
  "pr_opened",
  "pr_failed",
] as const;

/**
 * Append-only activity log for a finding: who (agent, person or the system)
 * did what and when, including failed fix attempts and why they failed.
 * Child of `findings`; inherits the repo's access.
 */
export const findingEvents = pgTable("finding_events", {
  id: text("id").primaryKey(),
  findingId: text("finding_id").notNull(),
  repoId: text("repo_id").notNull(),
  fixId: text("fix_id"),
  actor: text("actor", { enum: EVENT_ACTORS }).notNull(),
  /** Display name: the person's email, "Agent", or the scanner / system part. */
  actorLabel: text("actor_label").notNull(),
  kind: text("kind", { enum: EVENT_KINDS }).notNull(),
  /** 1 = succeeded, 0 = failed, null = not a pass/fail event. */
  ok: integer("ok"),
  summary: text("summary").notNull(),
  /** JSON array of strings: reasons, failed checks, links. */
  detail: text("detail").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
});
