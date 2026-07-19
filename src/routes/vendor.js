import { Router } from "express";
import { requireVendorApiKey } from "../middleware/vendorAuth.js";
import {
  createVendor,
  createVendorKey,
  ensureDemoVendor,
  getVendorById,
  listVendorKeys
} from "../services/vendors.js";
import {
  addLeadNote,
  assignLead,
  createLead,
  getLead,
  importHuntLeads,
  LEAD_STATUSES,
  listLeads,
  updateLead
} from "../services/vendorLeads.js";
import {
  acceptQuote,
  createQuote,
  getQuote,
  listQuotes,
  rejectQuote,
  sendQuote
} from "../services/vendorQuotes.js";
import {
  createCheckoutForQuote,
  listPayments
} from "../services/vendorPayments.js";
import {
  createJob,
  getJob,
  listJobs,
  updateJob
} from "../services/vendorJobs.js";
import {
  createWebhookEndpoint,
  emitVendorEvent,
  listWebhookDeliveries,
  listWebhookEndpoints,
  VENDOR_EVENTS
} from "../services/webhooks.js";
import { listNotifications } from "../services/notifications.js";
import { listSessions, saveSession } from "../services/vendorSessions.js";
import { listLeads as listHuntFileLeads } from "../services/leadHunt.js";

const router = Router();

/** Bootstrap: create a vendor tenant + first API key (returned once). */
router.post("/vendors", (req, res, next) => {
  try {
    const created = createVendor(req.body || {});
    res.status(201).json({
      vendor: created.vendor,
      apiKey: created.apiKey,
      warning: "Store apiKey now — it is only shown once.",
      endpoints: {
        me: "GET /api/v1/vendors/me",
        leads: "/api/v1/vendors/me/leads",
        quotes: "/api/v1/vendors/me/quotes",
        jobs: "/api/v1/vendors/me/jobs",
        booking: `/book/${created.vendor.slug}`
      }
    });
  } catch (error) {
    next(error);
  }
});

