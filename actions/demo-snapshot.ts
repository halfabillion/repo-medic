import fs from "node:fs";
import path from "node:path";

import { defineAction, defineActionErrors } from "@agent-native/core/action";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findingEvents, findings, fixes, repos, scans } from "../server/db/schema.js";
import { loadRepo } from "../server/lib/store.js";

/**
 * Save or restore a repo's board (findings, fixes, activity, scans) so a demo can be rehearsed and
 * then put back exactly as it was. Local development only, CLI only: hidden from the in-app agent,
 * from MCP and from HTTP, and refused in production. Nothing outside the local database is touched
 * (no git branches, no GitHub).
 */
const errors = defineActionErrors("forbidden", "not_found", "no_snapshot");

const SNAPSHOT_DIR = path.resolve("data", "demo-snapshots");
const fileFor = (repoId: string) => path.join(SNAPSHOT_DIR, `${repoId.replace(/[^a-zA-Z0-9-]/g, "")}.json`);

type Snapshot = {
  takenAt: string;
  repo: typeof repos.$inferSelect;
  findings: (typeof findings.$inferSelect)[];
  fixes: (typeof fixes.$inferSelect)[];
  events: (typeof findingEvents.$inferSelect)[];
  scanIds: string[];
};

export default defineAction({
  description:
    "Development only: save the board of one repo to data/demo-snapshots, or restore it (deletes fixes, activity and scans added since, and puts findings and fixes back). For rehearsing demos.",
  schema: z.object({
    repoId: z.string(),
    mode: z.enum(["save", "restore", "show"]),
    confirm: z.string().optional().describe('Must be "restore" to restore'),
  }),
  agentTool: false,
  mcpTool: false,
  http: false,
  errors,
  run: async (args) => {
    if (process.env.NODE_ENV === "production") {
      return errors.noWrite("demo-snapshot is for local development only.", "forbidden", { statusCode: 403 });
    }
    const repo = await loadRepo(args.repoId, "editor");
    const db = getDb();
    const file = fileFor(repo.id);

    if (args.mode === "save") {
      const snap: Snapshot = {
        takenAt: new Date().toISOString(),
        repo,
        findings: await db.select().from(findings).where(eq(findings.repoId, repo.id)),
        fixes: await db.select().from(fixes).where(eq(fixes.repoId, repo.id)),
        events: await db.select().from(findingEvents).where(eq(findingEvents.repoId, repo.id)),
        scanIds: (await db.select({ id: scans.id }).from(scans).where(eq(scans.repoId, repo.id))).map((s) => s.id),
      };
      fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(snap, null, 1));
      return { saved: file, findings: snap.findings.length, fixes: snap.fixes.length, events: snap.events.length };
    }

    if (!fs.existsSync(file)) return errors.noWrite(`No snapshot at ${file}; run with --mode save first.`, "no_snapshot");
    const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
    const counts = (rows: { status: string }[]) =>
      rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
    if (args.mode === "show") {
      return { file, takenAt: snap.takenAt, findings: counts(snap.findings), fixes: snap.fixes.length, events: snap.events.length };
    }
    if (args.confirm !== "restore") {
      return errors.noWrite('Pass --confirm restore to overwrite the board with the snapshot.', "forbidden");
    }

    const keep = <T extends { id: string }>(rows: T[]) => (rows.length ? rows.map((r) => r.id) : ["__none__"]);
    const removed = {
      events: (await db.delete(findingEvents).where(and(eq(findingEvents.repoId, repo.id), notInArray(findingEvents.id, keep(snap.events)))).returning({ id: findingEvents.id })).length,
      fixes: (await db.delete(fixes).where(and(eq(fixes.repoId, repo.id), notInArray(fixes.id, keep(snap.fixes)))).returning({ id: fixes.id })).length,
      findings: (await db.delete(findings).where(and(eq(findings.repoId, repo.id), notInArray(findings.id, keep(snap.findings)))).returning({ id: findings.id })).length,
      scans: (await db.delete(scans).where(and(eq(scans.repoId, repo.id), notInArray(scans.id, snap.scanIds.length ? snap.scanIds : ["__none__"]))).returning({ id: scans.id })).length,
    };
    for (const f of snap.findings) {
      const { id, ...rest } = f;
      const [row] = await db.select({ id: findings.id }).from(findings).where(eq(findings.id, id));
      if (row) await db.update(findings).set(rest).where(eq(findings.id, id));
      else await db.insert(findings).values(f);
    }
    for (const x of snap.fixes) {
      const { id, ...rest } = x;
      await db.update(fixes).set(rest).where(eq(fixes.id, id));
    }
    const existingEvents = new Set(
      (await db.select({ id: findingEvents.id }).from(findingEvents).where(inArray(findingEvents.id, keep(snap.events)))).map((e) => e.id),
    );
    for (const e of snap.events) if (!existingEvents.has(e.id)) await db.insert(findingEvents).values(e);
    await db.update(repos).set({ lastScanId: snap.repo.lastScanId, lastScannedAt: snap.repo.lastScannedAt }).where(eq(repos.id, repo.id));
    const now = await db.select({ status: findings.status }).from(findings).where(eq(findings.repoId, repo.id));
    return { restoredFrom: snap.takenAt, removed, findings: counts(now) };
  },
});
