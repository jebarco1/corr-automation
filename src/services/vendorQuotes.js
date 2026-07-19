import crypto from "crypto";
import { getDb, makeId, nowIso, parseJson } from "../db/sqlite.js";
import { getLead, linkLeadQuote, updateLead } from "./vendorLeads.js";
import { sendEmail, sendSms } from "./notifications.js";
import { emitVendorEvent } from "./webhooks.js";
import { createJobFromQuote } from "./vendorJobs.js";

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "paid"];

function mapQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    leadId: row.lead_id,
    category: row.category,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    serviceAddress: row.service_address,
    serviceName: row.service_name,
    amountCents: row.amount_cents,
    amount: Math.round((row.amount_cents || 0)) / 100,
    currency: row.currency,
    status: row.status,
    lineItems: parseJson(row.line_items_json, []),
    notes: row.notes,
    publicToken: row.public_token,
    publicPath: `/book/quote/${row.public_token}`,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getQuote(vendorId, quoteId) {
  const row = getDb().prepare("SELECT * FROM quotes WHERE vendor_id = ? AND id = ?").get(vendorId, quoteId);
  return mapQuote(row);
}

export function getQuoteByToken(token) {
  const row = getDb().prepare("SELECT * FROM quotes WHERE public_token = ?").get(token);
  return mapQuote(row);
}

export function listQuotes(vendorId, options = {}) {
  const clauses = ["vendor_id = ?"];
  const params = [vendorId];
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.leadId) {
    clauses.push("lead_id = ?");
    params.push(options.leadId);
  }
  const rows = getDb().prepare(`
    SELECT * FROM quotes WHERE ${clauses.join(" AND ")}
    ORDER BY updated_at DESC LIMIT ?
  `).all(...params, Math.min(Number(options.limit || 100), 500));
  return { count: rows.length, quotes: rows.map(mapQuote) };
}

export function createQuote(vendorId, input = {}) {
  let lead = null;
  if (input.leadId) {
    lead = getLead(vendorId, input.leadId);
    if (!lead) {
      const error = new Error("Lead not found");
      error.statusCode = 404;
      throw error;
    }
  }

  const amountCents = input.amountCents != null
    ? Math.round(Number(input.amountCents))
    : Math.round(Number(input.amount || 0) * 100);
  if (!amountCents || amountCents < 0) {
    const error = new Error("amount or amountCents is required");
    error.statusCode = 400;
    throw error;
  }

  const id = makeId("qte");
  const now = nowIso();
  const token = crypto.randomBytes(18).toString("hex");
  const lineItems = input.lineItems || [{
    description: input.serviceName || lead?.payload?.suggestedService?.serviceName || "Service",
    amountCents
  }];

  getDb().prepare(`
    INSERT INTO quotes (
      id, vendor_id, lead_id, category, customer_name, customer_email, customer_phone,
      service_address, service_name, amount_cents, currency, status, line_items_json, notes,
      public_token, sent_at, accepted_at, rejected_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL, NULL, ?, ?)
  `).run(
    id,
    vendorId,
    lead?.id || null,
    input.category || lead?.category || null,
    input.customerName || lead?.name || null,
    input.customerEmail || lead?.email || null,
    input.customerPhone || lead?.phone || null,
    input.serviceAddress || lead?.address || null,
    input.serviceName || lineItems[0]?.description || "Service",
    amountCents,
    input.currency || "USD",
    JSON.stringify(lineItems),
    input.notes || null,
    token,
    now,
    now
  );

  if (lead) linkLeadQuote(vendorId, lead.id, id);
  return getQuote(vendorId, id);
}

