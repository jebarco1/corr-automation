import { getDb, makeId, nowIso, parseJson } from "../db/sqlite.js";
import { emitVendorEvent } from "./webhooks.js";

export const LEAD_STATUSES = [
  "new", "contact-ready", "contacted", "quoted", "won", "lost", "nurture", "scheduled", "paid"
];

function mapLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    externalLeadId: row.external_lead_id,
    segment: row.segment,
    category: row.category,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    state: row.state,
    url: row.url,
    customerType: row.customer_type,
    score: row.score,
    status: row.status,
    assignee: row.assignee,
    notes: parseJson(row.notes_json, []),
    quoteId: row.quote_id,
    source: row.source,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listLeads(vendorId, options = {}) {
  const clauses = ["vendor_id = ?"];
  const params = [vendorId];
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.category) {
    clauses.push("category = ?");
    params.push(options.category);
  }
  if (options.segment) {
    clauses.push("segment = ?");
    params.push(options.segment);
  }
  if (options.assignee) {
    clauses.push("assignee = ?");
    params.push(options.assignee);
  }
  const limit = Math.min(Number(options.limit || 100), 500);
  const rows = getDb().prepare(`
    SELECT * FROM leads
    WHERE ${clauses.join(" AND ")}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(...params, limit);
  return {
    count: rows.length,
    leads: rows.map(mapLead)
  };
}

export function getLead(vendorId, leadId) {
  const row = getDb().prepare("SELECT * FROM leads WHERE vendor_id = ? AND id = ?").get(vendorId, leadId);
  return mapLead(row);
}

export function createLead(vendorId, input = {}) {
  if (!input.name) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const db = getDb();
  const now = nowIso();
  const id = makeId("vld");
  const status = LEAD_STATUSES.includes(input.status) ? input.status : "new";
  db.prepare(`
    INSERT INTO leads (
      id, vendor_id, external_lead_id, segment, category, name, phone, email, address,
      city, state, url, customer_type, score, status, assignee, notes_json, quote_id, source,
      payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    vendorId,
    input.externalLeadId || input.leadId || null,
    input.segment || null,
    input.category || null,
    input.name,
    input.phone || null,
    input.email || null,
    input.address || null,
    input.city || null,
    input.state || null,
    input.url || null,
    input.customerType || null,
    Number(input.score || 0),
    status,
    input.assignee || null,
    JSON.stringify(input.notes || []),
    input.quoteId || null,
    input.source || "manual",
    JSON.stringify(input.payload || input),
    now,
    now
  );
  const lead = getLead(vendorId, id);
  if (status === "contact-ready" || (lead.phone || lead.email)) {
    emitVendorEvent(vendorId, "lead.ready", { lead }).catch(() => {});
  }
  return lead;
}

export function updateLead(vendorId, leadId, patch = {}) {
  const existing = getLead(vendorId, leadId);
  if (!existing) {
    const error = new Error("Lead not found");
    error.statusCode = 404;
    throw error;
  }
  if (patch.status && !LEAD_STATUSES.includes(patch.status)) {
    const error = new Error(`status must be one of: ${LEAD_STATUSES.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  const next = {
    ...existing,
    ...patch,
    notes: patch.notes ?? existing.notes,
    payload: patch.payload ?? existing.payload
  };
  const now = nowIso();
  getDb().prepare(`
    UPDATE leads SET
      segment = ?, category = ?, name = ?, phone = ?, email = ?, address = ?,
      city = ?, state = ?, url = ?, customer_type = ?, score = ?, status = ?,
      assignee = ?, notes_json = ?, quote_id = ?, source = ?, payload_json = ?, updated_at = ?
    WHERE vendor_id = ? AND id = ?
  `).run(
    next.segment, next.category, next.name, next.phone, next.email, next.address,
    next.city, next.state, next.url, next.customerType, Number(next.score || 0), next.status,
    next.assignee, JSON.stringify(next.notes || []), next.quoteId, next.source,
    JSON.stringify(next.payload || {}), now, vendorId, leadId
  );
  const lead = getLead(vendorId, leadId);
  if (patch.status === "contact-ready") {
    emitVendorEvent(vendorId, "lead.ready", { lead }).catch(() => {});
  }
  return lead;
}

export function addLeadNote(vendorId, leadId, noteInput = {}) {
  const lead = getLead(vendorId, leadId);
  if (!lead) {
    const error = new Error("Lead not found");
    error.statusCode = 404;
    throw error;
  }
  const note = {
    id: makeId("note"),
    text: String(noteInput.text || noteInput.note || "").trim(),
    author: noteInput.author || "system",
    at: nowIso()
  };
  if (!note.text) {
    const error = new Error("note text is required");
    error.statusCode = 400;
    throw error;
  }
  const notes = [...(lead.notes || []), note];
  return updateLead(vendorId, leadId, { notes });
}

export function assignLead(vendorId, leadId, assignee) {
  if (!assignee) {
    const error = new Error("assignee is required");
    error.statusCode = 400;
    throw error;
  }
  return updateLead(vendorId, leadId, { assignee: String(assignee) });
}

export function linkLeadQuote(vendorId, leadId, quoteId) {
  return updateLead(vendorId, leadId, { quoteId, status: "quoted" });
}

export function importHuntLeads(vendorId, huntLeads = [], options = {}) {
  const imported = [];
  for (const item of huntLeads) {
    const status = (item.phone || item.email || item.address)
      ? (item.status === "contact-ready" ? "contact-ready" : "contact-ready")
      : "new";
    imported.push(createLead(vendorId, {
      externalLeadId: item.leadId,
      segment: item.segment || options.segment,
      category: item.category || options.category,
      name: item.name,
      phone: item.phone,
      email: item.email,
      address: item.address,
      city: item.city,
      state: item.state,
      url: item.url,
      customerType: item.customerType,
      score: item.score,
      status,
      source: item.source || "hunt-import",
      payload: item
    }));
  }
  return { count: imported.length, leads: imported };
}
