import crypto from "crypto";
import axios from "axios";
import { getStore, makeId, nowIso } from "../db/store.js";
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
  return mapPayment(getStore().payments.findOne({ vendor_id: vendorId, id: paymentId }));
}

export function getPaymentById(paymentId) {
  return mapPayment(getStore().payments.findOne({ id: paymentId }));
}

export function listPayments(vendorId, options = {}) {
  const rows = getStore().payments.find(
    { vendor_id: vendorId },
    { sort: [{ key: "created_at", dir: "desc" }], limit: Math.min(Number(options.limit || 100), 500) }
  );
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

  getStore().payments.insert({
    id,
    vendor_id: vendorId,
    quote_id: quote.id,
    provider,
    provider_ref: providerRef,
    amount_cents: quote.amountCents,
    currency: quote.currency || "USD",
    status: "pending",
    checkout_url: checkoutUrl,
    created_at: now,
    updated_at: now
  });

  return getPayment(vendorId, id);
}

export async function completePayment(paymentId, options = {}) {
  const row = getStore().payments.findOne({ id: paymentId });
  if (!row) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }
  if (row.status === "succeeded") return { payment: mapPayment(row), quote: getQuote(row.vendor_id, row.quote_id) };

  getStore().payments.updateWhere({ id: paymentId }, {
    status: "succeeded",
    provider_ref: options.providerRef || row.provider_ref || null,
    updated_at: nowIso()
  });

  const payment = mapPayment(getStore().payments.findOne({ id: paymentId }));
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

export async function handleStripeWebhook(rawBody) {
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
      return completePayment(paymentId, { providerRef: session.id });
    }
  }
  return { ignored: true, type: event.type };
}
