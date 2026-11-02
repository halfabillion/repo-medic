# Build log — Repo Medic (Builder.io Agent-Native hackathon)

All project code was written on **2 Nov 2026** (Europe/London), after the hackathon start (27 Oct 2026). No code was reused from earlier projects.

## Third-party starting point (not our work)

- `npx @agent-native/core create --standalone --template chat` (core 0.222.2) → git commit `c517669` "Initial commit from agent-native create", 2026-11-02 00:12 UTC. Every file in that commit is framework/template code.
- `pnpm-workspace.yaml`: one-line change so the optional `node-pty` native build is skipped (no compiler needed on the build box).
- Open-source scanners used as external binaries, not vendored: Semgrep 1.183.0, gitleaks 8.28.0, osv-scanner 2.2.2.
- `app/components/ui/{alert-dialog,badge,dialog,empty,select,spinner,tabs,textarea}.tsx` are one-line re-exports of `@agent-native/toolkit` components.

## Written during the hackathon

### Server
| File | What |
| --- | --- |
| `server/db/schema.ts`, `server/db/index.ts`, `server/plugins/db.ts` | Tables: repos, repo_shares, scans, findings, fixes; migration v1. |
| `server/lib/config.ts`, `paths.ts`, `exec.ts` | Single env read point; data dir, allowed roots, safe path joins; process runner with timeouts and output caps. |
| `server/lib/git.ts` | Throwaway worktrees, diff/apply, GitHub URL parsing. |
| `server/lib/scanners/{types,normalize,run}.ts` | Run semgrep/gitleaks/osv-scanner in parallel; normalise, fingerprint, redact secrets, compute minimum safe version. |
| `server/lib/autofix.ts` | Semgrep autofix in a worktree; npm dependency bump that skips deprecated/prerelease versions. |
| `server/lib/verify.ts` | Four-check verification (applies, tests, finding gone, no new issues). |
| `server/lib/status.ts`, `store.ts`, `dto.ts`, `pr.ts` | Triage rules (earned statuses), access checks, output schemas, branch/PR text. |
| `scanners/semgrep/repo-medic-js.yml`, `scanners/gitleaks.toml` | Rule pack with autofixes and fix summaries; gitleaks allowlist. |

### Actions (`actions/`)
`add-repo`, `list-repos`, `scan-repo`, `list-findings`, `get-finding`, `update-finding`, `propose-fix`, `test-fix`, `open-pull-request` (new). Edited template actions: `navigate` (board/repo/finding params), `view-screen` (board column counts + open finding).

### UI
| File | What |
| --- | --- |
| `app/routes/repos._index.tsx` | Repository list, add-and-scan form, empty state. |
| `app/routes/repos.$repoId.tsx` | Triage board page: scan button, last-scan line, severity/scanner filters, drawer via `?finding=`. |
| `app/components/repos/*` | FindingBoard (drag & drop, optimistic moves with rollback, earned columns), FindingCard, FindingDrawer (code context, fix actions, checks, diff, approval dialog), DismissDialog, DiffView, SeverityBadge. |
| `app/lib/repo-medic.ts` | Board columns, labels, agent hand-off message. |
| Edited template files | `Sidebar.tsx` (Repositories link), `use-navigation-state.ts` (repo/finding state), `en-US.ts` (agent suggestions), `agent-chat.ts` (tools + system prompt), `agent-native-email-branding.ts` (home path), `AGENTS.md` (Repo Medic section), `.gitignore`. |

### Tests & docs
- `tests/normalize.test.ts`, `tests/status.test.ts`, `tests/fixes.test.ts` (34 tests); fixtures in `server/lib/scanners/__fixtures__/` captured from real scanner runs on the demo repo (osv fixture trimmed of long text fields).
- `README.md` (replaces the template README; original at upstream), `BUILD_LOG.md`, `docs/*.png` screenshots.

### Demo repository
`../demo-vuln-shop` — new, written for this project (commit `1cf4538`, 2026-11-02 00:16 UTC): small Express-style shop with 8 deliberately planted issues and 7 node:test tests. Its API key is fake. The `repo-medic/weak-password-hash-45865a32` branch in it was created by Repo Medic during the UI smoke test.
