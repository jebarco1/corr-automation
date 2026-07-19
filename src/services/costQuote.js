import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { appConfig } from "../config/appConfig.js";
import { supportedCategories } from "../ai/toolCatalog.js";
import {
  isOrigamiEnabled,
  listPilotCities,
  resolveLeadProvider
} from "./leadHunt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const costsPath = path.join(__dirname, "../../data/provider-costs.json");

const quoteStore = new Map();

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function readCostConfig() {
  const base = JSON.parse(fs.readFileSync(costsPath, "utf8"));
  // Env overrides for quick tuning without editing JSON.
  if (process.env.COST_ORIGAMI_CREDIT_USD) {
    base.providers.origami.creditUsd = Number(process.env.COST_ORIGAMI_CREDIT_USD);
  }
  if (process.env.COST_ORIGAMI_RUN_CREDITS) {
    base.providers.origami.agentRunCredits.default = Number(process.env.COST_ORIGAMI_RUN_CREDITS);
  }
  if (process.env.COST_REGRID_REQUEST_USD) {
    base.providers.regrid.requestUsd = Number(process.env.COST_REGRID_REQUEST_USD);
  }
  if (process.env.COST_OPENAI_INPUT_PER_1K_USD || process.env.COST_OPENAI_OUTPUT_PER_1K_USD) {
    const modelKey = appConfig.ai.model || "default";
    const models = base.providers.openai.models;
    const current = models[modelKey] || models.default;
    models[modelKey] = {
      inputPer1kUsd: Number(process.env.COST_OPENAI_INPUT_PER_1K_USD || current.inputPer1kUsd),
      outputPer1kUsd: Number(process.env.COST_OPENAI_OUTPUT_PER_1K_USD || current.outputPer1kUsd)
    };
  }
  return base;
}

function lineItem({ provider, process, units, unit, unitCost, unitCostCredits = null, notes = null }) {
  const qty = Number(units) || 0;
  const unitUsd = Number(unitCost) || 0;
  return {
    provider,
    process,
    units: qty,
    unit,
    unitCostUsd: roundMoney(unitUsd),
    unitCostCredits: unitCostCredits == null ? null : Number(unitCostCredits),
    subtotalUsd: roundMoney(qty * unitUsd),
    notes
  };
}

function openaiModelRates(config, model) {
  const models = config.providers.openai.models;
  return models[model] || models.default;
}

function origamiRunCredits(config, model) {
  const table = config.providers.origami.agentRunCredits;
  const key = model || appConfig.origami.model || "default";
  return Number(table[key] || table.default || 40);
}

function estimateOpenAiCall(config, callKey, model) {
  const typical = config.providers.openai.typicalCalls[callKey] || config.providers.openai.typicalCalls.categoryInfer;
  const rates = openaiModelRates(config, model || appConfig.ai.model);
  const inputCost = (typical.inputTokens / 1000) * rates.inputPer1kUsd;
  const outputCost = (typical.outputTokens / 1000) * rates.outputPer1kUsd;
  return {
    inputTokens: typical.inputTokens,
    outputTokens: typical.outputTokens,
    usd: roundMoney(inputCost + outputCost),
    rates
  };
}

function pruneQuoteStore() {
  const now = Date.now();
  for (const [id, quote] of quoteStore.entries()) {
    if (new Date(quote.expiresAt).getTime() <= now) quoteStore.delete(id);
  }
}

function storeQuote(quote) {
  pruneQuoteStore();
  quoteStore.set(quote.quoteId, quote);
  return quote;
}

export function getCostRates() {
  const config = readCostConfig();
  return {
    version: config.version,
    currency: config.currency,
    updatedAt: config.updatedAt,
    notes: config.notes,
    providers: config.providers,
    operations: config.operations,
    enabled: {
      openai: Boolean(appConfig.ai.enabled),
      origami: isOrigamiEnabled(),
      regrid: Boolean(process.env.REGRID_API_TOKEN)
    },
    policy: {
      requireConfirmation: String(process.env.COST_REQUIRE_CONFIRMATION || "").toLowerCase() === "true",
      quoteTtlSeconds: Number(process.env.COST_QUOTE_TTL_SECONDS || 1800),
      defaultMaxCostUsd: process.env.COST_DEFAULT_MAX_USD
        ? Number(process.env.COST_DEFAULT_MAX_USD)
        : null
    }
  };
}

