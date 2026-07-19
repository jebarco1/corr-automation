import { Router } from "express";
import {
  attachBusinessSession,
  ensureSeedBusinesses,
  getBusiness,
  listBusinesses,
  listBusinessSessions,
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

router.get("/businesses/:businessId", (req, res, next) => {
  try {
    const business = getBusiness(req.params.businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json({
      business,
      businessSettings: toBusinessSettings(business)
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
      businessSettings: toBusinessSettings(business)
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

export default router;
