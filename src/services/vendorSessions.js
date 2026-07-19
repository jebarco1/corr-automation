import { getDb, makeId, nowIso, parseJson } from "../db/sqlite.js";

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    kind: row.kind,
    category: row.category,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function saveSession(vendorId, input = {}) {
  const id = input.id || makeId("ses");
  const now = nowIso();
  const existing = getDb().prepare("SELECT id FROM sessions WHERE id = ? AND vendor_id = ?").get(id, vendorId);
  if (existing) {
    getDb().prepare(`
      UPDATE sessions SET kind = ?, category = ?, payload_json = ?, updated_at = ?
      WHERE id = ? AND vendor_id = ?
    `).run(
      input.kind || "guided",
      input.category || null,
      JSON.stringify(input.payload || {}),
      now,
      id,
      vendorId
    );
  } else {
    getDb().prepare(`
      INSERT INTO sessions (id, vendor_id, kind, category, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      vendorId,
      input.kind || "guided",
      input.category || null,
      JSON.stringify(input.payload || {}),
      now,
      now
    );
  }
  return getSession(vendorId, id);
}

export function getSession(vendorId, sessionId) {
  const row = getDb().prepare("SELECT * FROM sessions WHERE vendor_id = ? AND id = ?").get(vendorId, sessionId);
  return mapSession(row);
}

export function listSessions(vendorId, limit = 50) {
  return getDb().prepare(`
    SELECT * FROM sessions WHERE vendor_id = ? ORDER BY updated_at DESC LIMIT ?
  `).all(vendorId, Math.min(Number(limit) || 50, 200)).map(mapSession);
}
