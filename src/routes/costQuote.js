import { Router } from "express";
import {
  createCostQuote,
  getCostRates,
  getStoredQuote,
  listCostOperations
} from "../services/costQuote.js";

const router = Router();

router.get("/cost/rates", (_req, res) => {
  res.json(getCostRates());
});

router.get("/cost/operations", (_req, res) => {
  res.json(listCostOperations());
});

router.get("/cost/quote/:quoteId", (req, res) => {
  const quote = getStoredQuote(req.params.quoteId);
  if (!quote) {
    return res.status(404).json({
      error: "Cost quote not found or expired",
      code: "COST_QUOTE_NOT_FOUND"
    });
  }
  return res.json(quote);
});

/**
 * Preflight cost quote for a planned request.
 * Body: { operation, params?, requireConfirmation? }
 */
router.post("/cost/quote", (req, res, next) => {
  try {
    const body = req.body || {};
    const operation = body.operation || body.op;
    const params = body.params || body.input || {};
    // Allow top-level hunt/AI fields as params shorthand.
    const merged = {
      ...params,
      ...(body.segment ? { segment: body.segment } : {}),
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.cities ? { cities: body.cities } : {}),
      ...(body.categories ? { categories: body.categories } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.perCityLimit != null ? { perCityLimit: body.perCityLimit } : {}),
      ...(body.skipLlm != null ? { skipLlm: body.skipLlm } : {}),
      ...(body.address ? { address: body.address } : {})
    };
    const quote = createCostQuote(operation, merged, {
      requireConfirmation: body.requireConfirmation === true
    });
    res.status(201).json({
      proceed: false,
      message: "Review estimated cost before calling the target endpoint.",
      quote,
      next: {
        confirm: {
          costQuoteId: quote.quoteId,
          confirmCost: true,
          maxCostUsd: body.maxCostUsd ?? quote.range.maxUsd
        },
        endpoints: quote.proceed.endpoints
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
