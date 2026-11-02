import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { desc, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findings, repoShares, repos, scans, SEVERITIES } from "../server/db/schema.js";
import { repoSchema, toRepo } from "../server/lib/dto.js";
import { OPEN_STATUSES } from "../server/lib/status.js";
import { parseJson } from "../server/lib/store.js";

const countsSchema = z.object(Object.fromEntries(SEVERITIES.map((s) => [s, z.number()])) as Record<(typeof SEVERITIES)[number], z.ZodNumber>);

export default defineAction({
  description:
    "List repositories the user can see, with open finding counts by severity and the latest scan (status, commit, per-scanner result).",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  outputSchema: z.object({
    repos: z.array(
      repoSchema.extend({
        open: countsSchema,
        openTotal: z.number(),
        lastScan: z
          .object({
            id: z.string(),
            status: z.enum(["running", "completed", "failed"]),
            commitSha: z.string().nullable(),
            startedAt: z.string(),
            finishedAt: z.string().nullable(),
            newCount: z.number(),
            resolvedCount: z.number(),
            tools: z.record(z.string(), z.object({ ok: z.boolean(), findings: z.number(), durationMs: z.number(), error: z.string().optional() })),
          })
          .nullable(),
      }),
    ),
  }),
  run: async () => {
    const db = getDb();
    const rows = await db.select().from(repos).where(accessFilter(repos, repoShares)).orderBy(desc(repos.createdAt));
    const ids = rows.map((r) => r.id);
    const openRows = ids.length
      ? await db
          .select({ repoId: findings.repoId, severity: findings.severity, status: findings.status })
          .from(findings)
          .where(inArray(findings.repoId, ids))
      : [];
    const scanIds = rows.map((r) => r.lastScanId).filter(Boolean) as string[];
    const scanRows = scanIds.length ? await db.select().from(scans).where(inArray(scans.id, scanIds)) : [];
    const scanById = new Map(scanRows.map((s) => [s.id, s]));

    return {
      repos: rows.map((r) => {
        const open = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<(typeof SEVERITIES)[number], number>;
        for (const f of openRows) {
          if (f.repoId === r.id && OPEN_STATUSES.includes(f.status)) open[f.severity] += 1;
        }
        const scan = r.lastScanId ? scanById.get(r.lastScanId) : undefined;
        return {
          ...toRepo(r),
          open,
          openTotal: Object.values(open).reduce((a, b) => a + b, 0),
          lastScan: scan
            ? {
                id: scan.id,
                status: scan.status,
                commitSha: scan.commitSha,
                startedAt: scan.startedAt,
                finishedAt: scan.finishedAt,
                newCount: scan.newCount,
                resolvedCount: scan.resolvedCount,
                tools: parseJson(scan.toolSummary, {}),
              }
            : null,
        };
      }),
    };
  },
});
