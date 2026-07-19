import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, "../../data/db/ha-corr.sqlite");

let db;

const MIGRATION_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    default_category TEXT,
    branding_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vendor_api_keys (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    external_lead_id TEXT,
    segment TEXT,
    category TEXT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    url TEXT,
    customer_type TEXT,
    score INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    assignee TEXT,
    notes_json TEXT DEFAULT '[]',
    quote_id TEXT,
    source TEXT,
    payload_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_leads_vendor_status ON leads(vendor_id, status);
  CREATE INDEX IF NOT EXISTS idx_leads_vendor_category ON leads(vendor_id, category);

  CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    lead_id TEXT,
    category TEXT,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    service_address TEXT,
    service_name TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'draft',
    line_items_json TEXT DEFAULT '[]',
    notes TEXT,
    public_token TEXT NOT NULL UNIQUE,
    sent_at TEXT,
    accepted_at TEXT,
    rejected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_quotes_vendor_status ON quotes(vendor_id, status);
  CREATE INDEX IF NOT EXISTS idx_quotes_token ON quotes(public_token);

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_ref TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending',
    checkout_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    quote_id TEXT,
    lead_id TEXT,
    category TEXT,
    title TEXT NOT NULL,
    service_address TEXT,
    scheduled_start TEXT,
    scheduled_end TEXT,
    assignee TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_vendor_status ON jobs(vendor_id, status);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    category TEXT,
    payload_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events_json TEXT DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    endpoint_id TEXT,
    event TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notification_log (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    subject TEXT,
    body TEXT,
    status TEXT NOT NULL,
    provider TEXT,
    meta_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
  );
`;

function migrate(database) {
  database.exec(MIGRATION_SQL);
}

/**
 * Open SQLite using better-sqlite3 (Node 18+).
 * Falls back to node:sqlite only when better-sqlite3 is unavailable AND the runtime supports it.
 */
function openDatabase(dbPath) {
  try {
    const Database = require("better-sqlite3");
    const database = new Database(dbPath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return database;
  } catch (betterSqliteError) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      return new DatabaseSync(dbPath);
    } catch {
      const error = new Error(
        "SQLite driver unavailable. Run `npm install` (needs better-sqlite3). " +
        `Original error: ${betterSqliteError.message}`
      );
      error.statusCode = 500;
      throw error;
    }
  }
}

export function getDb() {
  if (db) return db;
  const dbPath = process.env.HA_CORR_DB_PATH || defaultPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = openDatabase(dbPath);
  migrate(db);
  return db;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function rowToVendor(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    email: row.email,
    phone: row.phone,
    defaultCategory: row.default_category,
    branding: parseJson(row.branding_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
