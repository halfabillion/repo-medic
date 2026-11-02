# Repo Medic: demo script (target 2:30, hard cap 3:00)

Record with **Builder.io Clips** (https://clips.agent-native.com). The hackathon requires a Clips recording; a video made with another tool does not count. When done, open **Share**, set visibility to **Public**, no password and no expiry, then open the link in a private/incognito window to check it plays without a login.

Rules to respect on camera: show the real app doing real work. No mock-ups, no edited-in results ("fabricated demonstrations" can be disqualified). If something fails live, keep it if it's short; the retry story is the point.

## Before you hit record (5 minutes)

1. `pnpm dev` is running on http://localhost:8080 with `REPO_MEDIC_ALLOW_PUSH=1` and `REPO_MEDIC_PR_OWNERS=halfabillion` in `.env` (restart the server once after adding them).
2. The board shows **demo-vuln-shop** scanned at its current commit. Close the drawer, collapse the agent panel, browser zoom 110%, hide bookmarks.
3. Open a second tab on https://github.com/halfabillion/repo-medic-demo-shop/pulls.
4. Agent is connected (Builder.io). One "Ask agent to fix" costs about 0.1 credit and ~50 s, so do one dry run at most.
5. Mic check; close notifications.

## Script

| Time | Screen | Say (roughly) |
| --- | --- | --- |
| 0:00–0:15 | Board, full view | "Scanners are easy to run and painful to act on. Repo Medic is a triage board where I and an AI agent fix security findings together, and no fix counts until it proves it works." |
| 0:15–0:35 | Click **Scan**; cards update; point at the three scanner badges | "It runs Semgrep, gitleaks and osv-scanner on a deliberately vulnerable shop: SQL injection, XSS, command injection, a leaked key, a vulnerable lodash. Re-scans update cards instead of duplicating them." |
| 0:35–0:55 | Drag one card to **Confirmed**; start dismissing another, show the reason box, cancel | "I stay in charge of triage. Dismissing needs a reason, and some columns are earned: nobody, not me and not the agent, can drag a card into *Fix ready*." |
| 0:55–1:40 | Open **HTML response built from input** → **Ask agent to fix**. While it works, scroll to **Activity** | "I hand this one to the agent. It reads the code, writes a patch, and has to pass four checks in a throwaway worktree: applies, tests pass, the scanner no longer finds it, nothing new appears. Here's the history from an earlier run: its first patch fixed the line but introduced a new XSS two lines down, so verification rejected it. The second broke a test. The third passed. Every attempt is on the record, with who did it and why it failed." When the live run finishes: "And the card moves to *Fix ready* on its own; the UI and the agent share the same data." |
| 1:40–2:15 | In the drawer: **Create branch / PR** → dialog → **Approve & create**. Click the PR link; show the PR body on GitHub | "Anything that leaves my machine needs my approval. Approve, and Repo Medic pushes a branch and opens a real pull request, with the verification table in the description. Pushing only works for owners I've allow-listed." |
| 2:15–2:35 | Terminal: `pnpm action get-finding --id …` (or show the actions folder) | "Under the hood every button is an Agent-Native action. The UI, the agent, the CLI and MCP all call the same code, so the guard rails apply to everyone." |
| 2:35–2:45 | Back to the board | "Repo Medic: scanners for coverage, an agent for the busywork, verification for trust, and a human for the decisions. Code's on GitHub." |

## If something goes wrong

- **The agent passes on its first try:** fine. Say "this time it got it first time; here's an earlier run where it didn't" and point at the older attempts in the timeline (they are real, logged runs).
- **`stale_base` error on Create PR:** the fix was verified against an older commit. Click **Scan**, then ask for the fix again.
- **"pushing is off":** the server was started without the two `REPO_MEDIC_*` variables. Restart it and retry.
- **Over 3:00:** cut the CLI segment first, then the dismiss dialog.
