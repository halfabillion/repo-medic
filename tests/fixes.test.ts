import { describe, expect, it } from "vitest";

import { applyReplacements, matchesForFinding } from "../server/lib/autofix";
import { filesInDiff, parseGitHubUrl } from "../server/lib/git";
import { safeJoin, isInsideAllowedRoot } from "../server/lib/paths";
import { branchNameFor, prBodyFor, prTitleFor } from "../server/lib/pr";
import type { SemgrepMatch } from "../server/lib/scanners/run";

describe("applyReplacements", () => {
  it("applies several byte-offset edits without shifting later ones", () => {
    const src = "a = md5(x); b = md5(y);";
    const edits = [
      { start: 4, end: 7, text: "sha256" },
      { start: 16, end: 19, text: "sha256" },
    ];
    expect(applyReplacements(src, edits)).toBe("a = sha256(x); b = sha256(y);");
  });

  it("uses byte offsets, so multi-byte characters before the edit are safe", () => {
    const src = "// café\nmd5(x)";
    const start = Buffer.byteLength("// café\n");
    expect(applyReplacements(src, [{ start, end: start + 3, text: "sha256" }])).toBe("// café\nsha256(x)");
  });
});

describe("matchesForFinding", () => {
  const m = (line: number, extra: Partial<SemgrepMatch> = {}): SemgrepMatch => ({
    ruleId: "rm.js.insecure-random-token",
    path: "src/app.js",
    line,
    startOffset: 0,
    endOffset: 1,
    fix: "crypto.randomUUID()",
    fixSummary: null,
    ...extra,
  });
  const finding = { ruleId: "rm.js.insecure-random-token", filePath: "src/app.js", startLine: 35 } as never;

  it("returns every match on the finding's line", () => {
    expect(matchesForFinding([m(35), m(35), m(80)], finding)).toHaveLength(2);
  });

  it("falls back to the nearest line when the file moved", () => {
    expect(matchesForFinding([m(37), m(90)], finding).map((x) => x.line)).toEqual([37]);
  });

  it("ignores other rules, files and matches without a fix", () => {
    expect(matchesForFinding([m(35, { ruleId: "rm.other" }), m(35, { path: "b.js" }), m(35, { fix: null })], finding)).toEqual([]);
  });
});

describe("git helpers", () => {
  it("lists files touched by a diff, including new and deleted files", () => {
    const diff = [
      "diff --git a/src/app.js b/src/app.js",
      "--- a/src/app.js",
      "+++ b/src/app.js",
      "@@ -1 +1 @@",
      "diff --git a/new.js b/new.js",
      "--- /dev/null",
      "+++ b/new.js",
      "diff --git a/old.js b/old.js",
      "--- a/old.js",
      "+++ /dev/null",
    ].join("\n");
    expect(filesInDiff(diff).sort()).toEqual(["new.js", "old.js", "src/app.js"]);
  });

  it("parses GitHub URLs and rejects anything else", () => {
    expect(parseGitHubUrl("https://github.com/halfabillion/demo-vuln-shop.git")).toEqual({ owner: "halfabillion", name: "demo-vuln-shop" });
    expect(parseGitHubUrl("https://github.com/a/b/")).toEqual({ owner: "a", name: "b" });
    expect(parseGitHubUrl("http://github.com/a/b")).toBeNull();
    expect(parseGitHubUrl("https://evil.com/a/b")).toBeNull();
    expect(parseGitHubUrl("https://github.com/a/b; rm -rf /")).toBeNull();
  });
});

describe("path safety", () => {
  it("refuses paths that escape the repo", () => {
    expect(safeJoin("/r", "src/a.js")).toBe("/r/src/a.js");
    expect(safeJoin("/r", "../etc/passwd")).toBeNull();
    expect(safeJoin("/r", "/etc/passwd")).toBeNull();
  });

  it("only accepts local repos inside the allowed roots", () => {
    expect(isInsideAllowedRoot("/work/demo", ["/work"])).toBe(true);
    expect(isInsideAllowedRoot("/workshop/demo", ["/work"])).toBe(false);
  });
});

describe("pull request text", () => {
  const input = {
    finding: {
      title: "SQL query built from request input",
      ruleId: "rm.js.sql-built-from-input",
      tool: "semgrep",
      severity: "high",
      filePath: "src/app.js",
      startLine: 11,
      cwe: "CWE-89",
      advisories: [],
      message: "User input is concatenated | into SQL.",
    },
    fix: { summary: "Use a parameterised query.", source: "agent", baseCommit: "1cf4538abcdef" },
    checks: [
      { id: "patch_applies" as const, ok: true, detail: "Applies cleanly" },
      { id: "tests" as const, ok: true, detail: "7 passed | 0 failed" },
    ],
  };

  it("builds a safe branch name", () => {
    expect(branchNameFor("rm.js.sql-built-from-input", "247adee3-1cbb")).toBe("repo-medic/sql-built-from-input-247adee3");
    expect(branchNameFor("npm:@scope/pkg", "abcdef12")).toBe("repo-medic/npm-scope-pkg-abcdef12");
  });

  it("writes a conventional title and a verification table", () => {
    expect(prTitleFor(input as never)).toBe("fix(security): SQL query built from request input");
    const body = prBodyFor(input as never);
    expect(body).toContain("`src/app.js:11`");
    expect(body).toContain("| ✅ Project tests | 7 passed \\| 0 failed |");
    expect(body).toContain("1cf4538");
    expect(body).toContain("Repo Medic agent");
  });
});