/** Ensure demo vendor exists (for local UI). Returns key only when newly created. */
router.post("/vendors/demo", (_req, res, next) => {
  try {
    const demo = ensureDemoVendor();
    res.json({
      vendor: demo.vendor,
      apiKey: demo.apiKey,
      created: demo.created,
      message: demo.created
        ? "Demo vendor created. Store apiKey now."
        : "Demo vendor already exists. Use an existing key or create a new one via authenticated POST /vendors/me/keys."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me", requireVendorApiKey, (req, res) => {
  res.json({
    vendor: req.vendor,
    keyId: req.vendorKeyId,
    statuses: { leads: LEAD_STATUSES, events: VENDOR_EVENTS }
  });
});

router.post("/vendors/me/keys", requireVendorApiKey, (req, res, next) => {
  try {
    const created = createVendorKey(req.vendor.id, req.body || {});
    res.status(201).json({
      apiKey: created.apiKey,
      key: created.meta,
      warning: "Store apiKey now — it is only shown once."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/keys", requireVendorApiKey, (req, res) => {
  res.json({ keys: listVendorKeys(req.vendor.id) });
});

// —— Leads CRM ——
router.get("/vendors/me/leads", requireVendorApiKey, (req, res, next) => {
  try {
    res.json(listLeads(req.vendor.id, req.query));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/leads", requireVendorApiKey, (req, res, next) => {
  try {
    res.status(201).json(createLead(req.vendor.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/leads/:leadId", requireVendorApiKey, (req, res, next) => {
  try {
    const lead = getLead(req.vendor.id, req.params.leadId);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    res.json(lead);
  } catch (error) {
    next(error);
  }
});

router.patch("/vendors/me/leads/:leadId", requireVendorApiKey, (req, res, next) => {
  try {
    res.json(updateLead(req.vendor.id, req.params.leadId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/leads/:leadId/notes", requireVendorApiKey, (req, res, next) => {
  try {
    res.status(201).json(addLeadNote(req.vendor.id, req.params.leadId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/leads/:leadId/assign", requireVendorApiKey, (req, res, next) => {
  try {
    res.json(assignLead(req.vendor.id, req.params.leadId, req.body?.assignee || req.body?.to));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/leads/:leadId/quotes", requireVendorApiKey, async (req, res, next) => {
  try {
    const quote = createQuote(req.vendor.id, { ...(req.body || {}), leadId: req.params.leadId });
    res.status(201).json(quote);
  } catch (error) {
    next(error);
  }
});

/** Import leads from file-based hunt output into this vendor's CRM. */
router.post("/vendors/me/leads/import-hunt", requireVendorApiKey, (req, res, next) => {
  try {
    const category = req.body?.category || req.vendor.defaultCategory || "landscape";
    const hunted = listHuntFileLeads(category, {
      segment: req.body?.segment,
      city: req.body?.city,
      limit: req.body?.limit || 50
    });
    const imported = importHuntLeads(req.vendor.id, hunted.leads || [], {
      category,
      segment: req.body?.segment
    });
    res.status(201).json({
      category,
      fromFiles: hunted.count,
      imported: imported.count,
      leads: imported.leads
    });
  } catch (error) {
    next(error);
  }
});

// —— Quotes ——
router.get("/vendors/me/quotes", requireVendorApiKey, (req, res, next) => {
  try {
    res.json(listQuotes(req.vendor.id, req.query));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/quotes", requireVendorApiKey, (req, res, next) => {
  try {
    res.status(201).json(createQuote(req.vendor.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/quotes/:quoteId", requireVendorApiKey, (req, res, next) => {
  try {
    const quote = getQuote(req.vendor.id, req.params.quoteId);
    if (!quote) return res.status(404).json({ error: "Quote not found" });
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/quotes/:quoteId/send", requireVendorApiKey, async (req, res, next) => {
  try {
    res.json(await sendQuote(req.vendor.id, req.params.quoteId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/quotes/:quoteId/accept", requireVendorApiKey, async (req, res, next) => {
  try {
    res.json(await acceptQuote(req.vendor.id, req.params.quoteId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/quotes/:quoteId/reject", requireVendorApiKey, async (req, res, next) => {
  try {
    res.json(await rejectQuote(req.vendor.id, req.params.quoteId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/quotes/:quoteId/checkout", requireVendorApiKey, async (req, res, next) => {
  try {
    res.status(201).json(await createCheckoutForQuote(req.vendor.id, req.params.quoteId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

// —— Payments / Jobs / Sessions / Webhooks ——
router.get("/vendors/me/payments", requireVendorApiKey, (req, res) => {
  res.json(listPayments(req.vendor.id, req.query));
});

router.get("/vendors/me/jobs", requireVendorApiKey, (req, res) => {
  res.json(listJobs(req.vendor.id, req.query));
});

router.post("/vendors/me/jobs", requireVendorApiKey, (req, res, next) => {
  try {
    res.status(201).json(createJob(req.vendor.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/jobs/:jobId", requireVendorApiKey, (req, res) => {
  const job = getJob(req.vendor.id, req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

router.patch("/vendors/me/jobs/:jobId", requireVendorApiKey, (req, res, next) => {
  try {
    res.json(updateJob(req.vendor.id, req.params.jobId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/sessions", requireVendorApiKey, (req, res) => {
  res.json({ sessions: listSessions(req.vendor.id, req.query.limit) });
});

router.post("/vendors/me/sessions", requireVendorApiKey, (req, res, next) => {
  try {
    res.status(201).json(saveSession(req.vendor.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/webhooks", requireVendorApiKey, (req, res) => {
  res.json({
    events: VENDOR_EVENTS,
    endpoints: listWebhookEndpoints(req.vendor.id),
    deliveries: listWebhookDeliveries(req.vendor.id, req.query.limit)
  });
});

router.post("/vendors/me/webhooks", requireVendorApiKey, (req, res, next) => {
  try {
    res.status(201).json(createWebhookEndpoint(req.vendor.id, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/vendors/me/webhooks/test", requireVendorApiKey, async (req, res, next) => {
  try {
    const event = req.body?.event || "lead.ready";
    res.json(await emitVendorEvent(req.vendor.id, event, {
      test: true,
      vendor: getVendorById(req.vendor.id)
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/vendors/me/notifications", requireVendorApiKey, (req, res) => {
  res.json({ notifications: listNotifications(req.vendor.id, req.query.limit) });
});

export default router;
