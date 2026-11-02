import { randomUUID } from "node:crypto";

import type { ActionRunContext } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { asc, eq } from "drizzle-orm";

import { getDb } from "../db/index.js";
import { EVENT_ACTORS, EVENT_KINDS, findingEvents } from "../db/schema.js";
import type { Check } from "./verify.js";
import type { FindingRow, FixRow } from "./store.js";
import { nowIso, parseJson } from "./store.js";

export type EventActor = (typeof EVENT_ACTORS)[number];
export type EventKind = (typeof EVENT_KINDS)[number];

const AGENT_CALLERS = new Set(["tool", "mcp", "webmcp", "a2a"]);

/** Who is calling: the agent (tool / MCP / A2A), an automation, or a person (UI, HTTP, CLI). */
export function actorFrom(ctx?: Pick<ActionRunContext, "caller" | "userEmail">): { actor: EventActor; actorLabel: string } {
  const caller = ctx?.caller;
  if (caller && AGENT_CALLERS.has(caller)) return { actor: "agent", actorLabel: "Agent" };
  if (caller === "automation") return { actor: "system", actorLabel: "Automation" };
  const email = ctx?.userEmail ?? getRequestUserEmail() ?? "someone";
  return { actor: "human", actorLabel: caller === "cli" ? `${email} (CLI)` : email };
}

export interface NewEvent {
  finding: Pick<FindingRow, "id" | "repoId" | "ownerEmail" | "orgId">;
  fixId?: string | null;
  actor: EventActor;
  actorLabel: string;
  kind: EventKind;
  ok?: boolean | null;
  summary: string;
  detail?: string[];
  at?: string;
}

/** Append one activity row. Logging never blocks or fails the action it describes. */
export async function recordEvent(e: NewEvent): Promise<void> {
  try {
    await getDb()
      .insert(findingEvents)
      .values({
        id: randomUUID(),
        findingId: e.finding.id,
        repoId: e.finding.repoId,
        fixId: e.fixId ?? null,
        actor: e.actor,
        actorLabel: e.actorLabel.slice(0, 200),
        kind: e.kind,
        ok: e.ok === undefined || e.ok === null ? null : e.ok ? 1 : 0,
        summary: e.summary.slice(0, 500),
        detail: JSON.stringify((e.detail ?? []).map((d) => d.slice(0, 600)).slice(0, 12)),
        createdAt: e.at ?? nowIso(),
        ownerEmail: e.finding.ownerEmail,
        orgId: e.finding.orgId,
      });
  } catch (err) {
    console.error("[repo-medic] could not record activity:", (err as Error)?.message ?? err);
  }
}

export const CHECK_NAMES: Record<string, string> = {
  patch_applies: "Patch applies",
  tests: "Project tests",
  finding_gone: "Finding gone on re-scan",
  no_new_issues: "No new issues",
};

/** "Project tests: 1 failing (expected 200, got 500)" for each failed check. */
export function failedCheckReasons(checks: Check[]): string[] {
  return checks.filter((c) => !c.ok && !c.skipped).map((c) => `${CHECK_NAMES[c.id] ?? c.id}: ${c.detail}`);
}

export interface TimelineEntry {
  id: string;
  at: string;
  actor: EventActor;
  actorLabel: string;
  kind: EventKind;
  ok: boolean | null;
  summary: string;
  detail: string[];
  fixId: string | null;
}

const SOURCE_ACTOR: Record<FixRow["source"], { actor: EventActor; actorLabel: string }> = {
  agent: { actor: "agent", actorLabel: "Agent" },
  human: { actor: "human", actorLabel: "Person" },
  autofix: { actor: "system", actorLabel: "Auto-fix" },
};

/**
 * Oldest-first activity for a finding. Fixes made before the log existed are
 * reconstructed from the fixes table (their checks keep the failure reasons).
 */
export async function timelineFor(finding: FindingRow, fixRows: FixRow[]): Promise<TimelineEntry[]> {
  const rows = await getDb()
    .select()
    .from(findingEvents)
    .where(eq(findingEvents.findingId, finding.id))
    .orderBy(asc(findingEvents.createdAt));
  const out: TimelineEntry[] = rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    actor: r.actor,
    actorLabel: r.actorLabel,
    kind: r.kind,
    ok: r.ok === null ? null : r.ok === 1,
    summary: r.summary,
    detail: parseJson<string[]>(r.detail, []),
    fixId: r.fixId,
  }));
  const logged = new Set(rows.map((r) => r.fixId).filter(Boolean));
  for (const fix of fixRows) {
    if (logged.has(fix.id)) continue;
    const who = SOURCE_ACTOR[fix.source];
    out.push({ id: `legacy-p-${fix.id}`, at: fix.createdAt, ...who, kind: "fix_proposed", ok: null, summary: fix.summary, detail: [], fixId: fix.id });
    const checks = parseJson<Check[]>(fix.checks, []);
    if (checks.length) {
      const passed = checks.every((c) => c.ok || c.skipped);
      out.push({
        id: `legacy-t-${fix.id}`,
        at: fix.createdAt,
        actor: who.actor,
        actorLabel: who.actorLabel,
        kind: passed ? "fix_passed" : "fix_failed",
        ok: passed,
        summary: passed ? "All checks passed" : "Verification failed",
        detail: passed ? [] : failedCheckReasons(checks),
        fixId: fix.id,
      });
    }
  }
  if (!out.some((e) => e.kind === "detected")) {
    out.push({ id: `legacy-d-${finding.id}`, at: finding.createdAt, actor: "system", actorLabel: finding.tool, kind: "detected", ok: null, summary: `Found by ${finding.tool}`, detail: [], fixId: null });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || order(a) - order(b));
}

function order(e: TimelineEntry): number {
  return e.kind === "detected" ? 0 : e.kind === "fix_proposed" ? 1 : 2;
}
