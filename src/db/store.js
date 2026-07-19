import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.join(__dirname, "../../data/db/ha-corr.json");

const TABLE_NAMES = [
  "vendors",
  "vendor_api_keys",
  "leads",
  "quotes",
  "payments",
  "jobs",
  "sessions",
  "businesses",
  "business_sessions",
  "webhook_endpoints",
  "webhook_deliveries",
  "notification_log"
];

let store;

function emptyData() {
  return Object.fromEntries(TABLE_NAMES.map(name => [name, []]));
}

function load(filePath) {
  if (!fs.existsSync(filePath)) return emptyData();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const data = emptyData();
    for (const name of TABLE_NAMES) {
      data[name] = Array.isArray(parsed[name]) ? parsed[name] : [];
    }
    return data;
  } catch {
    return emptyData();
  }
}

function save(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function matches(row, query = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (value && typeof value === "object" && "ne" in value) return row[key] !== value.ne;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
}

function sortRows(rows, sort) {
  if (!sort?.length) return rows;
  return [...rows].sort((a, b) => {
    for (const { key, dir = "asc", coalesce } of sort) {
      const av = coalesce ? (a[key] ?? a[coalesce]) : a[key];
      const bv = coalesce ? (b[key] ?? b[coalesce]) : b[key];
      if (av === bv) continue;
      if (av == null) return dir === "asc" ? 1 : -1;
      if (bv == null) return dir === "asc" ? -1 : 1;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
}

class Collection {
  constructor(name, db) {
    this.name = name;
    this.db = db;
  }

  _rows() {
    return this.db.data[this.name];
  }

  find(query = {}, options = {}) {
    let rows = this._rows().filter(row => matches(row, query));
    rows = sortRows(rows, options.sort);
    if (options.limit != null) rows = rows.slice(0, Number(options.limit));
    return rows.map(clone);
  }

  findOne(query = {}) {
    const row = this._rows().find(item => matches(item, query));
    return clone(row) || null;
  }

  insert(row) {
    const next = clone(row);
    this._rows().push(next);
    this.db.persist();
    return clone(next);
  }

  updateWhere(query, patch) {
    let count = 0;
    for (const row of this._rows()) {
      if (!matches(row, query)) continue;
      const values = typeof patch === "function" ? patch(clone(row)) : patch;
      Object.assign(row, values);
      count += 1;
    }
    if (count) this.db.persist();
    return count;
  }

  upsert(query, row) {
    const existing = this.findOne(query);
    if (existing) {
      this.updateWhere(query, row);
      return this.findOne(query);
    }
    return this.insert({ ...query, ...row });
  }
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.mtimeMs = 0;
    this.data = emptyData();
    this.reloadIfNeeded(true);
    for (const name of TABLE_NAMES) {
      const prop = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      this[prop] = new Collection(name, this);
      // also expose snake aliases
      this[name] = this[prop];
    }
  }

  reloadIfNeeded(force = false) {
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(this.filePath).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    if (!force && mtimeMs && mtimeMs === this.mtimeMs) return;
    this.data = load(this.filePath);
    this.mtimeMs = mtimeMs;
  }

  persist() {
    save(this.filePath, this.data);
    try {
      this.mtimeMs = fs.statSync(this.filePath).mtimeMs;
    } catch {
      this.mtimeMs = Date.now();
    }
  }
}

export function getStore() {
  const filePath = process.env.HA_CORR_DB_PATH
    ? (String(process.env.HA_CORR_DB_PATH).endsWith(".json")
      ? process.env.HA_CORR_DB_PATH
      : process.env.HA_CORR_DB_PATH.replace(/\.sqlite$/, ".json"))
    : defaultPath;
  if (!store) store = new JsonStore(filePath);
  store.reloadIfNeeded();
  return store;
}

/** @deprecated use getStore — kept so old imports keep working during transition */
export function getDb() {
  return getStore();
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
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
    settings: parseJson(row.settings_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
