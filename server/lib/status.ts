/**
 * Triage rules shared by the board, the agent and the CLI.
 * People (and the agent acting for them) move cards between New, Confirmed
 * and Dismissed. "Fix ready", "PR opened" and "Resolved" are earned: only a
 * passing test-fix, an opened PR or a clean re-scan can put a card there.
 */
export type FindingStatus = "new" | "confirmed" | "fix_ready" | "pr_opened" | "resolved" | "dismissed";

export const MANUAL_STATUSES = ["new", "confirmed", "dismissed"] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export type TransitionCheck =
  | { ok: true }
  | { ok: false; errorCode: "invalid_transition" | "reason_required"; message: string };

export function checkManualTransition(
  from: FindingStatus,
  to: FindingStatus,
  dismissReason: string | null | undefined,
): TransitionCheck {
  if (!(MANUAL_STATUSES as readonly string[]).includes(to)) {
    return {
      ok: false,
      errorCode: "invalid_transition",
      message:
        to === "fix_ready"
          ? "A finding becomes Fix ready only when test-fix passes. Call propose-fix, then test-fix."
          : to === "pr_opened"
            ? "A finding moves to PR opened only through open-pull-request."
            : "A finding is Resolved only when a re-scan no longer reports it. Fix it, then run scan-repo.",
    };
  }
  if (from === "resolved" && to !== "dismissed") {
    return { ok: false, errorCode: "invalid_transition", message: "Resolved findings reopen automatically if a scan sees them again." };
  }
  if (to === "dismissed" && !dismissReason?.trim()) {
    return { ok: false, errorCode: "reason_required", message: "Say why you are dismissing it (for example: false positive, test fixture, accepted risk)." };
  }
  return { ok: true };
}

/** Status a finding takes when a scan sees it again. */
export function statusOnRescan(current: FindingStatus): FindingStatus {
  return current === "resolved" ? "new" : current;
}

/** Statuses that count as "open" (a scan that no longer sees them resolves them). */
export const OPEN_STATUSES: FindingStatus[] = ["new", "confirmed", "fix_ready", "pr_opened"];
