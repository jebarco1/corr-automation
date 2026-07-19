import { getStore, makeId, nowIso, parseJson } from "../db/store.js";
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
  const query = { vendor_id: vendorId };
  if (options.status) query.status = options.status;
  if (options.category) query.category = options.category;
  if (options.segment) query.segment = options.segment;
  if (options.assignee) query.assignee = options.assignee;
  const rows = getStore().leads.find(query, {
    sort: [{ key: "updated_at", dir: "desc" }],
    limit: Math.min(Number(options.limit || 100), 500)
  });
  return { count: rows.length, leads: rows.map(mapLead) };
}

export function getLead(vendorId, leadId) {
  return mapLead(getStore().leads.findOne({ vendor_id: vendorId, id: leadId }));
}

export function createLead(vendorId, input = {}) {
  if (!input.name) {
    const error = new Error("name is required");
    error.statusCode = 400;
    throw error;
  }
  const now = nowIso();
  const id = makeId("vld");
  const status = LEAD_STATUSES.includes(input.status) ? input.status : "new";
  getStore().leads.insert({
    id,
    vendor_id: vendorId,
    external_lead_id: input.externalLeadId || input.leadId || null,
    segment: input.segment || null,
    category: input.category || null,
    name: input.name,
    phone: input.phone || null,
    email: input.email || null,
    address: input.address || null,
    city: input.city || null,
    state: input.state || null,
    url: input.url || null,
    customer_type: input.customerType || null,
    score: Number(input.score || 0),
    status,
    assignee: input.assignee || null,
    notes_json: input.notes || [],
    quote_id: input.quoteId || null,
    source: input.source || "manual",
    payload_json: input.payload || input,
    created_at: now,
    updated_at: now
  });
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
  getStore().leads.updateWhere({ vendor_id: vendorId, id: leadId }, {
    segment: next.segment,
    category: next.category,
    name: next.name,
    phone: next.phone,
    email: next.email,
    address: next.address,
    city: next.city,
    state: next.state,
    url: next.url,
    customer_type: next.customerType,
    score: Number(next.score || 0),
    status: next.status,
    assignee: next.assignee,
    notes_json: next.notes || [],
    quote_id: next.quoteId,
    source: next.source,
    payload_json: next.payload || {},
    updated_at: nowIso()
  });
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
  return updateLead(vendorId, leadId, { notes: [...(lead.notes || []), note] });
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
    const status = (item.phone || item.email || item.address) ? "contact-ready" : "new";
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
