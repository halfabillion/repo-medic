import fs from "node:fs";

import { defineAction } from "@agent-native/core/action";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { fixes } from "../server/db/schema.js";
import { findingSchema, fixSchema, toFinding, toFix } from "../server/lib/dto.js";
import { safeJoin } from "../server/lib/paths.js";
import { loadFinding } from "../server/lib/store.js";

const CONTEXT_LINES = 6;

export default defineAction({
  description:
    "Get one finding with surrounding source code (±6 lines, secrets never included), advisories and every proposed fix with its diff and checks. Read this before writing a fix.",
  schema: z.object({ id: z.string().describe("Finding id") }),
  http: { method: "GET" },
  readOnly: true,
  outputSchema: z.object({
    finding: findingSchema,
    repoName: z.string(),
    code: z
      .object({ startLine: z.number(), lines: z.array(z.string()), language: z.string() })
      .nullable(),
    fixes: z.array(fixSchema),
  }),
  run: async (args) => {
    const { finding, repo } = await loadFinding(args.id);
    const rows = await getDb().select().from(fixes).where(eq(fixes.findingId, finding.id)).orderBy(desc(fixes.createdAt));

    let code: { startLine: number; lines: string[]; language: string } | null = null;
    // Secrets: show only the redacted snippet, never the file around it.
    if (finding.tool !== "gitleaks" && finding.startLine) {
      const file = safeJoin(repo.checkoutPath, finding.filePath);
      if (file && fs.existsSync(file) && fs.statSync(file).size < 2_000_000) {
        const all = fs.readFileSync(file, "utf8").split("\n");
        const start = Math.max(1, finding.startLine - CONTEXT_LINES);
        const end = Math.min(all.length, (finding.endLine ?? finding.startLine) + CONTEXT_LINES);
        code = {
          startLine: start,
          lines: all.slice(start - 1, end),
          language: (/\.([a-z0-9]+)$/i.exec(finding.filePath)?.[1] ?? "text").toLowerCase(),
        };
      }
    }
    return { finding: toFinding(finding, rows[0]), repoName: repo.name, code, fixes: rows.map(toFix) };
  },
});
