import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "../server/db/index.js";
import { findings } from "../server/db/schema.js";
import { OPEN_STATUSES } from "../server/lib/status.js";
import { loadFinding, loadRepo } from "../server/lib/store.js";
import { z } from "zod";

export default defineAction({
  description:
    "Read what the user is looking at: the current view, and on a triage board the repo, its open-card counts per column, and the finding open in the drawer. Basic navigation is already in <current-screen>; call this for the board details.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = (navigation ?? {}) as { repoId?: string; findingId?: string };
    if (nav.repoId) {
      try {
        const repo = await loadRepo(nav.repoId);
        const rows = await getDb()
          .select({ status: findings.status })
          .from(findings)
          .where(and(eq(findings.repoId, repo.id), inArray(findings.status, OPEN_STATUSES)));
        const columns: Record<string, number> = {};
        for (const r of rows) columns[r.status] = (columns[r.status] ?? 0) + 1;
        screen.board = { repoId: repo.id, repoName: repo.name, lastScannedAt: repo.lastScannedAt, openByStatus: columns };
      } catch {
        screen.board = { repoId: nav.repoId, unavailable: true };
      }
    }
    if (nav.findingId) {
      try {
        const { finding } = await loadFinding(nav.findingId);
        screen.openFinding = {
          id: finding.id,
          title: finding.title,
          severity: finding.severity,
          status: finding.status,
          location: finding.startLine ? `${finding.filePath}:${finding.startLine}` : finding.filePath,
        };
      } catch {
        screen.openFinding = { id: nav.findingId, unavailable: true };
      }
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
