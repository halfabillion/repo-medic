import { randomUUID } from "node:crypto";

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { fixes } from "../server/db/schema.js";
import { generateAutofix, NoAutofixError } from "../server/lib/autofix.js";
import { fixSchema, toFix } from "../server/lib/dto.js";
import { applyPatch, filesInDiff, headCommit, withWorktree } from "../server/lib/git.js";
import { loadFinding, nowIso, requireOwner } from "../server/lib/store.js";

const errors = defineActionErrors(
  "not_found",
  "forbidden",
  "unauthenticated",
  "finding_closed",
  "no_autofix",
  "patch_does_not_apply",
  "patch_too_large",
);

const MAX_DIFF = 200_000;

export default defineAction({
  description:
    "Propose a patch for a finding. Pass `diff` (a unified git diff against the repo's HEAD, paths a/… b/…) to submit your own fix; omit it to use Repo Medic's deterministic autofix (semgrep rewrite or npm upgrade). Saves a draft fix; call test-fix next.",
  schema: z.object({
    findingId: z.string().describe("Finding id"),
    diff: z
      .string()
      .optional()
      .describe("Unified diff (git diff format) against HEAD; omit to use the built-in autofix"),
    summary: z.string().max(500).optional().describe("One sentence: what the patch changes and why it is safe; required with diff"),
  }),
  outputSchema: z.object({ id: z.string(), fix: fixSchema, nextRequiredAction: z.literal("test-fix") }),
  errors,
  run: async (args, ctx) => {
    const { ownerEmail, orgId } = requireOwner();
    const { finding, repo } = await loadFinding(args.findingId, "editor");
    if (finding.status === "resolved" || finding.status === "dismissed") {
      return errors.noWrite(`This finding is ${finding.status}; reopen it before fixing.`, "finding_closed", { statusCode: 409 });
    }
    const baseCommit = await headCommit(repo.checkoutPath);
    let diff: string;
    let summary: string;
    let source: "autofix" | "agent" | "human";

    if (args.diff?.trim()) {
      if (args.diff.length > MAX_DIFF) return errors.noWrite("Diff is larger than 200 KB.", "patch_too_large");
      diff = args.diff.endsWith("\n") ? args.diff : `${args.diff}\n`;
      const check = await withWorktree(repo.checkoutPath, baseCommit, (wt) => applyPatch(wt, diff, true));
      if (check.code !== 0) {
        return errors.noWrite(
          `The diff does not apply to ${baseCommit.slice(0, 7)}: ${check.stderr.trim().slice(0, 400)}. Re-read the file with get-finding and regenerate the diff.`,
          "patch_does_not_apply",
          { details: { baseCommit, files: filesInDiff(diff) } },
        );
      }
      summary = args.summary?.trim() || `Patch for ${finding.title} in ${finding.filePath}`;
      source = ctx && ["tool", "mcp", "webmcp", "a2a", "automation"].includes(ctx.caller) ? "agent" : "human";
    } else {
      try {
        const generated = await generateAutofix(repo.checkoutPath, baseCommit, finding);
        diff = generated.diff;
        summary = generated.summary;
        source = "autofix";
      } catch (err) {
        if (err instanceof NoAutofixError) return errors.noWrite(err.message, "no_autofix", { statusCode: 422 });
        throw err;
      }
    }

    const db = getDb();
    // Older drafts for this finding are superseded.
    await db
      .update(fixes)
      .set({ status: "discarded", updatedAt: nowIso() })
      .where(and(eq(fixes.findingId, finding.id), inArray(fixes.status, ["draft", "failed"])));
    const id = randomUUID();
    const now = nowIso();
    await db.insert(fixes).values({
      id,
      findingId: finding.id,
      repoId: repo.id,
      source,
      summary,
      diff,
      baseCommit,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
    });
    const [saved] = await db.select().from(fixes).where(eq(fixes.id, id));
    return { id, fix: toFix(saved!), nextRequiredAction: "test-fix" as const };
  },
});
