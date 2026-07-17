import { Router } from "express";
import { answerGuidedWorkflow, createInvoiceFromSession, getCategory, getGuidedWorkflow, listCategories, listGuidedCategories, runGuidedStep, startGuidedWorkflow, createInstantQuote } from "../services/guidedWorkflow.js";

const router = Router();
const categories = ["landscape", "hvac", "cleaning", "pest-control", "pool", "painting", "roofing", "plumbing", "electrical", "general-contract", "surveillance", "trash-removal", "transportation", "healthcare"];

router.post("/guided/quote", (req, res, next) => {
  try {
    const { category, ...input } = req.body || {};
    if (!category) {
      const error = new Error("category is required");
      error.statusCode = 400;
      throw error;
    }
    res.status(201).json(createInstantQuote(category, input));
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

for (const category of categories) {
  router.post(`/${category}/quote`, (req, res, next) => {
    try {
      res.status(201).json(createInstantQuote(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
  router.post(`/${category}/start`, (req, res, next) => {
    try {
      res.status(201).json(startGuidedWorkflow(category, req.body || {}));
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
  router.post(`/${category}/sessions/:sessionId/answer`, (req, res, next) => {
    try {
      res.json(answerGuidedWorkflow(req.params.sessionId, req.body || {}));
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
