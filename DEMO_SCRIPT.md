# Repo Medic: demo script (target 2:30–2:45, hard cap 3:00)

**Record with Builder.io Clips.** The hackathon FAQ says: "Every entry requires a demo recorded with Clips. A recording made with another tool does not replace this requirement." So the submission is a live Clips screen recording, not an uploaded ffmpeg file. Clips has no trim, so the take is fully scripted: lead-in and tail are under 3 s each.

Show the real app doing real work: no mock-ups and no edited-in results. The agent run, the checks and PR #2 are all live.

## How it runs

- **Screen:** the box desktop (Xvfb **1920×1200**, display `:20`), recorded by the Clips web recorder in Chrome with **Entire Screen**. No webcam, no mic.
- **One process does everything:** `video/drive_demo.py` draws the caption bar (from `narrator.py`) *and* performs every beat itself, so captions and actions can't drift apart.
  - The visible pointer moves and clicks with `xdotool` (real X input, so the recording shows it).
  - Page reads, scrolling and tab switches go over the Chrome DevTools Protocol on port 9242 of the already-open Chrome.
  - Waits watch the page: the Scan button returning, the XSS card appearing in **Fix ready**, the "Open pull request" link appearing.
  - Cues after the agent wait stretch or shrink (each between its `min` and 1.4 × `hold`) so the take lands near `cues.json` → `target_total` (165 s). A beat that fails is logged and the take continues.
- **No dragging needed:** every card has a **Move to…** menu (bottom-right icon, keyboard accessible). It goes through the same guarded move as drag-and-drop, so the dismiss-reason dialog and the "Fix ready is earned" refusal look identical. Real drag-and-drop still works for users.

## Reset the board (after every rehearsal or failed take)

```bash
cd repo-medic
COREPACK_HOME=$HOME/.cache/corepack AGENT_USER_EMAIL=dev@local.test AGENT_ORG_ID=b6597e8adcb547318236724e80090bba \
  pnpm -s action demo-snapshot --repoId 20fc0b86-f50a-4bcd-a7bf-0f11cb8acd2f --mode restore --confirm restore
```

Expected: `findings: { confirmed: 1, fix_ready: 2, new: 4, pr_opened: 1, resolved: 1 }` (New 4, Confirmed 1 = XSS, Fix ready 2, Branch/PR 1, Closed 1).

- `demo-snapshot` is CLI-only (`agentTool:false`, `mcpTool:false`, `http:false`), refuses in production, and needs editor access. `--mode save` takes a new snapshot into `data/demo-snapshots/` (gitignored); `--mode show` prints it.
- Restore only touches the database (findings, fixes, events, scans). It does not touch git or GitHub: a PR opened during a take stays open.

## Before the take

1. Dev server healthy on http://localhost:8080 (`tail /tmp/dev.log`), Builder.io connected.
2. Chrome on `:20` with remote debugging on 9242 and three tabs: the board (zoom **150%**), https://github.com/halfabillion/repo-medic/tree/main/actions, and the Clips recorder (signed in; screen only, camera and mic off).
3. Reset the board (above), then check: `cd video && .venv/bin/python drive_demo.py --prep`. It reloads the board, closes the drawer, agent panel and toasts, closes leftover demo-shop PR tabs, and prints `board ready: zoom 1.50, columns {...}, XSS in Confirmed`. Any problem is printed and it exits non-zero.

## The take (browser helper)

1. Start the driver (it waits invisibly): `cd video && .venv/bin/python drive_demo.py --start sharing`
2. In the Clips tab: **Start recording → Record without audio → Entire Screen → Share**.
3. Hands off. About 0.8 s after Chrome's "…is sharing your screen" bar appears, the driver brings the board to the front and runs every beat.
4. At the end the driver clicks **Stop sharing** itself (auto-stop). If the sharing bar is still there 3 s after the caption bar disappears, click **Stop sharing** by hand.

Manual start if the sharing bar isn't detected: `touch /tmp/narrator.go`. Abort: `touch /tmp/narrator.stop`. Timings are written to `video/cue_log.json`.

## Beats

