import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { FINDING_STATUSES, findings, SEVERITIES, TOOLS } from "../server/db/schema.js";
import { findingSchema, toFinding } from "../server/lib/dto.js";
import { SEVERITY_RANK } from "../server/lib/scanners/types.js";
import { accessibleRepoIds, latestFixes, loadRepo } from "../server/lib/store.js";

export default defineAction({
  description:
    "List findings (the triage board cards), most severe first. Filter by repoId, status (new|confirmed|fix_ready|pr_opened|resolved|dismissed), severity and tool. Each card includes its latest fix.",
  schema: z.object({
    repoId: z.string().optional().describe("Only this repo; omit for every repo the user can see"),
    status: z.enum(FINDING_STATUSES).optional().describe("Only this board column"),
    severity: z.enum(SEVERITIES).optional().describe("Only this severity: critical|high|medium|low|info"),
    tool: z.enum(TOOLS).optional().describe("Only this scanner: semgrep|gitleaks|osv-scanner"),
    limit: z.coerce.number().int().min(1).max(500).default(200).describe("Max rows; defaults to 200"),
  }),
  http: { method: "GET" },
  readOnly: true,
  outputSchema: z.object({ findings: z.array(findingSchema), total: z.number() }),
  run: async (args) => {
    const repoIds = args.repoId ? [(await loadRepo(args.repoId)).id] : await accessibleRepoIds();
    if (repoIds.length === 0) return { findings: [], total: 0 };
    const where: SQL[] = [inArray(findings.repoId, repoIds)];
    if (args.status) where.push(eq(findings.status, args.status));
    if (args.severity) where.push(eq(findings.severity, args.severity));
    if (args.tool) where.push(eq(findings.tool, args.tool));
    const rows = await getDb().select().from(findings).where(and(...where));
    rows.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.filePath.localeCompare(b.filePath) ||
        (a.startLine ?? 0) - (b.startLine ?? 0),
    );
    const page = rows.slice(0, args.limit);
    const fixes = await latestFixes(page.map((r) => r.id));
    return { findings: page.map((r) => toFinding(r, fixes.get(r.id))), total: rows.length };
  },
});
