import OpenAI from "openai";
import { appConfig } from "../config/appConfig.js";
import { aggregateInvoiceLogsByArea, loadInvoiceLogDetails } from "./invoiceLogStore.js";
import { assertCategory, getPricingStandards, savePricingStandards } from "./pricingStandards.js";

const client = appConfig.ai.enabled ? new OpenAI({ apiKey: appConfig.ai.apiKey, baseURL: appConfig.ai.baseURL }) : null;

function localSuggestions(category, standards, aggregation, sampleLogs) {
  const underpricedAreas = aggregation.areas.filter(area => {
    const standard = standards.areas?.[area.area];
    const standardHourly = standard?.unitPrices?.hourlyRate || standards.defaults?.unitPrices?.hourlyRate;
    return area.averageHourlyRate && standardHourly && area.averageHourlyRate < standardHourly * 0.9;
  });
  const premiumAreas = aggregation.areas.filter(area => {
    const standard = standards.areas?.[area.area];
    const standardHourly = standard?.unitPrices?.hourlyRate || standards.defaults?.unitPrices?.hourlyRate;
    return area.averageHourlyRate && standardHourly && area.averageHourlyRate > standardHourly * 1.1;
  });

  return {
    mode: "local-fallback",
    category,
    summary: `Reviewed ${aggregation.invoiceCount} invoice log(s) for ${category} against current area pricing standards.`,
    serviceImprovements: [
      "Standardize intake questions so every invoice captures area, labor hours, crew size, and service type.",
      "Follow up on jobs with unusually high labor hours for the same service type to reduce rework.",
      "Bundle recurring maintenance offers in areas with repeated one-off invoices.",
      sampleLogs.length ? "Use recent invoice notes to identify access, scheduling, or scope gaps that slow crews." : "Upload more invoice logs to unlock stronger service pattern detection."
    ],
    pricingSuggestions: [
      underpricedAreas.length
        ? `Consider raising rates in ${underpricedAreas.map(a => a.area).join(", ")} where billed hourly rates trail the standard by more than 10%.`
        : "Billed hourly rates are generally aligned with current standards for areas that have invoice history.",
      premiumAreas.length
        ? `Preserve premium positioning in ${premiumAreas.map(a => a.area).join(", ")}; demand appears able to support higher pricing.`
        : "No clear premium-area outliers yet; keep monitoring high-total jobs by ZIP/city.",
      "Refresh area standards after every batch of invoices so quoting stays close to realized job economics.",
      "Separate minimum trip fees from hourly labor so short jobs remain profitable."
    ],
    areaInsights: aggregation.areas.map(area => ({
      area: area.area,
      invoiceCount: area.invoiceCount,
      averageTotal: area.averageTotal,
      averageHourlyRate: area.averageHourlyRate,
      recommendation: underpricedAreas.some(item => item.area === area.area)
        ? "increase"
        : premiumAreas.some(item => item.area === area.area)
          ? "hold-premium"
          : "monitor"
    })),
    confidence: aggregation.invoiceCount >= 5 ? 0.62 : 0.4
  };
}

async function llmSuggestions(category, standards, aggregation, sampleLogs) {
  if (!client) return localSuggestions(category, standards, aggregation, sampleLogs);
  const response = await client.responses.create({
    model: appConfig.ai.model,
    instructions: "You are a field-service pricing and operations advisor for HA-Corr. Return practical, concise JSON only via the tool. Do not invent invoice facts.",
    input: JSON.stringify({
      category,
      pricingStandards: standards,
      invoiceAggregation: aggregation,
      sampleInvoices: sampleLogs.slice(0, 15)
    }),
    tools: [{
      type: "function",
      name: "pricing_service_advice",
      description: "Suggest service improvements and pricing changes from invoice logs and area standards.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "serviceImprovements", "pricingSuggestions", "areaInsights", "confidence"],
        properties: {
          summary: { type: "string" },
          serviceImprovements: { type: "array", items: { type: "string" } },
          pricingSuggestions: { type: "array", items: { type: "string" } },
          areaInsights: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["area", "recommendation", "rationale"],
              properties: {
                area: { type: "string" },
                recommendation: { type: "string", enum: ["increase", "decrease", "hold", "hold-premium", "monitor", "add-standard"] },
                rationale: { type: "string" }
              }
            }
          },
          confidence: { type: "number" }
        }
      }
    }],
    tool_choice: { type: "function", name: "pricing_service_advice" }
  });
  const call = response.output?.find(item => item.type === "function_call" && item.name === "pricing_service_advice");
  if (!call) return localSuggestions(category, standards, aggregation, sampleLogs);
  const advice = JSON.parse(call.arguments);
  return { mode: "openai", category, ...advice };
}

