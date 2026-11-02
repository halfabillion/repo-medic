import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { repoShares, repos } from "../server/db/schema.js";
import { repoSchema, toRepo } from "../server/lib/dto.js";
import { currentBranch, git, isGitRepo, parseGitHubUrl } from "../server/lib/git.js";
import { allowedLocalRoots, dataDir, isInsideAllowedRoot } from "../server/lib/paths.js";
import { nowIso, requireOwner } from "../server/lib/store.js";

const errors = defineActionErrors(
  "invalid_source",
  "path_not_allowed",
  "not_a_git_repo",
  "clone_failed",
  "repo_exists",
  "unauthenticated",
);

export default defineAction({
  description:
    "Add a repository to Repo Medic from a local git checkout path or a public https://github.com/owner/repo URL (shallow-cloned). Returns the repo; call scan-repo next.",
  schema: z.object({
    source: z
      .string()
      .min(1)
      .describe("Absolute path to a local git repo, or an https://github.com/<owner>/<repo> URL"),
    name: z.string().max(100).optional().describe("Display name; defaults to the folder or repo name"),
  }),
  outputSchema: z.object({ id: z.string(), repo: repoSchema, nextRequiredAction: z.literal("scan-repo") }),
  errors,
  link: ({ result }) => ({ url: `/repos/${result.id}`, label: "Open board" }),
  run: async (args) => {
    const { ownerEmail, orgId } = requireOwner();
    const db = getDb();
    const source = args.source.trim();
    const gh = parseGitHubUrl(source);

    let sourceKind: "local" | "github";
    let checkoutPath: string;
    let normalizedSource: string;
    let defaultName: string;

    if (gh) {
      sourceKind = "github";
      normalizedSource = `https://github.com/${gh.owner}/${gh.name}`;
      defaultName = `${gh.owner}/${gh.name}`;
      checkoutPath = "";
    } else if (path.isAbsolute(source)) {
      sourceKind = "local";
      const resolved = fs.existsSync(source) ? fs.realpathSync(source) : path.resolve(source);
      if (!isInsideAllowedRoot(resolved)) {
        return errors.noWrite(
          `Local repos must live under ${allowedLocalRoots().join(", ")} (set REPO_MEDIC_LOCAL_ROOTS to change this).`,
          "path_not_allowed",
          { statusCode: 403 },
        );
      }
      if (!fs.existsSync(resolved) || !(await isGitRepo(resolved))) {
        return errors.noWrite(`${resolved} is not a git repository.`, "not_a_git_repo");
      }
      normalizedSource = resolved;
      checkoutPath = resolved;
      defaultName = path.basename(resolved);
    } else {
      return errors.noWrite("Give an absolute local path or an https://github.com/owner/repo URL.", "invalid_source");
    }

    const existing = await db
      .select({ id: repos.id })
      .from(repos)
      .where(and(eq(repos.source, normalizedSource), accessFilter(repos, repoShares)))
      .limit(1);
    if (existing[0]) {
      return errors.noWrite("That repository is already in Repo Medic.", "repo_exists", {
        statusCode: 409,
        details: { id: existing[0].id },
      });
    }

    const id = randomUUID();
    if (sourceKind === "github") {
      checkoutPath = path.join(dataDir("clones"), id);
      const clone = await git(dataDir("clones"), ["clone", "--depth", "50", "--quiet", normalizedSource, checkoutPath], 180_000);
      if (clone.code !== 0) {
        fs.rmSync(checkoutPath, { recursive: true, force: true });
        return errors.noWrite(`git clone failed: ${clone.stderr.trim().slice(0, 300)}`, "clone_failed", { statusCode: 502 });
      }
    }

    const row = {
      id,
      name: args.name?.trim() || defaultName,
      source: normalizedSource,
      sourceKind,
      checkoutPath,
      defaultBranch: await currentBranch(checkoutPath),
      createdAt: nowIso(),
      ownerEmail,
      orgId,
    };
    await db.insert(repos).values(row);
    const [saved] = await db.select().from(repos).where(eq(repos.id, id));
    return { id, repo: toRepo(saved!), nextRequiredAction: "scan-repo" as const };
  },
});
