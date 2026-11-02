import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { run } from "./exec.js";
import { dataDir } from "./paths.js";

const GIT_IDENTITY = [
  "-c",
  "user.name=Repo Medic",
  "-c",
  "user.email=repo-medic@users.noreply.local",
  "-c",
  "commit.gpgsign=false",
];

export async function git(cwd: string, args: string[], timeoutMs = 60_000) {
  return run("git", [...GIT_IDENTITY, ...args], { cwd, timeoutMs });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const r = await git(dir, ["rev-parse", "--is-inside-work-tree"]);
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function headCommit(dir: string): Promise<string> {
  const r = await git(dir, ["rev-parse", "HEAD"]);
  if (r.code !== 0) throw new Error(`git rev-parse failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

export async function currentBranch(dir: string): Promise<string> {
  const r = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : "main";
}

/** A throwaway detached worktree at `commit`. Always call `dispose()`. */
export async function withWorktree<T>(
  repoDir: string,
  commit: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = path.join(dataDir("worktrees"), randomUUID());
  const add = await git(repoDir, ["worktree", "add", "--detach", "--quiet", dir, commit]);
  if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);
  try {
    return await fn(dir);
  } finally {
    await git(repoDir, ["worktree", "remove", "--force", dir]);
    fs.rmSync(dir, { recursive: true, force: true });
    await git(repoDir, ["worktree", "prune"]);
  }
}

/** Unified diff of every change (including new files) in a worktree. */
export async function worktreeDiff(dir: string): Promise<string> {
  await git(dir, ["add", "-A"]);
  const r = await git(dir, ["diff", "--cached", "--no-color", "--no-ext-diff"]);
  return r.stdout;
}

function writeTempPatch(diff: string): string {
  const file = path.join(dataDir("patches"), `${randomUUID()}.patch`);
  fs.writeFileSync(file, diff.endsWith("\n") ? diff : `${diff}\n`);
  return file;
}

/** Apply (or with check=true, only test) a unified diff. */
export async function applyPatch(dir: string, diff: string, check = false) {
  const file = writeTempPatch(diff);
  try {
    const args = ["apply", "--whitespace=nowarn", "--recount"];
    if (check) args.push("--check");
    args.push(file);
    return await git(dir, args);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** Files touched by a unified diff (b/ side). */
export function filesInDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split("\n")) {
    const m = /^\+\+\+ b\/(.+)$/.exec(line) ?? /^--- a\/(.+)$/.exec(line);
    if (m && m[1] !== "/dev/null") files.add(m[1]!.trim());
  }
  return [...files];
}

/** owner/name from a GitHub https URL, or null. */
export function parseGitHubUrl(url: string): { owner: string; name: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1]!, name: m[2]! };
}
