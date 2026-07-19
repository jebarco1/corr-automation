import crypto from "crypto";
import axios from "axios";
import { getDb, makeId, nowIso, parseJson } from "../db/sqlite.js";

export const VENDOR_EVENTS = [
  "lead.ready",
  "quote.sent",
  "quote.accepted",
  "quote.rejected",
  "payment.succeeded",
  "job.scheduled",
  "booking.created"
];

export function createWebhookEndpoint(vendorId, input = {}) {
  if (!input.url) {
    const error = new Error("url is required");
    error.statusCode = 400;
    throw error;
  }
  const id = makeId("wh");
  const secret = input.secret || `whsec_${crypto.randomBytes(16).toString("hex")}`;
  const events = Array.isArray(input.events) && input.events.length
    ? input.events
    : [...VENDOR_EVENTS];
  getDb().prepare(`
    INSERT INTO webhook_endpoints (id, vendor_id, url, secret, events_json, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(id, vendorId, input.url, secret, JSON.stringify(events), nowIso());
  return getWebhookEndpoint(vendorId, id);
}

export function listWebhookEndpoints(vendorId) {
  return getDb().prepare(`
    SELECT id, url, secret, events_json, enabled, created_at
    FROM webhook_endpoints WHERE vendor_id = ? ORDER BY created_at DESC
  `).all(vendorId).map(row => ({
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: parseJson(row.events_json, []),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at
  }));
}

export function getWebhookEndpoint(vendorId, id) {
  return listWebhookEndpoints(vendorId).find(item => item.id === id) || null;
}

export function listWebhookDeliveries(vendorId, limit = 50) {
  return getDb().prepare(`
    SELECT id, endpoint_id as endpointId, event, status, attempts, last_error as lastError,
           created_at as createdAt
    FROM webhook_deliveries WHERE vendor_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(vendorId, Math.min(Number(limit) || 50, 200));
}

function signPayload(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export async function emitVendorEvent(vendorId, event, data = {}) {
  const endpoints = listWebhookEndpoints(vendorId).filter(
    endpoint => endpoint.enabled && endpoint.events.includes(event)
  );
  const payload = {
    id: makeId("evt"),
    object: "event",
    event,
    createdAt: nowIso(),
    data
  };
  const body = JSON.stringify(payload);
  const results = [];

  for (const endpoint of endpoints) {
    const deliveryId = makeId("whd");
    let status = "pending";
    let lastError = null;
    try {
      const signature = signPayload(endpoint.secret, body);
      const response = await axios.post(endpoint.url, payload, {
        timeout: 8000,
        headers: {
          "Content-Type": "application/json",
          "X-HA-Corr-Event": event,
          "X-HA-Corr-Signature": signature
        },
        validateStatus: () => true
      });
      status = response.status >= 200 && response.status < 300 ? "delivered" : "failed";
      if (status === "failed") lastError = `HTTP ${response.status}`;
    } catch (error) {
      status = "failed";
      lastError = error.message;
    }
    getDb().prepare(`
      INSERT INTO webhook_deliveries
        (id, vendor_id, endpoint_id, event, payload_json, status, attempts, last_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(deliveryId, vendorId, endpoint.id, event, body, status, lastError, nowIso());
    results.push({ deliveryId, endpointId: endpoint.id, status, lastError });
  }

  // Always record an in-app delivery for observability even with no endpoints.
  if (!endpoints.length) {
    const deliveryId = makeId("whd");
    getDb().prepare(`
      INSERT INTO webhook_deliveries
        (id, vendor_id, endpoint_id, event, payload_json, status, attempts, last_error, created_at)
      VALUES (?, ?, NULL, ?, ?, 'logged', 0, NULL, ?)
    `).run(deliveryId, vendorId, event, body, nowIso());
    results.push({ deliveryId, status: "logged" });
  }

  return { event, results, payload };
}