export async function sendQuote(vendorId, quoteId, options = {}) {
  const quote = getQuote(vendorId, quoteId);
  if (!quote) {
    const error = new Error("Quote not found");
    error.statusCode = 404;
    throw error;
  }
  if (!["draft", "sent"].includes(quote.status)) {
    const error = new Error(`Cannot send quote in status ${quote.status}`);
    error.statusCode = 409;
    throw error;
  }

  const now = nowIso();
  getDb().prepare(`
    UPDATE quotes SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ? AND vendor_id = ?
  `).run(now, now, quoteId, vendorId);

  if (quote.leadId) updateLead(vendorId, quote.leadId, { status: "quoted", quoteId });

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const link = `${baseUrl}/book/quote/${quote.publicToken}`;
  const subject = options.subject || `Your ${quote.serviceName || "service"} quote`;
  const body = options.body || [
    `Hi ${quote.customerName || "there"},`,
    "",
    `Your quote for ${quote.serviceName} is $${quote.amount.toFixed(2)}.`,
    `Review and accept here: ${link}`,
    "",
    "Thanks"
  ].join("\n");

  const notifications = [];
  if (quote.customerEmail) {
    notifications.push(await sendEmail({
      vendorId, to: quote.customerEmail, subject, body, meta: { quoteId }
    }));
  }
  if (quote.customerPhone && options.sms !== false) {
    notifications.push(await sendSms({
      vendorId,
      to: quote.customerPhone,
      body: `Quote ready: ${quote.serviceName} $${quote.amount.toFixed(2)} — ${link}`,
      meta: { quoteId }
    }));
  }

  const updated = getQuote(vendorId, quoteId);
  await emitVendorEvent(vendorId, "quote.sent", { quote: updated });
  return { quote: updated, link, notifications };
}

export async function acceptQuote(vendorId, quoteId, options = {}) {
  const quote = getQuote(vendorId, quoteId);
  if (!quote) {
    const error = new Error("Quote not found");
    error.statusCode = 404;
    throw error;
  }
  if (!["draft", "sent"].includes(quote.status)) {
    const error = new Error(`Cannot accept quote in status ${quote.status}`);
    error.statusCode = 409;
    throw error;
  }
  const now = nowIso();
  getDb().prepare(`
    UPDATE quotes SET status = 'accepted', accepted_at = ?, updated_at = ?
    WHERE id = ? AND vendor_id = ?
  `).run(now, now, quoteId, vendorId);

  if (quote.leadId) updateLead(vendorId, quote.leadId, { status: "won", quoteId });

  const updated = getQuote(vendorId, quoteId);
  await emitVendorEvent(vendorId, "quote.accepted", { quote: updated });

  let job = null;
  if (options.createJob !== false) {
    job = await createJobFromQuote(vendorId, updated, options.job || {});
  }
  return { quote: updated, job };
}

export async function rejectQuote(vendorId, quoteId, options = {}) {
  const quote = getQuote(vendorId, quoteId);
  if (!quote) {
    const error = new Error("Quote not found");
    error.statusCode = 404;
    throw error;
  }
  if (!["draft", "sent"].includes(quote.status)) {
    const error = new Error(`Cannot reject quote in status ${quote.status}`);
    error.statusCode = 409;
    throw error;
  }
  const now = nowIso();
  getDb().prepare(`
    UPDATE quotes SET status = 'rejected', rejected_at = ?, updated_at = ?, notes = ?
    WHERE id = ? AND vendor_id = ?
  `).run(now, now, options.reason || quote.notes, quoteId, vendorId);

  if (quote.leadId) updateLead(vendorId, quote.leadId, { status: "lost", quoteId });
  const updated = getQuote(vendorId, quoteId);
  await emitVendorEvent(vendorId, "quote.rejected", { quote: updated, reason: options.reason || null });
  return { quote: updated };
}

export function markQuotePaid(vendorId, quoteId) {
  const now = nowIso();
  getDb().prepare(`
    UPDATE quotes SET status = 'paid', updated_at = ? WHERE id = ? AND vendor_id = ?
  `).run(now, quoteId, vendorId);
  const quote = getQuote(vendorId, quoteId);
  if (quote?.leadId) updateLead(vendorId, quote.leadId, { status: "paid", quoteId });
  return quote;
}