export function listCostOperations() {
  const config = readCostConfig();
  return {
    currency: config.currency,
    operations: Object.entries(config.operations).map(([id, meta]) => ({
      id,
      description: meta.description,
      billable: meta.billable
    }))
  };
}

export function getStoredQuote(quoteId) {
  pruneQuoteStore();
  return quoteStore.get(quoteId) || null;
}

function resolveHuntScope(params = {}) {
  const categories = params.categories?.length
    ? params.categories.filter(category => supportedCategories.includes(category))
    : (params.category && supportedCategories.includes(params.category)
      ? [params.category]
      : [...supportedCategories]);
  const cities = listPilotCities({
    cities: params.cities,
    includeAll: !!params.includeAllCities
  });
  const provider = resolveLeadProvider(params.provider);
  const perCityLimit = Number(params.perCityLimit || 5);
  const queryLimit = Number(params.queryLimit || 3);
  return {
    segment: params.segment || "b2b",
    categories,
    cities,
    provider,
    perCityLimit,
    queryLimit,
    origamiModel: params.origamiModel || appConfig.origami.model || "default",
    enrichContacts: params.enrichContacts !== false
  };
}

function quoteLeadsHunt(config, params = {}) {
  const scope = resolveHuntScope(params);
  const cityCount = scope.cities.length;
  const categoryCount = scope.categories.length;
  const combos = cityCount * categoryCount;
  const items = [];
  const processes = [];
  const assumptions = [];

  if (scope.provider === "origami") {
    const runCredits = origamiRunCredits(config, scope.origamiModel);
    const creditUsd = Number(config.providers.origami.creditUsd);
    const followProb = Number(config.providers.origami.followUpRunProbability || 0);
    const baseRuns = combos;
    const followRuns = roundMoney(baseRuns * followProb);
    const leadCredits = Number(config.providers.origami.perLeadEnrichmentCredits || 0)
      * combos * scope.perCityLimit;

    items.push(lineItem({
      provider: "origami",
      process: "agent.create+run",
      units: baseRuns,
      unit: "agent-run",
      unitCost: runCredits * creditUsd,
      unitCostCredits: runCredits,
      notes: `model=${scope.origamiModel || "default"}; ${runCredits} credits/run @ $${creditUsd}/credit`
    }));
    if (followRuns > 0) {
      items.push(lineItem({
        provider: "origami",
        process: "agent.follow-up-run",
        units: followRuns,
        unit: "expected-run",
        unitCost: runCredits * creditUsd,
        unitCostCredits: runCredits,
        notes: `assumes ${Math.round(followProb * 100)}% needs_input follow-up`
      }));
    }
    if (leadCredits > 0) {
      items.push(lineItem({
        provider: "origami",
        process: "lead.enrichment",
        units: combos * scope.perCityLimit,
        unit: "lead",
        unitCost: Number(config.providers.origami.perLeadEnrichmentCredits || 0) * creditUsd,
        unitCostCredits: Number(config.providers.origami.perLeadEnrichmentCredits || 0),
        notes: "optional enrichment buffer per returned lead"
      }));
    }
    items.push(lineItem({
      provider: "origami",
      process: "table.rows.read",
      units: combos,
      unit: "table-read",
      unitCost: Number(config.providers.origami.tableReadUsd || 0),
      notes: "reads are typically free"
    }));
    processes.push({
      name: "origami-lead-hunt",
      steps: [
        "POST /api/v2/agents (1 per category×city)",
        "GET /api/v2/agents/{id}/runs/{runId} poll until complete",
        "optional follow-up POST /api/v2/agents/{id}/runs",
        "GET /api/v2/tables/{tableId}/rows?cells=flat"
      ],
      count: combos
    });
    assumptions.push(
      `Origami enabled: ${isOrigamiEnabled()}`,
      `${categoryCount} categories × ${cityCount} cities = ${combos} primary agent runs`,
      `perCityLimit=${scope.perCityLimit}`
    );
    if (!isOrigamiEnabled()) {
      assumptions.push("ORIGAMI_API_KEY missing — runtime may fall back to local ($0) unless fallbackLocal=false");
    }
  } else {
    const queries = combos * Math.max(scope.queryLimit, 3);
    const enrichPages = combos * scope.perCityLimit * (scope.enrichContacts ? 3 : 0);
    items.push(lineItem({
      provider: "local",
      process: "duckduckgo.search",
      units: queries,
      unit: "query",
      unitCost: Number(config.providers.local.duckduckgoQueryUsd || 0),
      notes: "local HTML search — $0 by default"
    }));
    items.push(lineItem({
      provider: "local",
      process: "page.enrich",
      units: enrichPages,
      unit: "page-fetch",
      unitCost: Number(config.providers.local.pageEnrichUsd || 0),
      notes: "contact page scraping — $0 by default"
    }));
    processes.push({
      name: "local-lead-hunt",
      steps: ["DuckDuckGo HTML search", "optional page enrichment for phone/email/address"],
      count: combos
    });
    assumptions.push("provider=local — no Origami/OpenAI spend expected");
  }

  return {
    scope: {
      segment: scope.segment,
      provider: scope.provider,
      categories: scope.categories,
      cities: scope.cities.map(city => city.label || `${city.city}, ${city.state}`),
      cityCount,
      categoryCount,
      combos,
      perCityLimit: scope.perCityLimit,
      queryLimit: scope.queryLimit,
      origamiModel: scope.origamiModel
    },
    lineItems: items,
    processes,
    assumptions
  };
}

