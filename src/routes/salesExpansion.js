import { Router } from "express";
import { requireClientApiKey } from "../middleware/clientApiKey.js";
import {
  analyzeClientDensity,
  findExpansionOpportunities,
  recommendProductExpansion,
  runMarketExpansion
} from "../services/marketExpansion.js";

const router = Router();

router.post("/sales/client-density", requireClientApiKey, (req, res, next) => {
  try {
    res.json(analyzeClientDensity(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/sales/expansion-opportunities", requireClientApiKey, (req, res, next) => {
  try {
    res.json(findExpansionOpportunities(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/sales/product-expansion", requireClientApiKey, (req, res, next) => {
  try {
    res.json(recommendProductExpansion(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post("/sales/market-expansion", requireClientApiKey, (req, res, next) => {
  try {
    res.status(200).json(runMarketExpansion(req.body || {}));
  } catch (error) {
    next(error);
  }
});

export default router;
