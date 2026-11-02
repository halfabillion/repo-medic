import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { useSyncExternalStore } from "react";

import type { Finding } from "./repo-medic";

/**
 * Tracks "Ask agent to fix" requests the chat has confirmed, so the card and drawer can show
 * "Agent working…" until a newer fix lands. Kept in sessionStorage so a reload keeps the state.
 */
const KEY = "repo-medic.agent-requests";
const EXPIRE_MS = 6 * 60_000;
const listeners = new Set<() => void>();

function read(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
let cache = read();
function write(next: Record<string, number>) {
  cache = next;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: in-memory state still works */
  }
  listeners.forEach((l) => l());
}

export function markAgentAsked(findingId: string) {
  write({ ...cache, [findingId]: Date.now() });
}
export function clearAgentAsked(findingId: string) {
  if (!(findingId in cache)) return;
  const { [findingId]: _gone, ...rest } = cache;
  write(rest);
}

export function useAgentAskedAt(findingId: string | undefined): number | null {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (findingId ? cache[findingId] ?? null : null),
    () => null,
  );
  return v && Date.now() - v < EXPIRE_MS ? v : null;
}

/** True while the agent has the request and no fix newer than the request has finished its checks. */
export function agentStillWorking(askedAt: number | null, fix: Finding["latestFix"]): boolean {
  if (!askedAt) return false;
  if (!fix) return true;
  const fresh = Date.parse(fix.updatedAt) >= askedAt - 1000;
  return !(fresh && fix.status !== "draft");
}

/**
 * Hand a message to the in-app agent chat and wait for the chat to confirm it took it.
 * sendToAgentChat is fire-and-forget: if the chat panel is still mounting it can drop the submit
 * silently (that is what happened in demo take 1). Retry once, then report the failure.
 */
export async function submitToAgentChat(message: string, context: string): Promise<{ delivered: boolean; reason?: string }> {
  let last: { delivered: boolean; reason?: string } = { delivered: false };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    last = await sendToAgentChatAndConfirm(
      { message, context, submit: true, openSidebar: true, chatTarget: "local", newTab: true },
      { timeoutMs: 15_000 },
    );
    if (last.delivered) return last;
  }
  return last;
}