function quoteOpenAiOperation(config, operation, params = {}) {
  const skipLlm = params.skipLlm === true || !appConfig.ai.enabled;
  const model = params.model || appConfig.ai.model;
  const callKey = {
    "ai.assistant": "categoryInfer",
    "ai.start": "categoryInfer",
    "guided.quote": "categoryInfer",
    "pricing.industry-standards": "industryStandards",
    "pricing.refresh": "standardsRefresh",
    "pricing.suggest": "invoiceSuggest"
  }[operation] || "categoryInfer";

  const items = [];
  const processes = [];
  const assumptions = [];

  if (skipLlm) {
    assumptions.push(appConfig.ai.enabled
      ? "skipLlm=true — OpenAI call skipped"
      : "OPENAI_API_KEY missing — local fallback only");
  } else {
    const estimate = estimateOpenAiCall(config, callKey, model);
    items.push(lineItem({
      provider: "openai",
      process: `responses.create:${callKey}`,
      units: 1,
      unit: "llm-call",
      unitCost: estimate.usd,
      notes: `${model}: ~${estimate.inputTokens} in / ${estimate.outputTokens} out tokens`
    }));
    processes.push({
      name: "openai-responses",
      steps: ["OpenAI responses.create"],
      count: 1
    });
  }

  const wantsRegrid = ["ai.assistant", "ai.start", "guided.quote"].includes(operation)
    && (params.address || params.autoRegrid !== false);
  if (wantsRegrid && process.env.REGRID_API_TOKEN) {
    const reqs = Number(config.providers.regrid.acreageRequests || 1);
    items.push(lineItem({
      provider: "regrid",
      process: "parcels.address",
      units: reqs,
      unit: "request",
      unitCost: Number(config.providers.regrid.requestUsd),
      notes: "auto parcel lookup when address is present"
    }));
    processes.push({ name: "regrid-acreage", steps: ["GET /api/v2/parcels/address"], count: reqs });
  } else if (wantsRegrid) {
    assumptions.push("Regrid token missing — parcel lookup skipped");
  }

  return {
    scope: { operation, model, skipLlm, address: Boolean(params.address) },
    lineItems: items,
    processes,
    assumptions
  };
}

