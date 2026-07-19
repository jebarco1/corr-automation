import crypto from "crypto";
import { getDb, makeId, nowIso, parseJson, rowToVendor } from "../db/sqlite.js";

function hashKey(raw) {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || `vendor-${crypto.randomBytes(3).toString("hex")}`;
}

export function generateVendorApiKey() {
  return `vcorr_${crypto.randomBytes(24).toString("hex")}`;
}

export function createVendor(input = {}) {
  const db = getDb();
  const now = nowIso();
  const id = makeId("vnd");
  let slug = slugify(input.slug || input.name);
  const existing = db.prepare("SELECT id FROM vendors WHERE slug = ?").get(slug);
  if (existing) slug = `${slug}-${crypto.randomBytes(2).toString("hex")}`;

  db.prepare(`
    INSERT INTO vendors (id, slug, name, email, phone, default_category, branding_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    slug,
    input.name || "New Vendor",
    input.email || null,
    input.phone || null,
    input.defaultCategory || input.category || "landscape",
    JSON.stringify(input.branding || {}),
    now,
    now
  );

  const key = createVendorKey(id, { label: input.keyLabel || "default" });
  return { vendor: getVendorById(id), apiKey: key.apiKey, keyMeta: key.meta };
}

export function createVendorKey(vendorId, input = {}) {
  const db = getDb();
  const raw = generateVendorApiKey();
  const id = makeId("vk");
  const now = nowIso();
  db.prepare(`
    INSERT INTO vendor_api_keys (id, vendor_id, key_hash, key_prefix, label, created_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(id, vendorId, hashKey(raw), raw.slice(0, 12), input.label || "default", now);
  return {
    apiKey: raw,
    meta: { id, vendorId, keyPrefix: raw.slice(0, 12), label: input.label || "default", createdAt: now }
  };
}

export function getVendorById(id) {
  const row = getDb().prepare("SELECT * FROM vendors WHERE id = ?").get(id);
  return rowToVendor(row);
}

export function getVendorBySlug(slug) {
  const row = getDb().prepare("SELECT * FROM vendors WHERE slug = ?").get(slug);
  return rowToVendor(row);
}

export function resolveVendorFromApiKey(rawKey) {
  if (!rawKey) return null;
  const row = getDb().prepare(`
    SELECT k.*, v.slug as vendor_slug, v.name as vendor_name, v.email as vendor_email,
           v.phone as vendor_phone, v.default_category, v.branding_json, v.created_at as vendor_created,
           v.updated_at as vendor_updated
    FROM vendor_api_keys k
    JOIN vendors v ON v.id = k.vendor_id
    WHERE k.key_hash = ? AND k.revoked_at IS NULL
  `).get(hashKey(rawKey));
  if (!row) return null;
  return {
    keyId: row.id,
    keyPrefix: row.key_prefix,
    vendor: {
      id: row.vendor_id,
      slug: row.vendor_slug,
      name: row.vendor_name,
      email: row.email || row.vendor_email,
      phone: row.vendor_phone,
      defaultCategory: row.default_category,
      branding: parseJson(row.branding_json, {}),
      createdAt: row.vendor_created,
      updatedAt: row.vendor_updated
    }
  };
}

export function listVendorKeys(vendorId) {
  return getDb().prepare(`
    SELECT id, key_prefix as keyPrefix, label, created_at as createdAt, revoked_at as revokedAt
    FROM vendor_api_keys WHERE vendor_id = ? ORDER BY created_at DESC
  `).all(vendorId);
}

export function ensureDemoVendor() {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM vendors WHERE slug = ?").get("demo-landscape");
  if (existing) {
    return { vendor: rowToVendor(existing), created: false, apiKey: null };
  }
  const created = createVendor({
    name: "Demo Landscape Co",
    slug: "demo-landscape",
    email: "ops@demo-landscape.example",
    phone: "404-555-0199",
    defaultCategory: "landscape",
    keyLabel: "demo"
  });
  return { ...created, created: true };
}

export function getVendorPublicProfile(slug) {
  const vendor = getVendorBySlug(slug);
  if (!vendor) return null;
  return {
    slug: vendor.slug,
    name: vendor.name,
    email: vendor.email,
    phone: vendor.phone,
    defaultCategory: vendor.defaultCategory,
    branding: vendor.branding
  };
}
