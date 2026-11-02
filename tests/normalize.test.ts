import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareVersions,
  cvssToSeverity,
  fingerprintOf,
  minimumSafeVersion,
  parseGitleaks,
  parseOsv,
  parseSemgrep,
  redactSecret,
  shortRuleId,
} from "../server/lib/scanners/normalize";

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "../server/lib/scanners/__fixtures__", name), "utf8"));

const APP_JS = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");

describe("parseSemgrep (real output from demo-vuln-shop)", () => {
  const findings = parseSemgrep(fixture("semgrep.json"), (p) => (p === "src/app.js" ? APP_JS : null));

  it("groups two matches of one rule on the same line into one finding", () => {
    expect(fixture("semgrep.json").results).toHaveLength(7);
    expect(findings).toHaveLength(6);
    expect(findings.filter((f) => f.ruleId.endsWith("insecure-random-token"))).toHaveLength(1);
  });

  it("maps severity, CWE, snippet and autofix flag", () => {
    const sql = findings.find((f) => f.ruleId.endsWith("sql-built-from-input"))!;
    expect(sql).toMatchObject({ tool: "semgrep", severity: "high", cwe: "CWE-89", startLine: 11, endLine: 12, snippet: "line 11\nline 12", autofixAvailable: false });
    const md5 = findings.find((f) => f.ruleId.endsWith("weak-password-hash"))!;
    expect(md5).toMatchObject({ severity: "medium", autofixAvailable: true });
  });

  it("produces stable, unique fingerprints", () => {
    const again = parseSemgrep(fixture("semgrep.json"), () => APP_JS);
    expect(again.map((f) => f.fingerprint)).toEqual(findings.map((f) => f.fingerprint));
    expect(new Set(findings.map((f) => f.fingerprint)).size).toBe(findings.length);
  });

  it("keeps the fingerprint when only indentation changes", () => {
    const a = parseSemgrep(fixture("semgrep.json"), () => APP_JS)[0]!;
    const b = parseSemgrep(fixture("semgrep.json"), () => APP_JS.replace("line 11", "     line   11"))[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe("parseGitleaks", () => {
  // Obviously fake value; the shape mirrors gitleaks 8.x JSON.
  const secret = ["sk", "test", "FAKEFAKEFAKEFAKEFAKE1234"].join("_"); // built at runtime so secret scanners skip this fixture
  const [f] = parseGitleaks([
    {
      RuleID: "stripe-access-token",
      Description: "Found a Stripe Access Token.",
      File: "src/config.js",
      StartLine: 3,
      EndLine: 3,
      Match: `const STRIPE_KEY = "${secret}";`,
      Secret: secret,
    },
  ]);

  it("never stores the full secret", () => {
    expect(f!.snippet).not.toContain(secret);
    expect(f!.snippet).toContain("sk_tes…");
    expect(JSON.stringify(f)).not.toContain(secret);
  });

  it("is critical, human-only, CWE-798", () => {
    expect(f).toMatchObject({ severity: "critical", autofixAvailable: false, cwe: "CWE-798", filePath: "src/config.js" });
  });

  it("handles a null report", () => {
    expect(parseGitleaks(null)).toEqual([]);
  });

  it("redacts short secrets completely", () => {
    expect(redactSecret("abc")).toBe("••••••••");
  });
});

describe("parseOsv (real output from demo-vuln-shop)", () => {
  const [lodash, ...rest] = parseOsv(fixture("osv.json"), "/repo");

  it("collapses all advisories of a package into one finding", () => {
    expect(rest).toHaveLength(0);
    expect(lodash).toMatchObject({ tool: "osv-scanner", ruleId: "npm:lodash", filePath: "package-lock.json", packageVersion: "4.17.15" });
    expect(lodash!.advisories).toHaveLength(6);
    expect(lodash!.advisories.every((a) => a.startsWith("CVE-"))).toBe(true);
  });

  it("uses the highest CVSS score for severity", () => {
    expect(lodash!.severity).toBe("high"); // max_severity 8.1
  });

  it("picks the smallest version that fixes every advisory", () => {
    expect(lodash!.fixedVersion).toBe("4.18.0");
    expect(lodash!.autofixAvailable).toBe(true);
  });
});

describe("helpers", () => {
  it("compares versions numerically", () => {
    expect(compareVersions("4.17.21", "4.17.3")).toBe(1);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2", "1.10")).toBe(-1);
  });

  it("returns null when an advisory has no fix", () => {
    expect(
      minimumSafeVersion({
        package: { name: "x", version: "1.0.0", ecosystem: "npm" },
        vulnerabilities: [{ id: "A", affected: [{ package: { name: "x" }, ranges: [{ events: [{ introduced: "0" }] }] }] }],
      }),
    ).toBeNull();
  });

  it("maps CVSS to severity bands", () => {
    expect([9.8, 7, 4, 0.1, 0, null].map(cvssToSeverity)).toEqual(["critical", "high", "medium", "low", "info", "medium"]);
  });

  it("shortens semgrep rule ids and fingerprints deterministically", () => {
    expect(shortRuleId("scanners.semgrep.rm.js.eval-json-literal")).toBe("rm.js.eval-json-literal");
    expect(fingerprintOf("a", 1, null)).toBe(fingerprintOf("a", 1, undefined));
    expect(fingerprintOf("a", "b")).not.toBe(fingerprintOf("ab", ""));
  });
});
