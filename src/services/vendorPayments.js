import crypto from "crypto";
import axios from "axios";
import { getDb, makeId, nowIso } from "../db/sqlite.js";
import { getQuote, markQuotePaid } from "./vendorQuotes.js";
import { emitVendorEvent } from "./webhooks.js";
import { sendEmail } from "./notifications.js";

function mapPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    quoteId: row.quote_id,
    provider: row.provider,
    providerRef: row.provider_ref,
    amountCents: row.amount_cents,
    amount: Math.round(row.amount_cents) / 100,
    currency: row.currency,
    status: row.status,
    checkoutUrl: row.checkout_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getPayment(vendorId, paymentId) {
  const row = getDb().prepare("SELECT * FROM payments WHERE vendor_id = ? AND id = ?").get(vendorId, paymentId);
  return mapPayment(row);
}

export function listPayments(vendorId, options = {}) {
  const rows = getDb().prepare(`
    SELECT * FROM payments WHERE vendor_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(vendorId, Math.min(Number(options.limit || 100), 500));
  return { count: rows.length, payments: rows.map(mapPayment) };
}

export async function createCheckoutForQuote(vendorId, quoteId, options = {}) {
  const quote = getQuote(vendorId, quoteId);
  if (!quote) {
    const error = new Error("Quote not found");
    error.statusCode = 404;
    throw error;
  }
  if (!["accepted", "sent", "draft"].includes(quote.status)) {
    const error = new Error(`Quote status ${quote.status} cannot be checked out`);
    error.statusCode = 409;
    throw error;
  }

  const id = makeId("pay");
  const now = nowIso();
  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const successUrl = options.successUrl || `${baseUrl}/book/quote/${quote.publicToken}?paid=1`;
  const cancelUrl = options.cancelUrl || `${baseUrl}/book/quote/${quote.publicToken}?cancelled=1`;

  let provider = "mock";
  let providerRef = `mock_${crypto.randomBytes(6).toString("hex")}`;
  let checkoutUrl = `${baseUrl}/api/v1/public/payments/${id}/mock-complete`;

  if (process.env.STRIPE_SECRET_KEY) {
    provider = "stripe";
    try {
      const params = new URLSearchParams();
      params.append("mode", "payment");
      params.append("success_url", successUrl);
      params.append("cancel_url", cancelUrl);
      params.append("client_reference_id", id);
      params.append("metadata[paymentId]", id);
      params.append("metadata[quoteId]", quote.id);
      params.append("metadata[vendorId]", vendorId);
      params.append("line_items[0][quantity]", "1");
      params.append("line_items[0][price_data][currency]", (quote.currency || "USD").toLowerCase());
      params.append("line_items[0][price_data][unit_amount]", String(quote.amountCents));
      params.append("line_items[0][price_data][product_data][name]", quote.serviceName || "Service quote");

      const response = await axios.post("https://api.stripe.com/v1/checkout/sessions", params.toString(), {
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        }
      });
      providerRef = response.data.id;
      checkoutUrl = response.data.url;
    } catch (error) {
      const err = new Error(error.response?.data?.error?.message || error.message || "Stripe checkout failed");
      err.statusCode = 502;
      throw err;
    }
  }

  getDb().prepare(`
    INSERT INTO payments (
      id, vendor_id, quote_id, provider, provider_ref, amount_cents, currency, status, checkout_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    id, vendorId, quote.id, provider, providerRef, quote.amountCents, quote.currency || "USD",
    checkoutUrl, now, now
  );

  return getPayment(vendorId, id);
}

export async function completePayment(paymentId, options = {}) {
  const row = getDb().prepare("SELECT * FROM payments WHERE id = ?").get(paymentId);
  if (!row) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }
  if (row.status === "succeeded") return mapPayment(row);

  const now = nowIso();
  const providerRef = options.providerRef || row.provider_ref || null;
  getDb().prepare(`
    UPDATE payments SET status = 'succeeded', provider_ref = ?, updated_at = ?
    WHERE id = ?
  `).run(providerRef, now, paymentId);

  const payment = mapPayment(getDb().prepare("SELECT * FROM payments WHERE id = ?").get(paymentId));
  const quote = markQuotePaid(payment.vendorId, payment.quoteId);
  await emitVendorEvent(payment.vendorId, "payment.succeeded", { payment, quote });

  if (quote?.customerEmail) {
    await sendEmail({
      vendorId: payment.vendorId,
      to: quote.customerEmail,
      subject: "Payment received",
      body: `Thanks! We received $${payment.amount.toFixed(2)} for ${quote.serviceName}.`,
      meta: { paymentId, quoteId: quote.id }
    });
  }
  return { payment, quote };
}

export async function handleStripeWebhook(rawBody, signatureHeader) {
  // Lightweight verification optional; full Stripe SDK not required for MVP.
  let event;
  try {
    event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  } catch {
    const error = new Error("Invalid Stripe payload");
    error.statusCode = 400;
    throw error;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object || {};
    const paymentId = session.metadata?.paymentId || session.client_reference_id;
    if (paymentId) {
      return completePayment(paymentId, { providerRef: session.id, signatureHeader });
    }
  }
  return { ignored: true, type: event.type };
}