export async function suggestFromInvoiceLogs(category, input = {}) {
  assertCategory(category);
  const standards = getPricingStandards(category);
  const aggregation = aggregateInvoiceLogsByArea(category, Number(input.limit) || 250);
  const sampleLogs = loadInvoiceLogDetails(category, Math.min(Number(input.sampleSize) || 15, 50));
  if (!aggregation.invoiceCount && !input.allowEmpty) {
    const error = new Error(`No invoice logs found for ${category}. Upload invoices first via POST /api/v1/${category}/invoices/log`);
    error.statusCode = 400;
    throw error;
  }
  const suggestions = await llmSuggestions(category, standards, aggregation, sampleLogs);
  return {
    generatedAt: new Date().toISOString(),
    pricingStandardsVersion: standards.version,
    invoiceCount: aggregation.invoiceCount,
    aggregation,
    suggestions
  };
}

function applyAggregationToStandards(standards, aggregation, options = {}) {
  const blend = Math.min(Math.max(Number(options.blend) || 0.35, 0.05), 0.9);
  const nextAreas = { ...(standards.areas || {}) };
  const changes = [];

  for (const areaStats of aggregation.areas) {
    const existing = nextAreas[areaStats.area] || {
      region: "custom",
      currency: standards.currency || "USD",
      unitPrices: { ...(standards.defaults?.unitPrices || {}) },
      notes: "Created by pricing refresh workflow from invoice logs."
    };
    const unitPrices = { ...(existing.unitPrices || {}) };
    const beforeHourly = unitPrices.hourlyRate;
    if (areaStats.averageHourlyRate) {
      const current = Number(unitPrices.hourlyRate || standards.defaults?.unitPrices?.hourlyRate || areaStats.averageHourlyRate);
      unitPrices.hourlyRate = Number(((current * (1 - blend)) + (areaStats.averageHourlyRate * blend)).toFixed(2));
    }
    if (areaStats.averageTotal && unitPrices.jobMinimum == null) {
      unitPrices.jobMinimum = Number((areaStats.averageTotal * 0.55).toFixed(2));
    }
    if (areaStats.averageTotal) {
      const currentAvg = Number(unitPrices.averageJobTotal || areaStats.averageTotal);
      unitPrices.averageJobTotal = Number(((currentAvg * (1 - blend)) + (areaStats.averageTotal * blend)).toFixed(2));
    }
    nextAreas[areaStats.area] = {
      ...existing,
      unitPrices,
      invoiceCount: areaStats.invoiceCount,
      notes: `Refreshed from ${areaStats.invoiceCount} invoice log(s). ${existing.notes || ""}`.trim()
    };
    changes.push({
      area: areaStats.area,
      invoiceCount: areaStats.invoiceCount,
      hourlyRateBefore: beforeHourly ?? null,
      hourlyRateAfter: unitPrices.hourlyRate ?? null,
      averageJobTotal: unitPrices.averageJobTotal ?? null
    });
  }

  return { areas: nextAreas, changes };
}

async function maybeLlmRefineStandards(category, standards, proposed, aggregation) {
  if (!client || !aggregation.invoiceCount) {
    return { mode: "local-aggregation", areas: proposed.areas, rationale: "Blended invoice averages into area unit prices." };
  }
  try {
    const response = await client.responses.create({
      model: appConfig.ai.model,
      instructions: "Refine field-service area pricing standards conservatively. Return JSON via the tool. Keep unit price keys stable and avoid extreme swings.",
      input: JSON.stringify({ category, currentStandards: standards, proposedAreas: proposed.areas, aggregation }),
      tools: [{
        type: "function",
        name: "update_pricing_standards",
        description: "Return updated areas pricing map.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["rationale", "areas"],
          properties: {
            rationale: { type: "string" },
            areas: { type: "object", additionalProperties: true }
          }
        }
      }],
      tool_choice: { type: "function", name: "update_pricing_standards" }
    });
    const call = response.output?.find(item => item.type === "function_call" && item.name === "update_pricing_standards");
    if (!call) return { mode: "local-aggregation", areas: proposed.areas, rationale: "LLM unavailable; used local blend." };
    const parsed = JSON.parse(call.arguments);
    return { mode: "openai+local-aggregation", areas: parsed.areas || proposed.areas, rationale: parsed.rationale || "LLM refined area pricing." };
  } catch {
    return { mode: "local-aggregation", areas: proposed.areas, rationale: "LLM refine failed; used local blend." };
  }
}

