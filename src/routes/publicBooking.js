import { Router } from "express";
import { getDb } from "../db/sqlite.js";
import { getVendorById, getVendorBySlug, getVendorPublicProfile } from "../services/vendors.js";
import { createLead } from "../services/vendorLeads.js";
import {
  acceptQuote,
  createQuote,
  getQuoteByToken,
  rejectQuote,
  sendQuote
} from "../services/vendorQuotes.js";
import {
  completePayment,
  createCheckoutForQuote,
  handleStripeWebhook
} from "../services/vendorPayments.js";
import { emitVendorEvent } from "../services/webhooks.js";
import { listServices } from "../services/serviceCatalog.js";

const router = Router();

function sanitizeQuote(quote) {
  if (!quote) return null;
  return {
    id: quote.id,
    status: quote.status,
    serviceName: quote.serviceName,
    serviceAddress: quote.serviceAddress,
    customerName: quote.customerName,
    amount: quote.amount,
    currency: quote.currency,
    lineItems: quote.lineItems,
    publicToken: quote.publicToken,
    sentAt: quote.sentAt,
    acceptedAt: quote.acceptedAt
  };
}

router.get("/public/:slug/booking", (req, res) => {
  const vendor = getVendorPublicProfile(req.params.slug);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  let services = [];
  try {
    const catalog = listServices(vendor.defaultCategory || "landscape");
    services = (catalog.services || []).slice(0, 12).map(service => ({
      id: service.id,
      name: service.name,
      description: service.description
    }));
  } catch {
    services = [];
  }
  res.json({
    vendor,
    services,
    bookingPath: `/book/${vendor.slug}`,
    endpoints: {
      create: `POST /api/v1/public/${vendor.slug}/booking`
    }
  });
});

router.post("/public/:slug/booking", async (req, res, next) => {
  try {
    const full = getVendorBySlug(req.params.slug);
    if (!full) return res.status(404).json({ error: "Vendor not found" });

    const body = req.body || {};
    if (!body.name || !(body.email || body.phone)) {
      return res.status(400).json({ error: "name and email or phone are required" });
    }

    const lead = createLead(full.id, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address || body.serviceAddress,
      city: body.city,
      state: body.state || "GA",
      category: body.category || full.defaultCategory,
      segment: body.segment || "residential",
      customerType: body.customerType || "booking",
      status: "contact-ready",
      source: "public-booking",
      payload: body
    });

    let quote = null;
    if (body.amount || body.amountCents || body.createQuote) {
      quote = createQuote(full.id, {
        leadId: lead.id,
        category: lead.category,
        serviceName: body.serviceName || body.service || "Requested service",
        amount: body.amount,
        amountCents: body.amountCents,
        serviceAddress: lead.address,
        customerName: lead.name,
        customerEmail: lead.email,
        customerPhone: lead.phone
      });
      if (body.sendQuote) {
        quote = (await sendQuote(full.id, quote.id)).quote;
      }
    }

    await emitVendorEvent(full.id, "booking.created", { lead, quote });
    res.status(201).json({
      ok: true,
      vendor: { slug: full.slug, name: full.name },
      lead: { id: lead.id, status: lead.status },
      quote: sanitizeQuote(quote),
      message: "Booking received. The vendor will follow up shortly."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/public/quotes/:token", (req, res) => {
  const quote = getQuoteByToken(req.params.token);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  const full = getVendorById(quote.vendorId);
  res.json({
    quote: sanitizeQuote(quote),
    vendor: full ? {
      slug: full.slug,
      name: full.name,
      email: full.email,
      phone: full.phone
    } : null,
    actions: {
      accept: `POST /api/v1/public/quotes/${quote.publicToken}/accept`,
      reject: `POST /api/v1/public/quotes/${quote.publicToken}/reject`,
      checkout: `POST /api/v1/public/quotes/${quote.publicToken}/checkout`
    }
  });
});

router.post("/public/quotes/:token/accept", async (req, res, next) => {
  try {
    const quote = getQuoteByToken(req.params.token);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    const result = await acceptQuote(quote.vendorId, quote.id, req.body || {});
    res.json({
      quote: sanitizeQuote(result.quote),
      job: result.job ? {
        id: result.job.id,
        status: result.job.status,
        scheduledStart: result.job.scheduledStart,
        assignee: result.job.assignee
      } : null
    });
  } catch (error) {
    next(error);
  }
});

router.post("/public/quotes/:token/reject", async (req, res, next) => {
  try {
    const quote = getQuoteByToken(req.params.token);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    const result = await rejectQuote(quote.vendorId, quote.id, req.body || {});
    res.json({ quote: sanitizeQuote(result.quote) });
  } catch (error) {
    next(error);
  }
});

router.post("/public/quotes/:token/checkout", async (req, res, next) => {
  try {
    const quote = getQuoteByToken(req.params.token);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    if (["draft", "sent"].includes(quote.status)) {
      await acceptQuote(quote.vendorId, quote.id, { createJob: true });
    }
    const payment = await createCheckoutForQuote(quote.vendorId, quote.id, req.body || {});
    res.status(201).json({
      payment: {
        id: payment.id,
        status: payment.status,
        provider: payment.provider,
        amount: payment.amount,
        checkoutUrl: payment.checkoutUrl
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/public/payments/:paymentId/mock-complete", async (req, res, next) => {
  try {
    const row = getDb().prepare("SELECT * FROM payments WHERE id = ?").get(req.params.paymentId);
    if (!row) return res.status(404).json({ error: "Payment not found" });
    if (row.provider !== "mock" && !process.env.ALLOW_MOCK_PAYMENTS) {
      return res.status(400).json({ error: "Mock completion only for mock payments" });
    }
    const result = await completePayment(req.params.paymentId);
    res.json({
      ok: true,
      payment: {
        id: result.payment.id,
        status: result.payment.status,
        amount: result.payment.amount
      },
      quote: sanitizeQuote(result.quote)
    });
  } catch (error) {
    next(error);
  }
});

router.get("/public/payments/:paymentId/mock-complete", async (req, res, next) => {
  try {
    const row = getDb().prepare("SELECT * FROM payments WHERE id = ?").get(req.params.paymentId);
    if (!row) return res.status(404).json({ error: "Payment not found" });
    const result = await completePayment(req.params.paymentId);
    const token = result.quote?.publicToken;
    if (token) return res.redirect(`/book/quote/${token}?paid=1`);
    res.json({ ok: true, payment: result.payment });
  } catch (error) {
    next(error);
  }
});

router.post("/webhooks/stripe", async (req, res, next) => {
  try {
    res.json(await handleStripeWebhook(req.body, req.get("stripe-signature")));
  } catch (error) {
    next(error);
  }
});

export default router;
