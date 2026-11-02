/**
 * Deploy-level operator settings. None of these are credentials: they choose
 * paths and safety switches for the whole deployment, so they are read from
 * the environment in exactly one place.
 */
const env = process.env;

export const config = {
  /** Extra directory searched for scanner binaries. */
  toolsDir: env.REPO_MEDIC_TOOLS_DIR, // guard:allow-env-credential — deploy-level setting, not a credential
  /** Inherited search path for scanners and git. */
  path: env.PATH, // guard:allow-env-credential — process search path, not a credential
  /** Home directory (git/npm/semgrep config). */
  home: env.HOME, // guard:allow-env-credential — home directory path, not a credential
  dataDir: env.REPO_MEDIC_DATA_DIR, // guard:allow-env-credential — deploy-level setting, not a credential
  rulesDir: env.REPO_MEDIC_RULES_DIR, // guard:allow-env-credential — deploy-level setting, not a credential
  /** Colon-separated directories local repos may be added from. */
  localRoots: env.REPO_MEDIC_LOCAL_ROOTS, // guard:allow-env-credential — deploy-level setting, not a credential
  /** "1" lets test-fix execute tests of repos cloned from GitHub. Off by default. */
  runUntrustedTests: env.REPO_MEDIC_RUN_UNTRUSTED_TESTS === "1", // guard:allow-env-credential — safety switch, not a credential
  /** "1" lets open-pull-request push branches. Off by default. */
  allowPush: env.REPO_MEDIC_ALLOW_PUSH === "1", // guard:allow-env-credential — safety switch, not a credential
  /** Comma-separated GitHub owners Repo Medic may open PRs against. */
  prOwners: (env.REPO_MEDIC_PR_OWNERS ?? "") // guard:allow-env-credential — safety allowlist, not a credential
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};
