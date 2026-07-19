import crypto from "crypto";
import { getStore, makeId, nowIso, rowToVendor } from "../db/store.js";

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
  const db = getStore();
  const now = nowIso();
  const id = makeId("vnd");
  let slug = slugify(input.slug || input.name);
  if (db.vendors.findOne({ slug })) {
    slug = `${slug}-${crypto.randomBytes(2).toString("hex")}`;
  }

  db.vendors.insert({
    id,
    slug,
    name: input.name || "New Vendor",
    email: input.email || null,
    phone: input.phone || null,
    default_category: input.defaultCategory || input.category || "landscape",
    branding_json: input.branding || {},
    settings_json: input.settings || {},
    created_at: now,
    updated_at: now
  });

  const key = createVendorKey(id, { label: input.keyLabel || "default" });
  return { vendor: getVendorById(id), apiKey: key.apiKey, keyMeta: key.meta };
}

export function createVendorKey(vendorId, input = {}) {
  const db = getStore();
  const raw = generateVendorApiKey();
  const id = makeId("vk");
  const now = nowIso();
  db.vendor_api_keys.insert({
    id,
    vendor_id: vendorId,
    key_hash: hashKey(raw),
    key_prefix: raw.slice(0, 12),
    label: input.label || "default",
    created_at: now,
    revoked_at: null
  });
  return {
    apiKey: raw,
    meta: { id, vendorId, keyPrefix: raw.slice(0, 12), label: input.label || "default", createdAt: now }
  };
}

export function getVendorById(id) {
  return rowToVendor(getStore().vendors.findOne({ id }));
}

export function getVendorBySlug(slug) {
  return rowToVendor(getStore().vendors.findOne({ slug }));
}

export function resolveVendorFromApiKey(rawKey) {
  if (!rawKey) return null;
  const db = getStore();
  const key = db.vendor_api_keys.findOne({ key_hash: hashKey(rawKey), revoked_at: null });
  if (!key) return null;
  const vendor = db.vendors.findOne({ id: key.vendor_id });
  if (!vendor) return null;
  return {
    keyId: key.id,
    keyPrefix: key.key_prefix,
    vendor: rowToVendor(vendor)
  };
}

export function listVendorKeys(vendorId) {
  return getStore().vendor_api_keys
    .find({ vendor_id: vendorId }, { sort: [{ key: "created_at", dir: "desc" }] })
    .map(row => ({
      id: row.id,
      keyPrefix: row.key_prefix,
      label: row.label,
      createdAt: row.created_at,
      revokedAt: row.revoked_at
    }));
}

export function ensureDemoVendor() {
  const existing = getStore().vendors.findOne({ slug: "demo-landscape" });
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
