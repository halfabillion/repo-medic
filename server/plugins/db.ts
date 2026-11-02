import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "repos-scans-findings-fixes",
      sql: `CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('local', 'github')),
  checkout_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  last_scan_id TEXT,
  last_scanned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
);
CREATE TABLE IF NOT EXISTS repo_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (now()),
  notified_at TEXT
);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  commit_sha TEXT,
  tool_summary TEXT NOT NULL DEFAULT '{}',
  new_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  owner_email TEXT NOT NULL,
  org_id TEXT
);
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repos(id),
  fingerprint TEXT NOT NULL,
  tool TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  scanner_severity TEXT NOT NULL CHECK (scanner_severity IN ('critical', 'high', 'medium', 'low', 'info')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'confirmed', 'fix_ready', 'pr_opened', 'resolved', 'dismissed')),
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  snippet TEXT,
  cwe TEXT,
  package_name TEXT,
  package_version TEXT,
  fixed_version TEXT,
  advisories TEXT NOT NULL DEFAULT '[]',
  autofix_available INTEGER NOT NULL DEFAULT 0,
  dismiss_reason TEXT,
  note TEXT,
  first_seen_scan_id TEXT NOT NULL,
  last_seen_scan_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  UNIQUE (repo_id, fingerprint),
  CHECK (status <> 'dismissed' OR dismiss_reason IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS fixes (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id),
  repo_id TEXT NOT NULL REFERENCES repos(id),
  source TEXT NOT NULL CHECK (source IN ('autofix', 'agent', 'human')),
  summary TEXT NOT NULL,
  diff TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'passed', 'failed', 'pr_opened', 'discarded')),
  checks TEXT NOT NULL DEFAULT '[]',
  test_output TEXT,
  branch TEXT,
  pr_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  org_id TEXT
);
CREATE INDEX IF NOT EXISTS repos_owner_org_name_idx ON repos (owner_email, org_id, name);
CREATE INDEX IF NOT EXISTS repo_shares_resource_idx ON repo_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS scans_repo_started_idx ON scans (repo_id, started_at);
CREATE INDEX IF NOT EXISTS findings_repo_status_idx ON findings (repo_id, status, severity);
CREATE INDEX IF NOT EXISTS fixes_finding_idx ON fixes (finding_id, created_at)`,
    },
  ],
  { table: "repo_medic_migrations" },
);
