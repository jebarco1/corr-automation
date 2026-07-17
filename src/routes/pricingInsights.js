import { Router } from "express";
import { requireClientApiKey } from "../middleware/clientApiKey.js";
import { supportedCategories } from "../ai/toolCatalog.js";
import { listInvoiceLogs, uploadInvoiceLogs } from "../services/invoiceLogStore.js";
import { ensureAllPricingStandards, getPricingStandards, listPricingStandards, replacePricingStandards } from "../services/pricingStandards.js";
import {
  listPricingWorkflows,
  refreshAllPricingStandards,
  refreshPricingStandards,
  runAllIndustryStandardsWorkflows,
  runIndustryStandardsWorkflow,
  suggestFromInvoiceLogs
} from "../services/pricingIntelligence.js";

const router = Router();

ensureAllPricingStandards();

router.get("/pricing-standards", (_req, res) => {
  res.json(listPricingStandards());
});

router.get("/workflows", (_req, res) => {
  res.json(listPricingWorkflows());
});

router.post("/workflows/industry-standards", requireClientApiKey, async (req, res, next) => {
  try {
    res.status(202).json(await runAllIndustryStandardsWorkflows(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/pricing-standards/refresh", requireClientApiKey, async (req, res, next) => {
  try {
    res.status(202).json(await refreshAllPricingStandards(req.body || {}));
  } catch (error) {
    next(error);
  }
});

for (const category of supportedCategories) {
  router.get(`/${category}/pricing-standards`, (_req, res, next) => {
    try {
      res.json(getPricingStandards(category));
    } catch (error) {
      next(error);
    }
  });

  router.put(`/${category}/pricing-standards`, requireClientApiKey, (req, res, next) => {
    try {
      res.json(replacePricingStandards(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/pricing-standards/refresh`, requireClientApiKey, async (req, res, next) => {
    try {
      res.status(202).json(await refreshPricingStandards(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/workflows/industry-standards`, requireClientApiKey, async (req, res, next) => {
    try {
      res.status(202).json(await runIndustryStandardsWorkflow(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/invoices/log`, requireClientApiKey, (req, res, next) => {
    try {
      res.status(201).json(uploadInvoiceLogs(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/invoices/log`, requireClientApiKey, (req, res, next) => {
    try {
      res.json(listInvoiceLogs(category, req.query || {}));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/invoices/suggest`, requireClientApiKey, async (req, res, next) => {
    try {
      res.json(await suggestFromInvoiceLogs(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
}

export default router;
