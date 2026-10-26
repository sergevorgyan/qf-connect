import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

// SQLite keeps local dev and pilots dependency-free. The SQL sticks to what Postgres also accepts
// so moving to Postgres for production is a driver swap, not a rewrite.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  voipms_client_id TEXT,
  plan TEXT NOT NULL DEFAULT 'business',
  brand_color TEXT,
  cdr_synced_through TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('qf_admin', 'tenant_admin', 'staff')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  acting_tenant_id INTEGER REFERENCES tenants(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS extensions (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  voipms_account TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  voicemail_box TEXT
);
CREATE TABLE IF NOT EXISTS numbers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  did TEXT NOT NULL UNIQUE,
  label TEXT,
  sms_enabled INTEGER NOT NULL DEFAULT 1,
  tendlc_status TEXT NOT NULL DEFAULT 'not_started',
  sms_callback_token TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  voipms_uniqueid TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL,
  disposition TEXT NOT NULL,
  from_number TEXT,
  from_name TEXT,
  to_number TEXT,
  did TEXT,
  extension TEXT,
  duration_seconds INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  crm_logged_at TEXT,
  crm_error TEXT
);
CREATE INDEX IF NOT EXISTS calls_tenant_started ON calls (tenant_id, started_at DESC);
CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  did TEXT NOT NULL,
  contact TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  voipms_id TEXT,
  sent_by_user_id INTEGER REFERENCES users(id),
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sms_thread ON sms_messages (tenant_id, did, contact, created_at);
CREATE TABLE IF NOT EXISTS opt_outs (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  contact TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, contact)
);
CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('textback', 'hubspot')),
  enabled INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  secret TEXT,
  UNIQUE (tenant_id, type)
);
CREATE TABLE IF NOT EXISTS textback_events (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  call_id INTEGER NOT NULL UNIQUE REFERENCES calls(id),
  contact TEXT NOT NULL,
  did TEXT NOT NULL,
  outcome TEXT NOT NULL,
  sent_at TEXT,
  replied_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

export type DB = DatabaseSync;

export function openDb(path = config.databasePath): DB {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function audit(db: DB, entry: { tenantId?: number | null; userId?: number | null; action: string; detail?: unknown }) {
  db.prepare('INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES (?, ?, ?, ?)').run(
    entry.tenantId ?? null,
    entry.userId ?? null,
    entry.action,
    entry.detail === undefined ? null : JSON.stringify(entry.detail),
  );
}
