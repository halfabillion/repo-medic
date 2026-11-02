import { defineAction, defineActionErrors, type WriteReceipt } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findings, SEVERITIES } from "../server/db/schema.js";
import { findingSchema, toFinding } from "../server/lib/dto.js";
import { checkManualTransition, MANUAL_STATUSES } from "../server/lib/status.js";
import { latestFixes, loadFinding, nowIso } from "../server/lib/store.js";

const errors = defineActionErrors("not_found", "forbidden", "invalid_transition", "reason_required", "empty_patch");

export default defineAction({
  description:
    'Triage a finding: move it between "new", "confirmed" and "dismissed" (dismiss needs dismissReason), change its severity, or set a note. Fix ready / PR opened / Resolved are set by test-fix, open-pull-request and scan-repo, not here.',
  schema: z.object({
    id: z.string().describe("Finding id"),
    status: z.enum(MANUAL_STATUSES).optional().describe('New board column: "new", "confirmed" or "dismissed"'),
    dismissReason: z.string().max(500).optional().describe('Required when status is "dismissed", e.g. "test fixture" or "false positive"'),
    severity: z.enum(SEVERITIES).optional().describe("Override severity: critical|high|medium|low|info"),
    note: z.string().max(2000).optional().describe("Free-text triage note; empty string clears it"),
  }),
  outputSchema: z.object({ id: z.string(), finding: findingSchema, _receipt: z.any() }),
  errors,
  run: async (args) => {
    const { finding } = await loadFinding(args.id, "editor");
    if (args.status === undefined && args.severity === undefined && args.note === undefined) {
      return errors.noWrite("Nothing to change: pass status, severity or note.", "empty_patch");
    }
    const patch: Partial<typeof findings.$inferInsert> = { updatedAt: nowIso() };
    if (args.status !== undefined && args.status !== finding.status) {
      const check = checkManualTransition(finding.status, args.status, args.dismissReason);
      if (!check.ok) return errors.noWrite(check.message, check.errorCode, { statusCode: 409 });
      patch.status = args.status;
      patch.dismissReason = args.status === "dismissed" ? args.dismissReason!.trim() : null;
    }
    if (args.severity !== undefined) patch.severity = args.severity;
    if (args.note !== undefined) patch.note = args.note.trim() || null;

    const db = getDb();
    await db.update(findings).set(patch).where(eq(findings.id, finding.id));
    const [saved] = await db.select().from(findings).where(eq(findings.id, finding.id));
    const changed = Object.keys(patch).length > 1;
    const verified =
      (patch.status === undefined || saved!.status === patch.status) &&
      (patch.severity === undefined || saved!.severity === patch.severity);
    const _receipt: WriteReceipt = {
      changed,
      verified,
      subject: `finding:${finding.id}`,
      summary: changed ? `${saved!.title}: ${saved!.status}, ${saved!.severity}` : "Already in that state",
    };
    const fixes = await latestFixes([finding.id]);
    return { id: finding.id, finding: toFinding(saved!, fixes.get(finding.id)), _receipt };
  },
});