export async function refreshPricingStandards(category, input = {}) {
  assertCategory(category);
  const standards = getPricingStandards(category);
  const aggregation = aggregateInvoiceLogsByArea(category, Number(input.limit) || 250);
  if (!aggregation.invoiceCount && !input.force) {
    const error = new Error(`No invoice logs available to refresh pricing standards for ${category}`);
    error.statusCode = 400;
    throw error;
  }

  const proposed = applyAggregationToStandards(standards, aggregation, { blend: input.blend });
  const refined = input.skipLlm
    ? { mode: "local-aggregation", areas: proposed.areas, rationale: "Skipped LLM by request." }
    : await maybeLlmRefineStandards(category, standards, proposed, aggregation);

  const saved = savePricingStandards(category, {
    defaults: standards.defaults,
    areas: refined.areas,
    currency: standards.currency,
    meta: {
      source: "refresh-workflow",
      lastRefreshAt: new Date().toISOString(),
      lastRefreshMode: refined.mode,
      lastRefreshRationale: refined.rationale,
      invoiceCountUsed: aggregation.invoiceCount
    }
  }, { bumpVersion: true });

  return {
    category,
    workflow: "pricing-standards-refresh",
    mode: refined.mode,
    rationale: refined.rationale,
    invoiceCount: aggregation.invoiceCount,
    changes: proposed.changes,
    standards: saved,
    file: `data/pricing-standards/${category}.json`
  };
}

export async function refreshAllPricingStandards(input = {}) {
  const categories = Array.isArray(input.categories) && input.categories.length
    ? input.categories
    : (await import("../ai/toolCatalog.js")).supportedCategories;
  const results = [];
  for (const category of categories) {
    try {
      results.push(await refreshPricingStandards(category, input));
    } catch (error) {
      results.push({
        category,
        workflow: "pricing-standards-refresh",
        status: "skipped",
        error: error.message
      });
    }
  }
  return {
    workflow: "pricing-standards-refresh-all",
    executedAt: new Date().toISOString(),
    count: results.length,
    results
  };
}

/** Curated mid-market industry unit prices used when OpenAI is unavailable. */
const industryMidMarket = {
  landscape: { hourlyRate: 68, mowingPerThousandSqft: 48, mulchPerCubicYard: 58, fertilizationVisit: 90 },
  hvac: { hourlyRate: 129, diagnosticFee: 95, maintenancePlanMonthly: 49, replacementMarkupPercent: 35 },
  cleaning: { hourlyRate: 48, perSquareFoot: 0.2, deepCleanMultiplier: 1.65, supplyAllowancePercent: 8 },
  "pest-control": { hourlyRate: 99, oneTimeTreatment: 165, recurringMonthly: 59, termiteBondAnnual: 235 },
  pool: { hourlyRate: 79, weeklyService: 150, chemicalAllowance: 38, equipmentRepairMultiplier: 1.4 },
  painting: { hourlyRate: 58, interiorPerSqft: 2.4, exteriorPerSqft: 2.9, materialsMarkupPercent: 25 },
  roofing: { hourlyRate: 89, perSquare: 445, repairMinimum: 375, materialsMarkupPercent: 30 },
  plumbing: { hourlyRate: 145, diagnosticFee: 99, waterHeaterInstall: 1550, emergencyMultiplier: 1.5 },
  electrical: { hourlyRate: 135, panelUpgrade: 2450, evChargerInstall: 1350, diagnosticFee: 99 },
  "general-contract": { hourlyRate: 105, remodelPerSqft: 95, markupMultiplier: 1.35, changeOrderMarkupPercent: 20 },
  surveillance: { hourlyRate: 99, cameraInstallEach: 295, nvrBase: 475, monitoringMonthly: 39 },
  "trash-removal": { hourlyRate: 79, haulMinimum: 195, perCubicYard: 59, dumpsterDay: 49 },
  transportation: { hourlyRate: 79, localMoveMinimum: 275, perMile: 2.95, perCubicFoot: 1.25, crewOfTwoHourly: 160 },
  healthcare: { hourlyRate: 105, nurseVisit: 175, physicianVisit: 310, shiftHourlyRN: 105, shiftHourlyLPN: 78, travelPerMile: 1.35, suppliesPerVisit: 20 }
};

