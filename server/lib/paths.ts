import fs from "node:fs";
import path from "node:path";

import { config } from "./config.js";

/** Working data (clones, scratch worktrees). Git-ignored; never inside a scanned repo. */
export function dataDir(...parts: string[]): string {
  const root = config.dataDir ?? path.resolve(process.cwd(), ".repo-medic");
  const dir = path.join(root, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function rulesDir(): string {
  return config.rulesDir ?? path.resolve(process.cwd(), "scanners", "semgrep");
}

/**
 * Local directories Repo Medic may open. Defaults to the folder that contains
 * this app, so a sibling demo repo works out of the box; set
 * REPO_MEDIC_LOCAL_ROOTS (colon-separated) to widen or narrow it.
 */
export function allowedLocalRoots(): string[] {
  const configured = config.localRoots;
  const roots = configured
    ? configured.split(path.delimiter).filter(Boolean)
    : [path.resolve(process.cwd(), "..")];
  return roots.map((r) => path.resolve(r));
}

export function isInsideAllowedRoot(target: string, roots = allowedLocalRoots()): boolean {
  const resolved = path.resolve(target);
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/** Resolve a repo-relative path and refuse anything that escapes the repo. */
export function safeJoin(root: string, rel: string): string | null {
  const full = path.resolve(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}
