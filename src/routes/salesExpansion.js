import { Router } from "express";
import { requireClientApiKey } from "../middleware/clientApiKey.js";
import { supportedCategories } from "../ai/toolCatalog.js";
import {
  analyzeClientDensity,
  findExpansionOpportunities,
  recommendProductExpansion,
  runMarketExpansion
} from "../services/marketExpansion.js";
import {
  getGeorgiaMarkets,
  getLeadTargets,
  huntLeadsForAllCategories,
  huntLeadsForCategory,
  listAllLeads,
  listLeadTargetCatalog,
  listLeads,
  listPilotCities
} from "../services/leadHunt.js";

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

router.get("/markets/georgia", (_req, res) => {
  res.json(getGeorgiaMarkets());
});

router.get("/markets/georgia/pilots", (_req, res) => {
  res.json({
    marketFile: "data/markets/georgia-cities.json",
    pilots: listPilotCities(),
    labels: listPilotCities().map(city => city.label)
  });
});

router.get("/lead-targets", (_req, res) => {
  res.json(listLeadTargetCatalog());
});

router.get("/leads", (_req, res) => {
  res.json(listAllLeads());
});

router.post("/leads/hunt", requireClientApiKey, async (req, res, next) => {
  try {
    res.status(202).json(await huntLeadsForAllCategories(req.body || {}));
  } catch (error) {
    next(error);
  }
});

for (const category of supportedCategories) {
  router.get(`/${category}/lead-targets`, (_req, res, next) => {
    try {
      res.json(getLeadTargets(category));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/leads`, (req, res, next) => {
    try {
      res.json(listLeads(category, {
        city: req.query.city,
        limit: req.query.limit
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/leads/hunt`, requireClientApiKey, async (req, res, next) => {
    try {
      res.status(202).json(await huntLeadsForCategory(category, req.body || {}));
    } catch (error) {
      next(error);
    }
  });
}

export default router;
