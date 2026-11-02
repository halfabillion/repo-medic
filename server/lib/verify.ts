import fs from "node:fs";
import path from "node:path";

import { clip, run } from "./exec.js";
import { applyPatch, filesInDiff, withWorktree } from "./git.js";
import { runScanners } from "./scanners/run.js";
import type { Tool } from "./scanners/types.js";

export interface Check {
  id: "patch_applies" | "tests" | "finding_gone" | "no_new_issues";
  ok: boolean;
  skipped?: boolean;
  detail: string;
}

export interface VerifyInput {
  repoDir: string;
  baseCommit: string;
  diff: string;
  finding: { fingerprint: string; tool: Tool; ruleId: string; filePath: string };
  /** Every fingerprint already known for the repo (any status). */
  knownFingerprints: Set<string>;
  allowTestExecution: boolean;
}

export interface VerifyResult {
  passed: boolean;
  checks: Check[];
  testOutput: string;
}

const DEP_FILES = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json)$/;

async function prepareDependencies(repoDir: string, wt: string, touched: string[]): Promise<string> {
  if (!fs.existsSync(path.join(wt, "package.json"))) return "";
  if (touched.some((f) => DEP_FILES.test(f)) && fs.existsSync(path.join(wt, "package-lock.json"))) {
    const r = await run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: wt,
      timeoutMs: 300_000,
    });
    return `$ npm ci --ignore-scripts\n${r.stdout}${r.stderr}\n`;
  }
  const modules = path.join(repoDir, "node_modules");
  if (fs.existsSync(modules) && !fs.existsSync(path.join(wt, "node_modules"))) {
    fs.symlinkSync(modules, path.join(wt, "node_modules"), "dir");
  }
  return "";
}

function testScript(wt: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(wt, "package.json"), "utf8"));
    const script = pkg?.scripts?.test;
    if (typeof script !== "string" || /no test specified/.test(script)) return null;
    return script;
  } catch {
    return null;
  }
}

/**
 * Prove a patch: it applies to the base commit, the project's own tests pass,
 * the scanner no longer reports the finding, and no new finding appears.
 * Everything happens in a throwaway git worktree; the user's checkout is untouched.
 */
export async function verifyFix(input: VerifyInput): Promise<VerifyResult> {
  const checks: Check[] = [];
  let testOutput = "";
  const touched = filesInDiff(input.diff);

  const passedAll = await withWorktree(input.repoDir, input.baseCommit, async (wt) => {
    const check = await applyPatch(wt, input.diff, true);
    if (check.code !== 0) {
      checks.push({ id: "patch_applies", ok: false, detail: check.stderr.trim().slice(0, 500) || "git apply --check failed" });
      return false;
    }
    const applied = await applyPatch(wt, input.diff);
    checks.push({
      id: "patch_applies",
      ok: applied.code === 0,
      detail: applied.code === 0 ? `Applies cleanly to ${input.baseCommit.slice(0, 7)} (${touched.length} file${touched.length === 1 ? "" : "s"})` : applied.stderr.trim(),
    });
    if (applied.code !== 0) return false;

    // 1. The project's own tests.
    const script = testScript(wt);
    if (!script) {
      checks.push({ id: "tests", ok: true, skipped: true, detail: "No test script in package.json" });
    } else if (!input.allowTestExecution) {
      checks.push({
        id: "tests",
        ok: true,
        skipped: true,
        detail: "Not run: tests from an untrusted remote repo only run inside the sandbox runner",
      });
    } else {
      testOutput += await prepareDependencies(input.repoDir, wt, touched);
      const t = await run("npm", ["test", "--silent"], {
        cwd: wt,
        timeoutMs: 180_000,
        env: { CI: "1", NODE_ENV: "test" },
      });
      testOutput += `$ npm test   # ${script}\n${t.stdout}${t.stderr}`;
      const summary = /ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(t.stdout);
      checks.push({
        id: "tests",
        ok: t.code === 0,
        detail: t.timedOut
          ? "Tests timed out after 180 s"
          : summary
            ? `${summary[1]} passed, ${summary[2]} failed`
            : t.code === 0
              ? "npm test exited 0"
              : `npm test exited ${t.code}`,
      });
    }

    // 2 + 3. Re-scan the patched tree.
    const tools = new Set<Tool>([input.finding.tool, "gitleaks"]);
    if (touched.some((f) => /\.(c|m)?[jt]sx?$/.test(f))) tools.add("semgrep");
    if (touched.some((f) => DEP_FILES.test(f))) tools.add("osv-scanner");
    const runs = await runScanners(wt, [...tools]);
    const failed = runs.filter((r) => !r.ok);
    const after = runs.flatMap((r) => r.findings);
    const stillThere = after.some((f) => f.fingerprint === input.finding.fingerprint);
    const sameRuleSameFile = after.filter(
      (f) => f.ruleId === input.finding.ruleId && f.filePath === input.finding.filePath,
    ).length;
    const introduced = after.filter((f) => !input.knownFingerprints.has(f.fingerprint));
    const scannerOk = !failed.some((r) => r.tool === input.finding.tool);
    checks.push({
      id: "finding_gone",
      ok: scannerOk && !stillThere,
      detail: !scannerOk
        ? `${input.finding.tool} could not re-run: ${failed.find((r) => r.tool === input.finding.tool)?.error}`
        : stillThere
          ? `${input.finding.tool} still reports ${input.finding.ruleId} here`
          : `${input.finding.tool} no longer reports it (${sameRuleSameFile} other ${input.finding.ruleId} match${sameRuleSameFile === 1 ? "" : "es"} left in ${input.finding.filePath})`,
    });
    checks.push({
      id: "no_new_issues",
      ok: introduced.length === 0 && failed.length === 0,
      detail:
        failed.length > 0
          ? `Could not re-run ${failed.map((r) => r.tool).join(", ")}`
          : introduced.length === 0
            ? `Re-scanned with ${[...tools].join(", ")}: nothing new`
            : `Introduces ${introduced.length} new issue${introduced.length === 1 ? "" : "s"}: ${introduced
                .slice(0, 3)
                .map((f) => `${f.ruleId} in ${f.filePath}${f.startLine ? `:${f.startLine}` : ""}`)
                .join("; ")}`,
    });
    return checks.every((c) => c.ok);
  });

  return { passed: passedAll, checks, testOutput: clip(testOutput) };
}
