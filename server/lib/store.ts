import { NoWriteError, fail } from "@agent-native/core/action";
import { accessFilter, resolveAccess, roleSatisfies } from "@agent-native/core/sharing";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { desc, eq, inArray } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { findings, fixes, repoShares, repos } from "../db/schema.js";

export type RepoRow = typeof repos.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type FixRow = typeof fixes.$inferSelect;

export function requireOwner(): { ownerEmail: string; orgId: string | null } {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) fail("Sign in to use Repo Medic.", { errorCode: "unauthenticated", statusCode: 401 });
  return { ownerEmail, orgId: getRequestOrgId() ?? null };
}

/**
 * Load a repo the caller can reach, or reject before any write.
 * Scans, findings and fixes are children of a repo and inherit its access.
 */
export async function loadRepo(repoId: string, minRole: "viewer" | "editor" = "viewer"): Promise<RepoRow> {
  const access = await resolveAccess("repo", repoId);
  if (!access) throw new NoWriteError(`No repository with id ${repoId}.`, { errorCode: "not_found", statusCode: 404 });
  if (!roleSatisfies(access.role, minRole)) {
    throw new NoWriteError("You can view this repository but not change it.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
  return access.resource as RepoRow;
}

export async function accessibleRepoIds(): Promise<string[]> {
  const rows = await getDb()
    .select({ id: repos.id })
    .from(repos)
    .where(accessFilter(repos, repoShares));
  return rows.map((r) => r.id);
}

export async function loadFinding(
  findingId: string,
  minRole: "viewer" | "editor" = "viewer",
): Promise<{ finding: FindingRow; repo: RepoRow }> {
  const [finding] = await getDb().select().from(findings).where(eq(findings.id, findingId)).limit(1);
  if (!finding) throw new NoWriteError(`No finding with id ${findingId}.`, { errorCode: "not_found", statusCode: 404 });
  const repo = await loadRepo(finding.repoId, minRole);
  return { finding, repo };
}

export async function loadFix(
  fixId: string,
  minRole: "viewer" | "editor" = "viewer",
): Promise<{ fix: FixRow; finding: FindingRow; repo: RepoRow }> {
  const [fix] = await getDb().select().from(fixes).where(eq(fixes.id, fixId)).limit(1);
  if (!fix) throw new NoWriteError(`No fix with id ${fixId}.`, { errorCode: "not_found", statusCode: 404 });
  const { finding, repo } = await loadFinding(fix.findingId, minRole);
  return { fix, finding, repo };
}

/** Latest fix per finding, for board badges. */
export async function latestFixes(findingIds: string[]): Promise<Map<string, FixRow>> {
  const out = new Map<string, FixRow>();
  if (findingIds.length === 0) return out;
  const rows = await getDb()
    .select()
    .from(fixes)
    .where(inArray(fixes.findingId, findingIds))
    .orderBy(desc(fixes.createdAt));
  for (const row of rows) if (!out.has(row.findingId)) out.set(row.findingId, row);
  return out;
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