const areaMarketFactors = {
  "Atlanta, GA": { region: "Southeast", factor: 1.0 },
  "Dallas, TX": { region: "South Central", factor: 0.97 },
  "Phoenix, AZ": { region: "Southwest", factor: 0.95 },
  "Chicago, IL": { region: "Midwest", factor: 1.08 },
  "New York, NY": { region: "Northeast", factor: 1.25 }
};

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function scaleUnitPrices(unitPrices, factor) {
  return Object.fromEntries(
    Object.entries(unitPrices || {}).map(([key, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return [key, value];
      // Keep multipliers/percents closer to base; scale money-like rates.
      if (/percent|multiplier|markup/i.test(key)) return [key, roundMoney(numeric)];
      return [key, roundMoney(numeric * factor)];
    })
  );
}

function buildLocalIndustryProposal(category, standards) {
  const baseKeys = Object.keys(standards.defaults?.unitPrices || {});
  const mid = industryMidMarket[category] || standards.defaults?.unitPrices || {};
  const defaults = {
    unitPrices: Object.fromEntries(
      (baseKeys.length ? baseKeys : Object.keys(mid)).map(key => [
        key,
        roundMoney(Number(mid[key] ?? standards.defaults?.unitPrices?.[key] ?? 0))
      ])
    )
  };

  const areas = {};
  const areaNames = Object.keys(standards.areas || {}).length
    ? Object.keys(standards.areas)
    : Object.keys(areaMarketFactors);

  for (const areaName of areaNames) {
    const known = areaMarketFactors[areaName] || { region: standards.areas?.[areaName]?.region || "custom", factor: 1 };
    const existing = standards.areas?.[areaName] || {};
    areas[areaName] = {
      region: existing.region || known.region,
      currency: existing.currency || standards.currency || "USD",
      unitPrices: scaleUnitPrices(defaults.unitPrices, known.factor || 1),
      notes: `Industry-standard update (local mid-market) for ${category}. Review before production use.`
    };
  }

  return {
    mode: "local-industry-standards",
    rationale: `Applied curated ${new Date().getFullYear()} mid-market industry rates for ${category} across metro areas (OpenAI unavailable or skipped).`,
    defaults,
    areas
  };
}

function collectPricingChanges(before, after) {
  const changes = [];
  const areaNames = new Set([...Object.keys(before.areas || {}), ...Object.keys(after.areas || {})]);
  for (const area of areaNames) {
    const beforeHourly = before.areas?.[area]?.unitPrices?.hourlyRate;
    const afterHourly = after.areas?.[area]?.unitPrices?.hourlyRate;
    if (beforeHourly === afterHourly && before.areas?.[area] && after.areas?.[area]) {
      changes.push({
        area,
        hourlyRateBefore: beforeHourly ?? null,
        hourlyRateAfter: afterHourly ?? null,
        changed: false
      });
    } else {
      changes.push({
        area,
        hourlyRateBefore: beforeHourly ?? null,
        hourlyRateAfter: afterHourly ?? null,
        changed: beforeHourly !== afterHourly
      });
    }
  }
  const beforeDefault = before.defaults?.unitPrices?.hourlyRate;
  const afterDefault = after.defaults?.unitPrices?.hourlyRate;
  return {
    defaultHourlyBefore: beforeDefault ?? null,
    defaultHourlyAfter: afterDefault ?? null,
    areas: changes
  };
}

function normalizeProposedAreas(proposedAreas, standards, defaults) {
  const areas = {};
  const source = proposedAreas && typeof proposedAreas === "object" ? proposedAreas : standards.areas || {};
  for (const [areaName, areaValue] of Object.entries(source)) {
    const existing = standards.areas?.[areaName] || {};
    const known = areaMarketFactors[areaName] || {};
    const unitPrices = areaValue?.unitPrices && typeof areaValue.unitPrices === "object"
      ? Object.fromEntries(
        Object.entries({ ...(defaults?.unitPrices || {}), ...areaValue.unitPrices }).map(([key, value]) => [
          key,
          roundMoney(Number(value))
        ])
      )
      : scaleUnitPrices(defaults?.unitPrices || existing.unitPrices || {}, known.factor || 1);
    areas[areaName] = {
      region: areaValue?.region || existing.region || known.region || "custom",
      currency: areaValue?.currency || existing.currency || standards.currency || "USD",
      unitPrices,
      notes: areaValue?.notes || `Industry-standard AI update for ${standards.category}.`
    };
  }
  return areas;
}

async function askAiForIndustryStandards(category, standards) {
  if (!client) return null;
  try {
    const response = await client.responses.create({
      model: appConfig.ai.model,
      instructions: [
        "You are a US field-service pricing analyst for HA-Corr.",
        "Return current industry-standard mid-market unit prices for the category via the tool.",
        "Keep existing unit price keys stable. Prefer realistic 2025-2026 US metro rates.",
        "Do not invent new price keys. Scale metro areas relative to national mid-market."
      ].join(" "),
      input: JSON.stringify({
        task: "Update industry-standard pricing JSON for this category",
        category,
        currentStandards: {
          defaults: standards.defaults,
          areas: standards.areas,
          currency: standards.currency,
          version: standards.version
        },
        requiredUnitPriceKeys: Object.keys(standards.defaults?.unitPrices || {}),
        metroAreas: Object.keys(standards.areas || {})
      }),
      tools: [{
        type: "function",
        name: "industry_pricing_standards",
        description: "Return updated industry-standard defaults and area unit prices.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["rationale", "defaults", "areas"],
          properties: {
            rationale: { type: "string" },
            defaults: {
              type: "object",
              additionalProperties: false,
              required: ["unitPrices"],
              properties: {
                unitPrices: { type: "object", additionalProperties: { type: "number" } }
              }
            },
            areas: {
              type: "object",
              additionalProperties: {
                type: "object",
                additionalProperties: false,
                required: ["region", "unitPrices", "notes"],
                properties: {
                  region: { type: "string" },
                  currency: { type: "string" },
                  unitPrices: { type: "object", additionalProperties: { type: "number" } },
                  notes: { type: "string" }
                }
              }
            }
          }
        }
      }],
      tool_choice: { type: "function", name: "industry_pricing_standards" }
    });
    const call = response.output?.find(item => item.type === "function_call" && item.name === "industry_pricing_standards");
    if (!call) return null;
    const parsed = JSON.parse(call.arguments);
    const defaults = {
      unitPrices: Object.fromEntries(
        Object.entries(parsed.defaults?.unitPrices || standards.defaults?.unitPrices || {}).map(([key, value]) => [
          key,
          roundMoney(Number(value))
        ])
      )
    };
    return {
      mode: "openai-industry-standards",
      rationale: parsed.rationale || `OpenAI returned industry-standard rates for ${category}.`,
      defaults,
      areas: normalizeProposedAreas(parsed.areas, standards, defaults)
    };
  } catch {
    return null;
  }
}

