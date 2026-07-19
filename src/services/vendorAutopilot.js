import { createCostQuote, evaluateCostGate } from "./costQuote.js";
import { huntLeadsForCategory } from "./leadHunt.js";
import { importHuntLeads, listLeads } from "./vendorLeads.js";
import { quoteSendJobForLead } from "./crmPromote.js";
import { createTransportPack } from "./quoteBundles.js";

/**
 * Real autopilot pipeline for a vendor:
 * cost-quote → hunt → import CRM → draft/send quotes → optional accept→job.
 */
export async function runVendorAutopilot(vendorId, input = {}) {
  const category = input.category || "landscape";
  const segment = input.segment || "b2b";
  const city = input.city || null;
  const limit = Math.min(Number(input.limit || 5), 20);
  const steps = [];

  // 1) Cost gate for hunt
  let costQuote = null;
  let costGate = null;
  if (input.skipCostGate !== true) {
    costQuote = createCostQuote("leads.hunt", {
      category,
      segment,
      city,
      limit,
      maxCostUsd: input.maxCostUsd
    }, { maxCostUsd: input.maxCostUsd });
    steps.push({ step: "cost-quote", ok: true, quoteId: costQuote.quoteId, estimatedUsd: costQuote.estimatedUsd });

    costGate = evaluateCostGate("leads.hunt", {
      category,
      segment,
      city,
      limit,
      costQuoteId: input.costQuoteId || costQuote.quoteId,
      confirmCost: input.confirmCost !== false
    }, {
      costQuoteId: input.costQuoteId || costQuote.quoteId,
      confirmCost: input.confirmCost !== false,
      maxCostUsd: input.maxCostUsd
    });
    if (!costGate.ok) {
      return {
        status: "blocked",
        category,
        segment,
        steps,
        costGate,
        costQuote,
        message: costGate.body?.error || "Cost confirmation required before hunt"
      };
    }
    steps.push({ step: "cost-gate", ok: true });
  }

  // 2) Hunt (file/local/origami depending on env)
  const hunted = await huntLeadsForCategory(category, {
    segment,
    cities: input.cities || (city ? [city] : ["Atlanta"]),
    limit,
    perCityLimit: Math.max(2, Math.ceil(limit / 2)),
    queryLimit: 2,
    provider: input.provider || "local"
  });
  const huntedLeads = hunted.leads || hunted.results || [];
  steps.push({
    step: "hunt",
    ok: true,
    count: hunted.count ?? huntedLeads.length,
    mode: hunted.mode || hunted.provider || hunted.source || "hunt"
  });

  // 3) Import into CRM
  const imported = importHuntLeads(vendorId, huntedLeads, { category, segment });
  steps.push({ step: "import-crm", ok: true, imported: imported.count });

  // 4) Quote (+ optional send / accept→job) for top leads
  const quoteLimit = Math.min(Number(input.quoteLimit || 3), imported.count);
  const quoted = [];
  for (const lead of imported.leads.slice(0, quoteLimit)) {
    const suggested = lead.payload?.suggestedService;
    const result = await quoteSendJobForLead(vendorId, lead, {
      amount: input.defaultQuoteAmount,
      send: input.send !== false,
      accept: input.accept === true,
      serviceName: typeof suggested === "string"
        ? suggested
        : (suggested?.serviceName || suggested?.name || undefined)
    });
    quoted.push(result);
  }
  steps.push({
    step: "quote-send",
    ok: true,
    quoted: quoted.length,
    sent: quoted.filter(item => item.quote?.status === "sent" || item.quote?.status === "accepted").length,
    jobs: quoted.filter(item => item.job).length
  });

  // 5) Optional transport pack attached when category is transportation
  let transportPack = null;
  if (category === "transportation" || input.includeTransportPack) {
    const sample = imported.leads[0];
    transportPack = createTransportPack({
      pickupAddress: sample?.address || "100 Peachtree St, Atlanta, GA 30303",
      dropoffAddress: input.dropoffAddress || "500 Ponce De Leon Ave, Atlanta, GA 30308",
      distanceMiles: input.distanceMiles || 8
    });
    steps.push({ step: "transport-pack", ok: true, total: transportPack.total });
  }

  const pipeline = listLeads(vendorId, { category, limit: 50 });

  return {
    status: "completed",
    category,
    segment,
    costQuote,
    hunted: { count: hunted.count ?? huntedLeads.length, mode: hunted.mode || hunted.provider || hunted.source },
    imported: { count: imported.count, leadIds: imported.leads.map(lead => lead.id) },
    quoted: quoted.map(item => ({
      leadId: item.lead.id,
      quoteId: item.quote.id,
      status: item.quote.status,
      amount: item.quote.amount,
      jobId: item.job?.id || null,
      link: item.link
    })),
    transportPack,
    steps,
    crmSnapshot: { leadCount: pipeline.count },
    message: `Autopilot imported ${imported.count} leads and created ${quoted.length} quotes.`
  };
}
