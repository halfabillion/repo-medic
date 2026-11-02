# Repo Medic

**An agent-native security triage board.** Point it at a repository; it runs real scanners, puts every finding on a board, and turns the ones that matter into fixes that are *proven* to work — the patch applies, the project's tests pass, the scanner no longer reports the issue, and nothing new appears. You and the agent work the same board through the same actions.

Built on [Agent-Native](https://agent-native.com) (`@agent-native/core`, chat template) for the Builder.io Agent-Native hackathon.

![Triage board](docs/03-board.png)

## What it does

1. **Scan** — `scan-repo` runs three free, open-source scanners in parallel and normalises their output:
   - [Semgrep](https://semgrep.dev) with a small rule pack (`scanners/semgrep/`) for SQL injection, XSS, command injection, `eval`, weak hashes and predictable tokens;
   - [gitleaks](https://github.com/gitleaks/gitleaks) for hard-coded secrets (secrets are redacted before they are stored);
   - [osv-scanner](https://github.com/google/osv-scanner) for vulnerable dependencies, rolled up to one card per package with the smallest version that fixes every advisory.
   Findings are fingerprinted, so re-scans update cards instead of duplicating them, close what is gone, and reopen what came back.
2. **Triage** — drag cards between *New*, *Confirmed* and *Closed*. Dismissing always asks for a reason, which stays on the card.
3. **Fix** — three ways, all ending in the same verification:
   - **Auto-fix & verify**: deterministic rewrites from the Semgrep rules, or a dependency bump that skips deprecated releases (e.g. lodash 4.18.0 is deprecated upstream, so it picks 4.18.1);
   - **Ask agent to fix**: hands the card to the agent, which reads the code, writes a diff, verifies it, and retries (up to 3 times) when a check fails;
   - any diff from you via `propose-fix`.
4. **Verify** — `test-fix` checks the patch in a throwaway git worktree: *patch applies → tests pass → finding gone on re-scan → no new issues*. Only a fully green fix moves the card to **Fix ready**. Columns like *Fix ready* and *Branch / PR* are earned — neither you nor the agent can drag a card there.
5. **Ship** — `open-pull-request` (needs approval) commits the verified patch to a `repo-medic/…` branch with a PR-ready title and a verification table. Pushing and opening a PR is off unless explicitly enabled for named GitHub owners.

## Agent-native by design

| | |
| --- | --- |
| **One action layer** | Every UI button calls an action in `actions/`; the agent calls the same ones as tools, and the CLI/HTTP/MCP surfaces get them for free. |
| **Shared screen state** | The board publishes `view`, `repoId` and the open `findingId`; `view-screen` adds column counts and the open card, so "fix this one" just works. `navigate` lets the agent open a card for you. |
| **Receipts** | Writes return a `_receipt` (what changed, what was verified) and `nextRequiredAction`, so the agent always knows the next step. |
| **Guard rails in the action, not the prompt** | Earned statuses, dismiss reasons, approval for branches/PRs, path allow-lists and diff-size limits are enforced server-side for every caller. |

## Actions

| Action | Purpose |
| --- | --- |
| `add-repo` | Add a local git checkout (inside the allowed roots) or a public GitHub URL (shallow clone). |
| `list-repos` | Repos with open counts by severity and the last scan per tool. |
| `scan-repo` | Run the scanners, upsert findings, resolve/reopen. |
| `list-findings` / `get-finding` | Filter the board; read a finding with code context and fix history. |
| `update-finding` | Move between New / Confirmed / Dismissed, change severity, add a note. |
| `propose-fix` | Store a diff (yours or the agent's) or generate the built-in autofix. |
| `test-fix` | Run the four checks in a clean worktree. |
| `open-pull-request` | Commit a verified fix to a branch; optionally push and open a PR. Requires approval. |

## Run it locally

Prerequisites: Node 22+, pnpm (via corepack), git, and the scanners on `PATH`: `semgrep`, `gitleaks`, `osv-scanner`.

```bash
pnpm install
pnpm dev            # http://localhost:8080 → "Continue as local dev"
```

Add the demo repo (`../demo-vuln-shop`, a deliberately vulnerable Express app with 8 planted issues) from the Repositories page, or from the CLI:

```bash
export AGENT_USER_EMAIL=dev@local.test     # the local-dev UI user
export AGENT_ORG_ID=<org id>               # that user's workspace, so the CLI sees the same board
pnpm action add-repo --source "$(realpath ../demo-vuln-shop)"
pnpm action scan-repo --repoId <repo id>
pnpm action propose-fix --findingId <finding id>     # built-in autofix, or pass --diff
pnpm action test-fix --id <fix id>
```

The chat agent needs a model: click **Connect AI** in the agent panel and choose *Use Builder.io* or *Custom keys* (e.g. a Gemini, Groq or OpenRouter key). Everything except the chat works without one.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `REPO_MEDIC_LOCAL_ROOTS` | parent of the app | Colon-separated directories local repos may live in. |
| `REPO_MEDIC_RUN_UNTRUSTED_TESTS` | off | Run `npm test` for repos cloned from GitHub (local repos always run tests). |
| `REPO_MEDIC_ALLOW_PUSH` / `REPO_MEDIC_PR_OWNERS` | off / empty | Allow `git push` + `gh pr create`, only for these GitHub owners. |

## Development

```bash
pnpm test                 # vitest: scanner parsers (real fixtures), status rules, autofix, git/path safety, PR text
pnpm typecheck
pnpm agent-native:doctor  # framework guards
```

Code map: `server/lib/scanners/` (run + normalise), `server/lib/autofix.ts`, `server/lib/verify.ts`, `server/lib/git.ts` (worktrees), `server/lib/status.ts` (triage rules), `app/components/repos/` (board, card, drawer).

## Limits (honest list)

- JavaScript/TypeScript + npm only for autofix and test runs; the scanners themselves cover more.
- Tests run on the host in a worktree, not in a sandbox — which is why untrusted (cloned) repos don't run tests unless you opt in.
- Transitive dependency findings get advice (use `overrides`) rather than an automatic bump.
- Leaked secrets are never auto-fixed: the key must be rotated by a human.

## Credits

Scaffolded with `npx @agent-native/core create --template chat` (Agent-Native framework and template files are © their authors). Scanners: Semgrep, gitleaks, osv-scanner. See `BUILD_LOG.md` for exactly what was written during the hackathon.