/**
 * Workflow: ask AI for industry-standard pricing and update data/pricing-standards/{category}.json.
 * Falls back to curated mid-market rates when OpenAI is disabled or fails.
 */
export async function runIndustryStandardsWorkflow(category, input = {}) {
  assertCategory(category);
  const standards = getPricingStandards(category);
  let proposal = null;

  if (!input.skipLlm) {
    proposal = await askAiForIndustryStandards(category, standards);
  }
  if (!proposal) {
    proposal = buildLocalIndustryProposal(category, standards);
  }

  const saved = savePricingStandards(category, {
    defaults: proposal.defaults,
    areas: proposal.areas,
    currency: standards.currency || "USD",
    meta: {
      source: "industry-standards-workflow",
      lastIndustryUpdateAt: new Date().toISOString(),
      lastIndustryUpdateMode: proposal.mode,
      lastIndustryUpdateRationale: proposal.rationale
    }
  }, { bumpVersion: true });

  const changes = collectPricingChanges(standards, saved);
  return {
    category,
    workflow: "industry-standards",
    status: "completed",
    mode: proposal.mode,
    rationale: proposal.rationale,
    changes,
    standards: saved,
    file: `data/pricing-standards/${category}.json`
  };
}

export async function runAllIndustryStandardsWorkflows(input = {}) {
  const categories = Array.isArray(input.categories) && input.categories.length
    ? input.categories
    : (await import("../ai/toolCatalog.js")).supportedCategories;
  const results = [];
  for (const category of categories) {
    try {
      results.push(await runIndustryStandardsWorkflow(category, input));
    } catch (error) {
      results.push({
        category,
        workflow: "industry-standards",
        status: "skipped",
        error: error.message
      });
    }
  }
  return {
    workflow: "industry-standards-all",
    executedAt: new Date().toISOString(),
    count: results.length,
    completed: results.filter(item => item.status === "completed").length,
    results
  };
}

export function listPricingWorkflows() {
  return {
    workflows: [
      {
        id: "industry-standards",
        label: "Update industry-standard pricing",
        description: "Ask AI for current industry mid-market rates and write data/pricing-standards/{category}.json.",
        play: "POST /api/v1/{category}/workflows/industry-standards",
        playAll: "POST /api/v1/workflows/industry-standards"
      },
      {
        id: "pricing-standards-refresh",
        label: "Refresh from invoice logs",
        description: "Blend uploaded invoice averages into area rates, optionally refined by AI.",
        play: "POST /api/v1/{category}/pricing-standards/refresh",
        playAll: "POST /api/v1/pricing-standards/refresh"
      }
    ]
  };
}
