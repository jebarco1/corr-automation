import crypto from "crypto";
import axios from "axios";
import { getStore, makeId, nowIso, parseJson } from "../db/store.js";

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
  getStore().webhook_endpoints.insert({
    id,
    vendor_id: vendorId,
    url: input.url,
    secret,
    events_json: events,
    enabled: 1,
    created_at: nowIso()
  });
  return getWebhookEndpoint(vendorId, id);
}

export function listWebhookEndpoints(vendorId) {
  return getStore().webhook_endpoints
    .find({ vendor_id: vendorId }, { sort: [{ key: "created_at", dir: "desc" }] })
    .map(row => ({
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
  return getStore().webhook_deliveries
    .find({ vendor_id: vendorId }, {
      sort: [{ key: "created_at", dir: "desc" }],
      limit: Math.min(Number(limit) || 50, 200)
    })
    .map(row => ({
      id: row.id,
      endpointId: row.endpoint_id,
      event: row.event,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      createdAt: row.created_at
    }));
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
  const db = getStore();

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
    db.webhook_deliveries.insert({
      id: deliveryId,
      vendor_id: vendorId,
      endpoint_id: endpoint.id,
      event,
      payload_json: payload,
      status,
      attempts: 1,
      last_error: lastError,
      created_at: nowIso()
    });
    results.push({ deliveryId, endpointId: endpoint.id, status, lastError });
  }

  if (!endpoints.length) {
    const deliveryId = makeId("whd");
    db.webhook_deliveries.insert({
      id: deliveryId,
      vendor_id: vendorId,
      endpoint_id: null,
      event,
      payload_json: payload,
      status: "logged",
      attempts: 0,
      last_error: null,
      created_at: nowIso()
    });
    results.push({ deliveryId, status: "logged" });
  }

  return { event, results, payload };
}
