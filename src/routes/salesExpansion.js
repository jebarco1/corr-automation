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
  getSegmentLeadTargets,
  huntB2bLeads,
  huntLeadsForAllCategories,
  huntLeadsForCategory,
  huntResidentialLeads,
  listAllLeads,
  listLeadTargetCatalog,
  listLeads,
  listPilotCities,
  listSegmentLeads,
  LEAD_SEGMENTS
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

/** B2B leads API — commercial / multi-family / facility customers */
router.get("/leads/b2b", (req, res, next) => {
  try {
    res.json(listSegmentLeads("b2b", {
      category: req.query.category,
      city: req.query.city,
      limit: req.query.limit,
      includeLeads: req.query.includeLeads !== "false"
    }));
  } catch (error) {
    next(error);
  }
});

router.post("/leads/b2b/hunt", requireClientApiKey, async (req, res, next) => {
  try {
    res.status(202).json(await huntB2bLeads(req.body || {}));
  } catch (error) {
    next(error);
  }
});

/** Residential leads API — homeowners / consumer customers */
router.get("/leads/residential", (req, res, next) => {
  try {
    res.json(listSegmentLeads("residential", {
      category: req.query.category,
      city: req.query.city,
      limit: req.query.limit,
      includeLeads: req.query.includeLeads !== "false"
    }));
  } catch (error) {
    next(error);
  }
});

router.post("/leads/residential/hunt", requireClientApiKey, async (req, res, next) => {
  try {
    res.status(202).json(await huntResidentialLeads(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get("/leads/segments", (_req, res) => {
  res.json({
    segments: LEAD_SEGMENTS,
    marketFile: "data/markets/georgia-cities.json",
    pilotCities: listPilotCities().map(city => city.label),
    endpoints: {
      b2b: { list: "/api/v1/leads/b2b", hunt: "/api/v1/leads/b2b/hunt" },
      residential: { list: "/api/v1/leads/residential", hunt: "/api/v1/leads/residential/hunt" }
    }
  });
});

for (const category of supportedCategories) {
  router.get(`/${category}/lead-targets`, (_req, res, next) => {
    try {
      res.json(getLeadTargets(category));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/lead-targets/:segment`, (req, res, next) => {
    try {
      res.json(getSegmentLeadTargets(category, req.params.segment));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/leads`, (req, res, next) => {
    try {
      res.json(listLeads(category, {
        segment: req.query.segment,
        city: req.query.city,
        limit: req.query.limit
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/leads/b2b`, (req, res, next) => {
    try {
      res.json(listLeads(category, {
        segment: "b2b",
        city: req.query.city,
        limit: req.query.limit
      }));
    } catch (error) {
      next(error);
    }
  });

  router.get(`/${category}/leads/residential`, (req, res, next) => {
    try {
      res.json(listLeads(category, {
        segment: "residential",
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

  router.post(`/${category}/leads/b2b/hunt`, requireClientApiKey, async (req, res, next) => {
    try {
      res.status(202).json(await huntLeadsForCategory(category, { ...(req.body || {}), segment: "b2b" }));
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${category}/leads/residential/hunt`, requireClientApiKey, async (req, res, next) => {
    try {
      res.status(202).json(await huntLeadsForCategory(category, { ...(req.body || {}), segment: "residential" }));
    } catch (error) {
      next(error);
    }
  });
}

export default router;
