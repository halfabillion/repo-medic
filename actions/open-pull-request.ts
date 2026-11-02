import { defineAction, defineActionErrors, type WriteReceipt } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findings, fixes } from "../server/db/schema.js";
import { config } from "../server/lib/config.js";
import { run } from "../server/lib/exec.js";
import { applyPatch, git, parseGitHubUrl, withWorktree } from "../server/lib/git.js";
import { branchNameFor, prBodyFor, prTitleFor } from "../server/lib/pr.js";
import { actorFrom, recordEvent } from "../server/lib/events.js";
import { loadFix, nowIso, parseJson, type RepoRow } from "../server/lib/store.js";
import type { Check } from "../server/lib/verify.js";

const errors = defineActionErrors("not_found", "forbidden", "fix_not_verified", "stale_base", "branch_failed", "push_failed");

/** The GitHub repo a branch would go to: the source URL, or a local checkout's `origin` remote. */
async function githubTarget(repo: RepoRow): Promise<{ owner: string; name: string } | null> {
  const direct = parseGitHubUrl(repo.source);
  if (direct) return direct;
  const origin = await git(repo.checkoutPath, ["remote", "get-url", "origin"]);
  if (origin.code !== 0) return null;
  const url = origin.stdout.trim().replace(/^git@github\.com:/, "https://github.com/");
  return parseGitHubUrl(url);
}

function pushAllowed(gh: { owner: string; name: string } | null): { allowed: boolean; reason: string } {
  if (!gh) return { allowed: false, reason: "no GitHub remote: branch created locally, nothing pushed" };
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
  run: async (args, ctx) => {
    const { fix, finding, repo } = await loadFix(args.id, "editor");
    if (fix.status !== "passed") {
      return errors.noWrite("Only a fix that passed test-fix can become a pull request. Run test-fix first.", "fix_not_verified", {
        statusCode: 409,
      });
    }
    // The branch is cut from the commit the fix was verified on, so that commit must still be in the repo's history.
    const ancestor = await git(repo.checkoutPath, ["merge-base", "--is-ancestor", fix.baseCommit, "HEAD"]);
    if (ancestor.code !== 0) {
      return errors.noWrite(
        `This fix was verified against ${fix.baseCommit.slice(0, 7)}, which is no longer in the repository's history. Re-scan, then propose and verify the fix again.`,
        "stale_base",
        { statusCode: 409 },
      );
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

    const who = actorFrom(ctx);
    const target = await githubTarget(repo);
    const policy = pushAllowed(target);
    let prUrl: string | null = null;
    if (policy.allowed && target) {
      const slug = `${target.owner}/${target.name}`;
      const push = await git(repo.checkoutPath, ["push", "--quiet", `https://github.com/${slug}.git`, `${branch}:refs/heads/${branch}`], 120_000);
      if (push.code !== 0) {
        const reason = `git push failed: ${push.stderr.trim().slice(0, 300)}`;
        await recordEvent({ finding, fixId: fix.id, ...who, kind: "pr_failed", ok: false, summary: `Committed ${commit.slice(0, 7)} on ${branch}, but the push failed`, detail: [reason] });
        return errors.fail(reason, "push_failed", { statusCode: 502 });
      }
      const pr = await run(
        "gh",
        ["pr", "create", "--repo", slug, "--head", branch, "--base", repo.defaultBranch, "--title", title, "--body", body],
        { cwd: repo.checkoutPath, timeoutMs: 60_000 },
      );
      if (pr.code !== 0) {
        const reason = `gh pr create failed: ${pr.stderr.trim().slice(0, 300)}`;
        await recordEvent({ finding, fixId: fix.id, ...who, kind: "pr_failed", ok: false, summary: `Pushed ${branch}, but opening the PR failed`, detail: [reason] });
        return errors.fail(reason, "push_failed", { statusCode: 502 });
      }
      prUrl = pr.stdout.trim().split("\n").pop() ?? null;
    }

    const now = nowIso();
    const db = getDb();
    await db.update(fixes).set({ status: "pr_opened", branch, prUrl, updatedAt: now }).where(eq(fixes.id, fix.id));
    await db.update(findings).set({ status: "pr_opened", updatedAt: now }).where(eq(findings.id, finding.id));
    await recordEvent({
      finding,
      fixId: fix.id,
      ...who,
      kind: prUrl ? "pr_opened" : "branch_created",
      ok: true,
      summary: prUrl ? `Approved and opened a pull request on ${target!.owner}/${target!.name}` : `Approved: committed ${commit.slice(0, 7)} on ${branch}`,
      detail: prUrl ? [prUrl, `Branch ${branch} @ ${commit.slice(0, 7)}`] : [policy.reason],
      at: now,
    });
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
