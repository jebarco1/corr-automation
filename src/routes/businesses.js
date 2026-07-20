import { Router } from "express";
import {
  attachBusinessSession,
  createBusiness,
  ensureBusinessVendor,
  ensureSeedBusinesses,
  getBusiness,
  listBusinesses,
  listBusinessSessions,
  promoteSessionToCrm,
  toBusinessSettings,
  updateBusiness
} from "../services/businesses.js";

const router = Router();

router.get("/businesses", (_req, res, next) => {
  try {
    res.json(listBusinesses());
  } catch (error) {
    next(error);
  }
});

router.post("/businesses/seed", (_req, res, next) => {
  try {
    res.json({ ok: true, ...ensureSeedBusinesses() });
  } catch (error) {
    next(error);
  }
});

/** Onboarding: create business + CRM vendor + pricebook seed + first session. */
router.post("/businesses", (req, res, next) => {
  try {
    const created = createBusiness(req.body || {});
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

router.get("/businesses/:businessId", (req, res, next) => {
  try {
    const business = getBusiness(req.params.businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json({
      business,
      businessSettings: toBusinessSettings(business, req.query.category || business.primaryCategory)
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/businesses/:businessId", (req, res, next) => {
  try {
    const business = updateBusiness(req.params.businessId, req.body || {});
    res.json({
      business,
      businessSettings: toBusinessSettings(business, req.body?.primaryCategory || business.primaryCategory)
    });
  } catch (error) {
    next(error);
  }
});

/** Issue / ensure CRM API key for this business tenant. */
router.post("/businesses/:businessId/crm-key", (req, res, next) => {
  try {
    const linked = ensureBusinessVendor(req.params.businessId, {
      issueKey: true,
      keyLabel: req.body?.label || "business-hub"
    });
    res.status(201).json({
      business: linked.business,
      vendor: linked.vendor,
      apiKey: linked.apiKey,
      bookingPath: linked.business.bookingPath,
      warning: "Store apiKey now — it is only shown once per issuance."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/businesses/:businessId/sessions", (req, res, next) => {
  try {
    const business = getBusiness(req.params.businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json(listBusinessSessions(business.id, req.query));
  } catch (error) {
    next(error);
  }
});

router.post("/businesses/:businessId/sessions", (req, res, next) => {
  try {
    const session = attachBusinessSession(req.params.businessId, req.body || {});
    res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
});

router.post("/businesses/:businessId/sessions/:sessionId/promote", async (req, res, next) => {
  try {
    const result = await promoteSessionToCrm(req.params.businessId, req.params.sessionId, req.body || {});
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
