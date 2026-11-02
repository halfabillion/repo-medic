import { randomUUID } from "node:crypto";

import { defineAction, defineActionErrors, type WriteReceipt } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { findings, fixes, repos, scans, TOOLS } from "../server/db/schema.js";
import { git, headCommit } from "../server/lib/git.js";
import { runScanners } from "../server/lib/scanners/run.js";
import { OPEN_STATUSES, statusOnRescan } from "../server/lib/status.js";
import { actorFrom, recordEvent } from "../server/lib/events.js";
import { loadRepo, nowIso, requireOwner } from "../server/lib/store.js";

const errors = defineActionErrors("not_found", "forbidden", "scan_running", "unauthenticated", "all_scanners_failed");

/** A "running" scan older than this is treated as abandoned (server restart). */
const STALE_MS = 15 * 60 * 1000;

export default defineAction({
  description:
    "Scan a repo with semgrep (code), gitleaks (secrets) and osv-scanner (dependencies). New issues land in New, issues no longer seen move to Resolved, resolved issues seen again reopen. Takes ~10-60 s.",
  schema: z.object({
    repoId: z.string().describe("Repo id from list-repos or add-repo"),
    tools: z
      .array(z.enum(TOOLS))
      .optional()
      .describe('Subset of scanners to run: "semgrep", "gitleaks", "osv-scanner"; defaults to all three'),
  }),
  outputSchema: z.object({
    id: z.string(),
    repoId: z.string(),
    commitSha: z.string(),
    total: z.number(),
    newCount: z.number(),
    reopenedCount: z.number(),
    resolvedCount: z.number(),
    tools: z.array(z.object({ tool: z.string(), ok: z.boolean(), findings: z.number(), durationMs: z.number(), error: z.string().optional() })),
    summary: z.string(),
    _receipt: z.any(),
  }),
  errors,
  link: ({ result }) => ({ url: `/repos/${result.repoId}`, label: "Open board" }),
  run: async (args, ctx) => {
    const { ownerEmail, orgId } = requireOwner();
    const who = actorFrom(ctx);
    const repo = await loadRepo(args.repoId, "editor");
    const db = getDb();
    const tools = args.tools?.length ? args.tools : [...TOOLS];

    const [running] = await db
      .select()
      .from(scans)
      .where(and(eq(scans.repoId, repo.id), eq(scans.status, "running")))
      .limit(1);
    if (running && Date.now() - Date.parse(running.startedAt) < STALE_MS) {
      return errors.noWrite("A scan is already running for this repo.", "scan_running", { statusCode: 409, details: { scanId: running.id } });
    }

    if (repo.sourceKind === "github") {
      await git(repo.checkoutPath, ["pull", "--ff-only", "--quiet"], 120_000);
    }
    const commitSha = await headCommit(repo.checkoutPath);
    const scanId = randomUUID();
    const startedAt = nowIso();
    await db.insert(scans).values({ id: scanId, repoId: repo.id, status: "running", commitSha, startedAt, ownerEmail, orgId });

    try {
      const results = await runScanners(repo.checkoutPath, tools);
      const toolSummary = Object.fromEntries(
        results.map((r) => [r.tool, { ok: r.ok, findings: r.findings.length, durationMs: r.durationMs, ...(r.error ? { error: r.error } : {}) }]),
      );
      if (results.every((r) => !r.ok)) {
        await db.update(scans).set({ status: "failed", finishedAt: nowIso(), toolSummary: JSON.stringify(toolSummary) }).where(eq(scans.id, scanId));
        return errors.fail(`Every scanner failed: ${results.map((r) => `${r.tool}: ${r.error}`).join("; ")}`, "all_scanners_failed", { statusCode: 502 });
      }

      const seen = new Map(results.filter((r) => r.ok).flatMap((r) => r.findings).map((f) => [f.fingerprint, f]));
      const existing = await db.select().from(findings).where(eq(findings.repoId, repo.id));
      const byFingerprint = new Map(existing.map((f) => [f.fingerprint, f]));
      const now = nowIso();
      let newCount = 0;
      let reopenedCount = 0;

      for (const f of seen.values()) {
        const prior = byFingerprint.get(f.fingerprint);
        const fields = {
          ruleId: f.ruleId,
          title: f.title,
          message: f.message,
          scannerSeverity: f.severity,
          filePath: f.filePath,
          startLine: f.startLine,
          endLine: f.endLine,
          snippet: f.snippet,
          cwe: f.cwe,
          packageName: f.packageName,
          packageVersion: f.packageVersion,
          fixedVersion: f.fixedVersion,
          advisories: JSON.stringify(f.advisories),
          autofixAvailable: f.autofixAvailable ? 1 : 0,
          lastSeenScanId: scanId,
          updatedAt: now,
        };
        if (!prior) {
          newCount += 1;
          const findingId = randomUUID();
          await db.insert(findings).values({
            id: findingId,
            repoId: repo.id,
            fingerprint: f.fingerprint,
            tool: f.tool,
            severity: f.severity,
            status: "new",
            firstSeenScanId: scanId,
            createdAt: now,
            ownerEmail,
            orgId,
            ...fields,
          });
          await recordEvent({
            finding: { id: findingId, repoId: repo.id, ownerEmail, orgId },
            actor: "system",
            actorLabel: f.tool,
            kind: "detected",
            summary: `Found by ${f.tool} at ${f.filePath}${f.startLine ? `:${f.startLine}` : ""} (scan of ${commitSha.slice(0, 7)})`,
            detail: [`Scan started by ${who.actorLabel}`],
            at: now,
          });
        } else {
          const status = statusOnRescan(prior.status);
          if (status !== prior.status) reopenedCount += 1;
          await db.update(findings).set({ ...fields, status }).where(eq(findings.id, prior.id));
          if (status !== prior.status) {
            await recordEvent({ finding: prior, actor: "system", actorLabel: f.tool, kind: "reopened", summary: `Reported again by ${f.tool} at ${commitSha.slice(0, 7)}; moved from ${prior.status} to ${status}`, at: now });
          }
        }
      }

      // A verified fix only counts while the commit it was verified on is still in history
      // (a force-push or rewrite can drop it). Send such cards back to Confirmed for re-verification.
      let staleCount = 0;
      const fixReady = existing.filter((f) => f.status === "fix_ready" && seen.has(f.fingerprint));
      for (const f of fixReady) {
        const passed = await db.select().from(fixes).where(and(eq(fixes.findingId, f.id), eq(fixes.status, "passed")));
        let anyCurrent = false;
        for (const fx of passed) {
          const ok = (await git(repo.checkoutPath, ["merge-base", "--is-ancestor", fx.baseCommit, commitSha])).code === 0;
          if (ok) anyCurrent = true;
          else await db.update(fixes).set({ status: "discarded", updatedAt: now }).where(eq(fixes.id, fx.id));
        }
        if (!anyCurrent) {
          staleCount += 1;
          await db.update(findings).set({ status: "confirmed", updatedAt: now }).where(eq(findings.id, f.id));
          await recordEvent({
            finding: f,
            actor: "system",
            actorLabel: "Repo Medic",
            kind: "status_changed",
            summary: `Moved from Fix ready back to Confirmed: the verified fix was based on a commit that is no longer in history`,
            detail: [`Bases: ${[...new Set(passed.map((fx) => fx.baseCommit.slice(0, 7)))].join(", ") || "none"}; now at ${commitSha.slice(0, 7)}. Propose and verify the fix again.`],
            at: now,
          });
        }
      }

      // Only scanners that ran successfully can resolve their own findings.
      const okTools = results.filter((r) => r.ok).map((r) => r.tool);
      const gone = existing.filter(
        (f) => OPEN_STATUSES.includes(f.status) && okTools.includes(f.tool) && !seen.has(f.fingerprint),
      );
      if (gone.length) {
        await db.update(findings).set({ status: "resolved", updatedAt: now, lastSeenScanId: scanId }).where(inArray(findings.id, gone.map((f) => f.id)));
        for (const g of gone) {
          await recordEvent({ finding: g, actor: "system", actorLabel: g.tool, kind: "resolved", summary: `No longer reported by ${g.tool} at ${commitSha.slice(0, 7)}`, at: now });
        }
      }

      await db
        .update(scans)
        .set({ status: "completed", finishedAt: nowIso(), toolSummary: JSON.stringify(toolSummary), newCount, resolvedCount: gone.length })
        .where(eq(scans.id, scanId));
      await db.update(repos).set({ lastScanId: scanId, lastScannedAt: nowIso() }).where(eq(repos.id, repo.id));

      const failed = results.filter((r) => !r.ok);
      const summary = `Scanned ${repo.name} @ ${commitSha.slice(0, 7)}: ${seen.size} open issue${seen.size === 1 ? "" : "s"} (${newCount} new, ${reopenedCount} reopened, ${gone.length} resolved${staleCount ? `, ${staleCount} fix${staleCount === 1 ? "" : "es"} to re-verify` : ""}).${failed.length ? ` ${failed.map((r) => r.tool).join(", ")} failed.` : ""}`;
      const _receipt: WriteReceipt = {
        changed: true,
        verified: failed.length ? "unverified" : true,
        subject: `scan:${repo.id}`,
        summary: summary.slice(0, 200),
        checks: results.map((r) => ({ id: r.tool, ok: r.ok, detail: r.ok ? `${r.findings.length} findings in ${r.durationMs} ms` : (r.error ?? "failed") })),
      };
      return {
        id: scanId,
        repoId: repo.id,
        commitSha,
        total: seen.size,
        newCount,
        reopenedCount,
        resolvedCount: gone.length,
        tools: results.map((r) => ({ tool: r.tool, ok: r.ok, findings: r.findings.length, durationMs: r.durationMs, ...(r.error ? { error: r.error } : {}) })),
        summary,
        _receipt,
      };
    } catch (err) {
      await db.update(scans).set({ status: "failed", finishedAt: nowIso() }).where(and(eq(scans.id, scanId), eq(scans.status, "running")));
      throw err;
    }
  },
});