function quoteRegrid(config, operation) {
  const nearby = operation === "regrid.nearby";
  const units = nearby
    ? Number(config.providers.regrid.nearbyRequests || 2)
    : Number(config.providers.regrid.acreageRequests || 1);
  const process = nearby ? "parcels.point(+count)" : "parcels.address";
  return {
    scope: { operation, enabled: Boolean(process.env.REGRID_API_TOKEN) },
    lineItems: [
      lineItem({
        provider: "regrid",
        process,
        units,
        unit: "request",
        unitCost: Number(config.providers.regrid.requestUsd),
        notes: process.env.REGRID_API_TOKEN ? null : "REGRID_API_TOKEN missing — call will fail/skip"
      })
    ],
    processes: [{
      name: nearby ? "regrid-nearby" : "regrid-acreage",
      steps: nearby
        ? ["GET /api/v2/parcels/point", "GET /api/v2/parcels/point?return_count=true"]
        : ["GET /api/v2/parcels/address"],
      count: units
    }],
    assumptions: []
  };
}

function buildTotals(lineItems) {
  const likely = roundMoney(lineItems.reduce((sum, item) => sum + item.subtotalUsd, 0));
  const min = roundMoney(likely * 0.7);
  const max = roundMoney(Math.max(likely * 1.45, likely + 0.01 * (likely > 0 ? 1 : 0)));
  return {
    currency: "USD",
    estimatedUsd: likely,
    range: { minUsd: min, likelyUsd: likely, maxUsd: max },
    lineItemCount: lineItems.length
  };
}

