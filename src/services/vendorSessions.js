import { getStore, makeId, nowIso, parseJson } from "../db/store.js";

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
  const db = getStore();
  const existing = db.sessions.findOne({ id, vendor_id: vendorId });
  if (existing) {
    db.sessions.updateWhere({ id, vendor_id: vendorId }, {
      kind: input.kind || "guided",
      category: input.category || null,
      payload_json: input.payload || {},
      updated_at: now
    });
  } else {
    db.sessions.insert({
      id,
      vendor_id: vendorId,
      kind: input.kind || "guided",
      category: input.category || null,
      payload_json: input.payload || {},
      created_at: now,
      updated_at: now
    });
  }
  return getSession(vendorId, id);
}

export function getSession(vendorId, sessionId) {
  return mapSession(getStore().sessions.findOne({ vendor_id: vendorId, id: sessionId }));
}

export function listSessions(vendorId, limit = 50) {
  return getStore().sessions
    .find({ vendor_id: vendorId }, {
      sort: [{ key: "updated_at", dir: "desc" }],
      limit: Math.min(Number(limit) || 50, 200)
    })
    .map(mapSession);
}
