import { defineAction, defineActionErrors, type WriteReceipt } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findings, fixes } from "../server/db/schema.js";
import { checkSchema, fixSchema, toFix } from "../server/lib/dto.js";
import { config } from "../server/lib/config.js";
import { actorFrom, failedCheckReasons, recordEvent } from "../server/lib/events.js";
import { loadFix, nowIso } from "../server/lib/store.js";
import { verifyFix } from "../server/lib/verify.js";

const errors = defineActionErrors("not_found", "forbidden", "fix_closed");

export default defineAction({
  description:
    "Verify a proposed fix in a throwaway git worktree: the patch applies, the project's tests pass, the scanner no longer reports the finding, and no new issue appears. On success the card moves to Fix ready. Read `checks` when it fails, then propose a new diff.",
  schema: z.object({ id: z.string().describe("Fix id from propose-fix") }),
  outputSchema: z.object({
    id: z.string(),
    passed: z.boolean(),
    checks: z.array(checkSchema),
    fix: fixSchema,
    nextRequiredAction: z.enum(["open-pull-request", "propose-fix"]),
    _receipt: z.any(),
  }),
  errors,
  run: async (args, ctx) => {
    const { fix, finding, repo } = await loadFix(args.id, "editor");
    if (fix.status === "discarded" || fix.status === "pr_opened") {
      return errors.noWrite(`This fix is ${fix.status}.`, "fix_closed", { statusCode: 409 });
    }
    const db = getDb();
    const known = await db.select({ fp: findings.fingerprint }).from(findings).where(eq(findings.repoId, repo.id));
    const result = await verifyFix({
      repoDir: repo.checkoutPath,
      baseCommit: fix.baseCommit,
      diff: fix.diff,
      finding: { fingerprint: finding.fingerprint, tool: finding.tool, ruleId: finding.ruleId, filePath: finding.filePath },
      knownFingerprints: new Set(known.map((k) => k.fp)),
      // Tests execute repo code: only for local checkouts the user already trusts.
      allowTestExecution: repo.sourceKind === "local" || config.runUntrustedTests,
    });
    const now = nowIso();
    await db
      .update(fixes)
      .set({ status: result.passed ? "passed" : "failed", checks: JSON.stringify(result.checks), testOutput: result.testOutput, updatedAt: now })
      .where(eq(fixes.id, fix.id));
    if (result.passed && (finding.status === "new" || finding.status === "confirmed")) {
      await db.update(findings).set({ status: "fix_ready", updatedAt: now }).where(eq(findings.id, finding.id));
    }
    await recordEvent({
      finding,
      fixId: fix.id,
      ...actorFrom(ctx),
      kind: result.passed ? "fix_passed" : "fix_failed",
      ok: result.passed,
      summary: result.passed
        ? `Verified the fix: ${result.checks.filter((c) => c.ok && !c.skipped).length} checks passed${finding.status === "new" || finding.status === "confirmed" ? ", card moved to Fix ready" : ""}`
        : `Verification failed (${result.checks.filter((c) => !c.ok && !c.skipped).length} of ${result.checks.length} checks)`,
      detail: result.passed ? result.checks.filter((c) => c.skipped).map((c) => `Skipped ${c.id}: ${c.detail}`) : failedCheckReasons(result.checks),
      at: now,
    });
    const [saved] = await db.select().from(fixes).where(eq(fixes.id, fix.id));
    const _receipt: WriteReceipt = {
      changed: true,
      verified: result.passed,
      subject: `fix:${finding.id}`,
      summary: result.passed ? `Fix verified for ${finding.title}` : `Fix failed verification for ${finding.title}`,
      checks: result.checks.map((c) => ({ id: c.id, ok: c.ok, detail: c.detail })),
    };
    return {
      id: fix.id,
      passed: result.passed,
      checks: result.checks,
      fix: toFix(saved!),
      nextRequiredAction: result.passed ? ("open-pull-request" as const) : ("propose-fix" as const),
      _receipt,
    };
  },
});