export function createCostQuote(operation, params = {}, options = {}) {
  const config = readCostConfig();
  const op = String(operation || "").trim();
  if (!config.operations[op]) {
    const error = new Error(`Unknown cost operation: ${op}. Use GET /api/v1/cost/operations`);
    error.statusCode = 400;
    throw error;
  }

  let built;
  if (op === "leads.hunt") built = quoteLeadsHunt(config, params);
  else if (op.startsWith("regrid.")) built = quoteRegrid(config, op);
  else built = quoteOpenAiOperation(config, op, params);

  const totals = buildTotals(built.lineItems);
  const ttlSeconds = Number(options.ttlSeconds || process.env.COST_QUOTE_TTL_SECONDS || 1800);
  const quoteId = `cq_${crypto.randomBytes(8).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  const quote = {
    quoteId,
    object: "cost_quote",
    operation: op,
    description: config.operations[op].description,
    createdAt: now.toISOString(),
    expiresAt,
    currency: config.currency,
    ...totals,
    scope: built.scope,
    lineItems: built.lineItems,
    processes: built.processes,
    assumptions: [
      ...built.assumptions,
      "Estimates are preflight only — actual provider invoices may differ.",
      "Tune rates in data/provider-costs.json or COST_* env vars."
    ],
    providersEnabled: {
      openai: Boolean(appConfig.ai.enabled),
      origami: isOrigamiEnabled(),
      regrid: Boolean(process.env.REGRID_API_TOKEN)
    },
    proceed: {
      requiresConfirmation: String(process.env.COST_REQUIRE_CONFIRMATION || "").toLowerCase() === "true"
        || Boolean(options.requireConfirmation),
      confirmWith: {
        costQuoteId: quoteId,
        confirmCost: true
      },
      maxCostUsdHint: totals.range.maxUsd,
      endpoints: proceedEndpoints(op, params)
    }
  };

  return storeQuote(quote);
}

function proceedEndpoints(operation, params = {}) {
  if (operation === "leads.hunt") {
    const segment = params.segment === "residential" ? "residential" : "b2b";
    if (params.category) {
      return [
        `POST /api/v1/${params.category}/leads/${segment}/hunt`,
        `POST /api/v1/leads/${segment}/hunt`
      ];
    }
    return [
      `POST /api/v1/leads/${segment}/hunt`,
      "POST /api/v1/leads/hunt"
    ];
  }
  const map = {
    "ai.assistant": ["POST /api/v1/ai/assistant"],
    "ai.start": ["POST /api/v1/ai/start"],
    "guided.quote": ["POST /api/v1/guided/start", "POST /api/v1/ai/assistant"],
    "pricing.industry-standards": ["POST /api/v1/workflows/industry-standards", "POST /api/v1/{category}/workflows/industry-standards"],
    "pricing.refresh": ["POST /api/v1/pricing-standards/refresh", "POST /api/v1/{category}/pricing-standards/refresh"],
    "pricing.suggest": ["POST /api/v1/{category}/invoices/suggest"],
    "regrid.acreage": ["POST /api/v1/landscape/properties/acreage"],
    "regrid.nearby": ["POST /api/v1/landscape/properties/nearby", "GET /api/v1/landscape/properties/nearby"]
  };
  return map[operation] || [];
}

/**
 * Gate expensive work. Returns { ok:true } or { ok:false, statusCode, body }.
 * - quoteOnly → return quote, do not proceed
 * - COST_REQUIRE_CONFIRMATION / requireCostQuote → need confirmCost or matching costQuoteId
 * - maxCostUsd → reject if likely estimate exceeds cap
 */
export function evaluateCostGate(operation, params = {}, body = {}) {
  const quoteId = body.costQuoteId || body.quoteId || null;
  const stored = quoteId ? getStoredQuote(quoteId) : null;
  const quote = stored && stored.operation === operation
    ? stored
    : createCostQuote(operation, { ...params, ...body }, {
      requireConfirmation: body.requireCostQuote === true
    });

  if (body.quoteOnly === true) {
    return {
      ok: false,
      statusCode: 200,
      body: {
        proceed: false,
        reason: "quote_only",
        message: "Cost quote only — re-submit with confirmCost:true (and costQuoteId) to proceed.",
        quote
      }
    };
  }

  const requireConfirmation = quote.proceed.requiresConfirmation
    || body.requireCostQuote === true
    || String(process.env.COST_REQUIRE_CONFIRMATION || "").toLowerCase() === "true";

  if (requireConfirmation) {
    const confirmed = body.confirmCost === true;
    if (!confirmed) {
      return {
        ok: false,
        statusCode: 402,
        body: {
          proceed: false,
          reason: "confirmation_required",
          code: "COST_CONFIRMATION_REQUIRED",
          error: "Confirm estimated API cost before proceeding.",
          quote,
          confirmWith: { costQuoteId: quote.quoteId, confirmCost: true }
        }
      };
    }
    if (!quoteId || !stored || stored.operation !== operation) {
      return {
        ok: false,
        statusCode: 402,
        body: {
          proceed: false,
          reason: "invalid_quote",
          code: "COST_QUOTE_INVALID",
          error: "Provide a valid costQuoteId from POST /api/v1/cost/quote for this operation, plus confirmCost:true.",
          quote
        }
      };
    }
  }

  const maxCostUsd = body.maxCostUsd != null
    ? Number(body.maxCostUsd)
    : (process.env.COST_DEFAULT_MAX_USD ? Number(process.env.COST_DEFAULT_MAX_USD) : null);

  if (maxCostUsd != null && Number.isFinite(maxCostUsd) && quote.estimatedUsd > maxCostUsd) {
    return {
      ok: false,
      statusCode: 402,
      body: {
        proceed: false,
        reason: "max_cost_exceeded",
        code: "COST_MAX_EXCEEDED",
        error: `Estimated $${quote.estimatedUsd} exceeds maxCostUsd $${maxCostUsd}.`,
        quote,
        maxCostUsd
      }
    };
  }

  return {
    ok: true,
    quote,
    approved: {
      costQuoteId: quote.quoteId,
      estimatedUsd: quote.estimatedUsd,
      range: quote.range
    }
  };
}
