import { Router } from "express";
import { answerGuidedWorkflow, createInvoiceFromSession, getCategory, getGuidedWorkflow, listCategories, listGuidedCategories, runGuidedStep, startGuidedWorkflow, createInstantQuote } from "../services/guidedWorkflow.js";
import { getServiceById, listServiceCatalogs, listServices } from "../services/serviceCatalog.js";
import { getServiceDocs, listServiceDocs } from "../services/serviceDocs.js";
import {
  applyServiceRecommendation,
  chatServiceAdvisor,
  dismissServiceRecommendation,
  getServiceAdvisorSession,
  listSuggestedServices
} from "../services/serviceAdvisor.js";
import { createBundleQuote, createTransportPack, listBundlePresets } from "../services/quoteBundles.js";

const router = Router();
const categories = ["landscape", "hvac", "cleaning", "pest-control", "pool", "painting", "roofing", "plumbing", "electrical", "general-contract", "surveillance", "trash-removal", "transportation", "healthcare", "bakery-food", "law-office"];

router.post("/guided/quote", async (req, res, next) => {
  try {
    const { category, ...input } = req.body || {};
    if (!category) {
      const error = new Error("category is required");
      error.statusCode = 400;
      throw error;
    }
    res.status(201).json(await createInstantQuote(category, input));
  } catch (error) {
    next(error);
  }
});

router.get("/quotes/bundles", (_req, res) => {
  res.json(listBundlePresets());
});

router.post("/quotes/bundle", async (req, res, next) => {
  try {
    res.status(201).json(await createBundleQuote(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/transportation/pack", (req, res, next) => {
  try {
    res.status(201).json(createTransportPack(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/guided/categories", (_req, res) => res.json({ categories: listGuidedCategories() }));
router.get("/categories", (_req, res) => res.json(listCategories()));
router.get("/categories/:category", (req, res, next) => {
  try {
    res.json(getCategory(req.params.category));
  } catch (error) {
    next(error);
  }
});

router.get("/services", (_req, res) => {
  res.json(listServiceCatalogs());
});

router.get("/services/:category", (req, res, next) => {
  try {
    res.json(listServices(req.params.category));
  } catch (error) {
    next(error);
  }
});

router.get("/service-docs", (_req, res, next) => {
  try {
    res.json(listServiceDocs());
  } catch (error) {
    next(error);
  }
});

router.post("/service-docs/advisor/chat", async (req, res, next) => {
  try {
    res.json(await chatServiceAdvisor(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/service-docs/advisor/apply", (req, res, next) => {
  try {
    res.json(applyServiceRecommendation(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/service-docs/advisor/dismiss", (req, res, next) => {
  try {
    res.json(dismissServiceRecommendation(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/service-docs/advisor/sessions/:sessionId", (req, res, next) => {
  try {
    res.json(getServiceAdvisorSession(req.params.sessionId));
  } catch (error) {
    next(error);
  }
});

router.get("/service-docs/:category/suggestions", (req, res, next) => {
  try {
    const suggestions = listSuggestedServices(req.params.category, { limit: 4, excludeExisting: true });
    res.json({
      category: req.params.category,
      count: suggestions.length,
      suggestions
    });
  } catch (error) {
    next(error);
  }
});

router.get("/service-docs/:category", (req, res, next) => {
  try {
    res.json(getServiceDocs(req.params.category));
  } catch (error) {
    next(error);
  }
});

for (const category of categories) {
  router.get(`/${category}/services`, (_req, res, next) => {
    try {
      res.json(listServices(category));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/services/:serviceId`, (req, res, next) => {
    try {
      res.json(getServiceById(category, req.params.serviceId));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/quote`, async (req, res, next) => {
    try {
      res.status(201).json(await createInstantQuote(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  router.post(`/${category}/start`, async (req, res, next) => {
    try {
      res.status(201).json(await startGuidedWorkflow(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  router.get(`/${category}/sessions/:sessionId`, (req, res, next) => {
    try {
      res.json(getGuidedWorkflow(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });
  router.post(`/${category}/sessions/:sessionId/answer`, async (req, res, next) => {
    try {
      res.json(await answerGuidedWorkflow(req.params.sessionId, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  router.post(`/${category}/sessions/:sessionId/run-api`, (req, res, next) => {
    try {
      res.json(runGuidedStep(req.params.sessionId, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  router.post(`/${category}/sessions/:sessionId/invoice`, (req, res, next) => {
    try {
      res.status(201).json(createInvoiceFromSession(req.params.sessionId, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
}

export default router;