| Cue | ~Start | Caption | Driver does |
| --- | --- | --- | --- |
| C01 | 0:00 | Security scanners are easy to run, and painful to act on. | Board visible, nothing open. |
| C02 | 0:06 | Repo Medic is a triage board where you and an AI agent fix findings together, and no fix counts until it proves it works. | Glides across the column headers. |
| C03 | 0:14 | Scan now runs Semgrep, gitleaks and osv-scanner on a deliberately vulnerable demo shop. | Clicks Scan now; waits for it to finish (max 20 s). |
| C04 | 0:22 | Re-scans update the existing cards instead of duplicating them. | Hovers two cards. |
| C05 | 0:27 | Triage stays human: closing a finding needs a written reason. | lodash card: Move to… → Closed; the Dismiss dialog opens; types "dev-only dependency"; Cancel. |
| C06 | 0:36 | Some columns are earned. Nobody, not me and not the agent, can move a card into Fix ready. | XSS card: Move to… → Fix ready; refusal toast; the card stays. |
| C07 | 0:44 | So let's hand this XSS finding to the agent. | Opens the XSS card; clicks Ask agent to fix; waits for the chat to confirm; opens the agent chat. |
| C08 | 0:50 | The agent reads the code and writes a patch. Then the patch is tested in a throwaway git worktree. | Points at the chat; the card shows "Agent working…". |
| C09 | 0:57 | Four checks: the patch applies · the tests pass · the scanner no longer finds it · nothing new appears. | — |
| C10 | 1:05 | Every attempt is on the record: who made it, which check failed, and why. | Opens the XSS card and scrolls to Activity. |
| C11 | 1:13 | The agent works in real time. Nothing in this video is sped up. | Closes the drawer; waits for the card to reach Fix ready (max 110 s). |
| C12 | ~1:17 | All four checks passed, so the card moved to Fix ready by itself. The UI and the agent share the same data. | Points at the card in Fix ready, opens it. |
| C13 | ~1:28 | Anything that leaves this machine needs my approval. | Clicks Create branch / PR; the approval dialog opens. |
| C14 | ~1:36 | Approve, and Repo Medic pushes a branch and opens a real pull request, only for allow-listed owners. | Clicks **Approve & create** (opens PR #2 on halfabillion/repo-medic-demo-shop); waits for the PR link (max 45 s). |
| C15 | ~1:47 | A real pull request on GitHub, with the verification results in its description. | Clicks Open pull request; scrolls to the checks table. |
| C16 | ~2:02 | Under the hood every button is an Agent-Native action. The UI, the agent, the CLI and MCP call the same code, so the same guard rails apply. | Switches to the actions-folder tab and scrolls it. |
| C17 | ~2:16 | Repo Medic: scanners for coverage, an agent for the busywork, verification for trust, and a human for the decisions. | Back to the board; collapses the chat. |
| C18 | ~2:28 | github.com/halfabillion/repo-medic  ·  built with Agent-Native | Holds still. |
| END | ~2:35 | (bar hidden) | Stops sharing. |

Times are from rehearsal 3 (agent took ~20 s; total 156 s). A slower agent pushes C12 onward later, and the later cues shrink to compensate; with a 50 s agent the take is about 2:45. If the agent goes past ~95 s the take can pass 3:00: abort, reset, and retake.

## After the take

1. Title: "Repo Medic: an agent-native triage board for security findings".
2. AI tools: turn on **Include full video** (the clip is silent).
3. Share: visibility **Public**, no password, no expiry. Check the link in a private window. Copy the URL into `SUBMISSION_FIELDS.md` → `clip_url`.
4. Reset the board. PR #2 stays open on the demo shop; it is part of the entry.

## If something goes wrong

- **The agent fails all its attempts or C11 times out:** the driver carries on, but the take is not usable. Abort (`touch /tmp/narrator.stop`), stop sharing, reset, retake. Don't fake it.
- **"The agent chat did not confirm the request":** the drawer shows an error with Try again. Abort and retake; this is the take-1 failure, now visible instead of silent.
- **`stale_base` on Create PR:** reset and retake (the scan at C03 refreshes the base).
- **"pushing is off":** the server was started without `REPO_MEDIC_ALLOW_PUSH` / `REPO_MEDIC_PR_OWNERS`.
- **A take opened PR #2 but failed afterwards:** PR #2 stays on GitHub. Ask Ali before closing it; the next take opens PR #3.

## Rehearsal (not for submission)

```bash
cd video
./record_screen.sh :20 raw/rehearsalN.mkv &      # ffmpeg x11grab + display audio
.venv/bin/python drive_demo.py --start now --rehearsal --voice
pkill -INT -f "ffmpeg.*rehearsalN.mkv"
```

`--rehearsal` clicks Cancel at C14 and shows PR #1 instead, so no PR is opened. Each rehearsal runs the agent once (about 0.1 free Builder credit). Reset the board afterwards.
