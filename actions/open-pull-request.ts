import { defineAction, defineActionErrors, type WriteReceipt } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findings, fixes } from "../server/db/schema.js";
import { config } from "../server/lib/config.js";
import { run } from "../server/lib/exec.js";
import { applyPatch, git, parseGitHubUrl, withWorktree } from "../server/lib/git.js";
import { branchNameFor, prBodyFor, prTitleFor } from "../server/lib/pr.js";
import { loadFix, nowIso, parseJson } from "../server/lib/store.js";
import type { Check } from "../server/lib/verify.js";

const errors = defineActionErrors("not_found", "forbidden", "fix_not_verified", "branch_failed", "push_failed");

function pushAllowed(source: string): { allowed: boolean; reason: string } {
  const gh = parseGitHubUrl(source);
  if (!gh) return { allowed: false, reason: "local repository: branch created locally, nothing pushed" };
  if (!config.allowPush) return { allowed: false, reason: "pushing is off (REPO_MEDIC_ALLOW_PUSH is not 1)" };
  if (!config.prOwners.includes(gh.owner.toLowerCase())) {
    return { allowed: false, reason: `${gh.owner} is not in REPO_MEDIC_PR_OWNERS` };
  }
  return { allowed: true, reason: "" };
}

export default defineAction({
  description:
    "Turn a verified fix (test-fix passed) into a commit on a new repo-medic/* branch and, when pushing is enabled for that GitHub owner, open a pull request with the verification table. Needs human approval.",
  schema: z.object({ id: z.string().describe("Fix id whose test-fix passed") }),
  needsApproval: true,
  outputSchema: z.object({
    id: z.string(),
    branch: z.string(),
    commit: z.string(),
    pushed: z.boolean(),
    prUrl: z.string().nullable(),
    title: z.string(),
    body: z.string(),
    message: z.string(),
    _receipt: z.any(),
  }),
  errors,
  run: async (args) => {
    const { fix, finding, repo } = await loadFix(args.id, "editor");
    if (fix.status !== "passed") {
      return errors.noWrite("Only a fix that passed test-fix can become a pull request. Run test-fix first.", "fix_not_verified", {
        statusCode: 409,
      });
    }
    const checks = parseJson<Check[]>(fix.checks, []);
    const prInput = {
      finding: { ...finding, advisories: parseJson<string[]>(finding.advisories, []) },
      fix,
      checks,
    };
    const title = prTitleFor(prInput);
    const body = prBodyFor(prInput);
    const branch = branchNameFor(finding.ruleId, fix.id);

    const commit = await withWorktree(repo.checkoutPath, fix.baseCommit, async (wt) => {
      const applied = await applyPatch(wt, fix.diff);
      if (applied.code !== 0) return errors.fail(`Patch no longer applies: ${applied.stderr.trim()}`, "branch_failed");
      await git(wt, ["add", "-A"]);
      const c = await git(wt, ["commit", "--quiet", "--no-verify", "-m", title, "-m", `${fix.summary}\n\nVerified by Repo Medic (fix ${fix.id}).`]);
      if (c.code !== 0) return errors.fail(`git commit failed: ${c.stderr.trim()}`, "branch_failed");
      const b = await git(wt, ["branch", "--force", branch, "HEAD"]);
      if (b.code !== 0) return errors.fail(`git branch failed: ${b.stderr.trim()}`, "branch_failed");
      return (await git(wt, ["rev-parse", "HEAD"])).stdout.trim();
    });

    const policy = pushAllowed(repo.source);
    let prUrl: string | null = null;
    if (policy.allowed) {
      const push = await git(repo.checkoutPath, ["push", "--quiet", "origin", `${branch}:${branch}`], 120_000);
      if (push.code !== 0) return errors.fail(`git push failed: ${push.stderr.trim().slice(0, 300)}`, "push_failed", { statusCode: 502 });
      const pr = await run(
        "gh",
        ["pr", "create", "--repo", repo.source, "--head", branch, "--base", repo.defaultBranch, "--title", title, "--body", body],
        { cwd: repo.checkoutPath, timeoutMs: 60_000 },
      );
      if (pr.code !== 0) return errors.fail(`gh pr create failed: ${pr.stderr.trim().slice(0, 300)}`, "push_failed", { statusCode: 502 });
      prUrl = pr.stdout.trim().split("\n").pop() ?? null;
    }

    const now = nowIso();
    const db = getDb();
    await db.update(fixes).set({ status: "pr_opened", branch, prUrl, updatedAt: now }).where(eq(fixes.id, fix.id));
    await db.update(findings).set({ status: "pr_opened", updatedAt: now }).where(eq(findings.id, finding.id));
    const verify = await git(repo.checkoutPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    const branchOk = verify.stdout.trim() === commit;
    const message = prUrl
      ? `Opened ${prUrl}`
      : `Committed ${commit.slice(0, 7)} on branch ${branch} (${policy.reason}).`;
    const _receipt: WriteReceipt = {
      changed: true,
      verified: branchOk,
      subject: `fix:${finding.id}`,
      summary: message.slice(0, 200),
      checks: [{ id: "branch", ok: branchOk, detail: `${branch} → ${commit.slice(0, 7)}` }],
    };
    return { id: fix.id, branch, commit, pushed: Boolean(prUrl), prUrl, title, body, message, _receipt };
  },
});
