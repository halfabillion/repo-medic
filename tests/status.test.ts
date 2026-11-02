import { describe, expect, it } from "vitest";

import { checkManualTransition, OPEN_STATUSES, statusOnRescan } from "../server/lib/status";

describe("checkManualTransition", () => {
  it("allows triage moves between New and Confirmed", () => {
    expect(checkManualTransition("new", "confirmed", null)).toEqual({ ok: true });
    expect(checkManualTransition("confirmed", "new", null)).toEqual({ ok: true });
  });

  it("requires a reason to dismiss", () => {
    expect(checkManualTransition("new", "dismissed", "  ")).toMatchObject({ ok: false, errorCode: "reason_required" });
    expect(checkManualTransition("new", "dismissed", "test fixture")).toEqual({ ok: true });
  });

  it.each(["fix_ready", "pr_opened", "resolved"] as const)("refuses to set earned status %s by hand", (to) => {
    expect(checkManualTransition("confirmed", to, null)).toMatchObject({ ok: false, errorCode: "invalid_transition" });
  });

  it("does not let a resolved finding be reopened by hand", () => {
    expect(checkManualTransition("resolved", "new", null)).toMatchObject({ ok: false });
  });
});

describe("statusOnRescan", () => {
  it("reopens resolved findings and leaves the rest", () => {
    expect(statusOnRescan("resolved")).toBe("new");
    expect(statusOnRescan("dismissed")).toBe("dismissed");
    expect(statusOnRescan("fix_ready")).toBe("fix_ready");
  });

  it("treats dismissed and resolved as closed", () => {
    expect(OPEN_STATUSES).not.toContain("dismissed");
    expect(OPEN_STATUSES).not.toContain("resolved");
  });
});
