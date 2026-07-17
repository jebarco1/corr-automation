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
