import { z } from "zod";

import { FINDING_STATUSES, FIX_STATUSES, SEVERITIES, TOOLS } from "../db/schema.js";
import type { FindingRow, FixRow, RepoRow } from "./store.js";
import { parseJson } from "./store.js";

export const checkSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  detail: z.string(),
});

export const fixSummarySchema = z.object({
  id: z.string(),
  findingId: z.string(),
  source: z.enum(["autofix", "agent", "human"]),
  status: z.enum(FIX_STATUSES),
  summary: z.string(),
  baseCommit: z.string(),
  branch: z.string().nullable(),
  prUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const fixSchema = fixSummarySchema.extend({
  diff: z.string(),
  checks: z.array(checkSchema),
  testOutput: z.string().nullable(),
});

export const findingSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  tool: z.enum(TOOLS),
  ruleId: z.string(),
  title: z.string(),
  message: z.string(),
  severity: z.enum(SEVERITIES),
  scannerSeverity: z.enum(SEVERITIES),
  status: z.enum(FINDING_STATUSES),
  filePath: z.string(),
  startLine: z.number().nullable(),
  endLine: z.number().nullable(),
  snippet: z.string().nullable(),
  cwe: z.string().nullable(),
  packageName: z.string().nullable(),
  packageVersion: z.string().nullable(),
  fixedVersion: z.string().nullable(),
  advisories: z.array(z.string()),
  autofixAvailable: z.boolean(),
  dismissReason: z.string().nullable(),
  note: z.string().nullable(),
  updatedAt: z.string(),
  latestFix: fixSummarySchema.nullable(),
});

export const repoSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  sourceKind: z.enum(["local", "github"]),
  defaultBranch: z.string(),
  lastScanId: z.string().nullable(),
  lastScannedAt: z.string().nullable(),
  createdAt: z.string(),
  visibility: z.string().nullable(),
});

export function toFixSummary(f: FixRow): z.infer<typeof fixSummarySchema> {
  return {
    id: f.id,
    findingId: f.findingId,
    source: f.source,
    status: f.status,
    summary: f.summary,
    baseCommit: f.baseCommit,
    branch: f.branch,
    prUrl: f.prUrl,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

export function toFix(f: FixRow): z.infer<typeof fixSchema> {
  return {
    ...toFixSummary(f),
    diff: f.diff,
    checks: parseJson(f.checks, []),
    testOutput: f.testOutput,
  };
}

export function toFinding(f: FindingRow, latest: FixRow | undefined): z.infer<typeof findingSchema> {
  return {
    id: f.id,
    repoId: f.repoId,
    tool: f.tool,
    ruleId: f.ruleId,
    title: f.title,
    message: f.message,
    severity: f.severity,
    scannerSeverity: f.scannerSeverity,
    status: f.status,
    filePath: f.filePath,
    startLine: f.startLine,
    endLine: f.endLine,
    snippet: f.snippet,
    cwe: f.cwe,
    packageName: f.packageName,
    packageVersion: f.packageVersion,
    fixedVersion: f.fixedVersion,
    advisories: parseJson(f.advisories, []),
    autofixAvailable: Boolean(f.autofixAvailable),
    dismissReason: f.dismissReason,
    note: f.note,
    updatedAt: f.updatedAt,
    latestFix: latest ? toFixSummary(latest) : null,
  };
}

export function toRepo(r: RepoRow): z.infer<typeof repoSchema> {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    sourceKind: r.sourceKind,
    defaultBranch: r.defaultBranch,
    lastScanId: r.lastScanId,
    lastScannedAt: r.lastScannedAt,
    createdAt: String(r.createdAt),
    visibility: (r as { visibility?: string | null }).visibility ?? null,
  };
}
