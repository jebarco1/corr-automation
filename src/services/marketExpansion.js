import { supportedCategories, categoryApiTools } from "../ai/toolCatalog.js";
import { aggregateInvoiceLogsByArea, loadInvoiceLogDetails } from "./invoiceLogStore.js";
import { getPricingStandards } from "./pricingStandards.js";

const REGION_NEIGHBORS = {
  "Atlanta, GA": ["Marietta, GA", "Decatur, GA", "Alpharetta, GA", "Sandy Springs, GA", "Dallas, TX"],
  "Dallas, TX": ["Fort Worth, TX", "Plano, TX", "Arlington, TX", "Austin, TX", "Houston, TX"],
  "Phoenix, AZ": ["Scottsdale, AZ", "Tempe, AZ", "Mesa, AZ", "Tucson, AZ", "Las Vegas, NV"],
  "Chicago, IL": ["Naperville, IL", "Evanston, IL", "Milwaukee, WI", "Indianapolis, IN", "Detroit, MI"],
  "New York, NY": ["Jersey City, NJ", "Newark, NJ", "Brooklyn, NY", "White Plains, NY", "Philadelphia, PA"],
  "Marietta, GA": ["Atlanta, GA", "Alpharetta, GA"],
  "Austin, TX": ["Dallas, TX", "Houston, TX", "San Antonio, TX"],
  "Houston, TX": ["Dallas, TX", "Austin, TX"],
  "Philadelphia, PA": ["New York, NY", "Baltimore, MD"]
};

const CATEGORY_EXPANSION = {
  landscape: ["fertilization", "irrigation repair", "hardscape", "snow removal", "commercial grounds"],
  hvac: ["maintenance plans", "indoor air quality", "commercial rooftop", "duct cleaning"],
  cleaning: ["post-construction", "carpet care", "window cleaning", "healthcare janitorial"],
  "pest-control": ["termite bonds", "mosquito", "commercial kitchen", "wildlife exclusion"],
  pool: ["equipment repair", "commercial pools", "seasonal openings", "automation installs"],
  painting: ["cabinets", "exterior coatings", "commercial common areas", "HOA packages"],
  roofing: ["gutters", "storm restoration", "flat roofing", "maintenance plans"],
  plumbing: ["water heaters", "backflow testing", "repiping", "drain memberships"],
  electrical: ["EV chargers", "generators", "panel upgrades", "commercial lighting"],
  "general-contract": ["kitchen/bath remodel", "ADA upgrades", "tenant build-out", "insurance restoration"],
  surveillance: ["access control", "alarm monitoring", "commercial multi-site", "retention upgrades"],
  "trash-removal": ["dumpster rental", "recurring commercial", "construction debris", "estate cleanouts"],
  transportation: ["same-day delivery", "white-glove moving", "materials haul for trades", "recurring B2B routes"],
  healthcare: ["physician house calls", "chronic care management", "private duty shifts", "post-acute follow-up"],
  "bakery-food": ["wholesale cafe program", "wedding dessert tables", "corporate breakfast routes", "allergen-friendly specialty"],
  "law-office": ["business formation packages", "monthly GC retainer", "estate planning clinics", "real estate closing desk", "divorce retainer packages"]
};

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function avg(values) {
  if (!values.length) return null;
  return money(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizeArea(value) {
  return String(value || "Unknown").trim();
}

function collectRecords(input = {}) {
  const records = [];

  for (const client of input.clients || []) {
    records.push({
      source: "client",
      area: normalizeArea(client.area || client.city || client.serviceArea || client.address),
      revenue: Number(client.revenue ?? client.lifetimeValue ?? client.annualRevenue ?? 0) || 0,
      services: Array.isArray(client.services) ? client.services : (client.serviceType ? [client.serviceType] : []),
      clientId: client.clientId || client.customerId || client.id || null,
      category: client.category || input.category || null
    });
  }

  for (const invoice of input.invoices || []) {
    const nested = invoice.invoice || invoice;
    records.push({
      source: "invoice",
      area: normalizeArea(invoice.area || nested.serviceArea || nested.area || nested.serviceAddress),
      revenue: Number(nested.total ?? invoice.total ?? 0) || 0,
      services: Array.isArray(invoice.services)
        ? invoice.services
        : (invoice.serviceType || nested.serviceType ? [invoice.serviceType || nested.serviceType] : []),
      clientId: nested.customer?.id || nested.customerId || invoice.clientId || null,
      category: invoice.category || input.category || null
    });
  }

  return records;
}

function recordsFromInvoiceLogs(category, limit = 250) {
  const details = loadInvoiceLogDetails(category, limit);
  return details.map(log => ({
    source: "invoice-log",
    area: normalizeArea(log.area),
    revenue: Number(log.total || 0) || 0,
    services: log.serviceType ? [log.serviceType] : [],
    clientId: log.invoice?.customer?.email || log.invoice?.customer?.name || null,
    category
  }));
}

function buildDensity(records) {
  const byArea = new Map();
  let totalRevenue = 0;
  const clients = new Set();

  for (const record of records) {
    totalRevenue += record.revenue;
    if (record.clientId) clients.add(String(record.clientId));
    if (!byArea.has(record.area)) {
      byArea.set(record.area, {
        area: record.area,
        clientIds: new Set(),
        invoiceOrClientCount: 0,
        revenue: 0,
        services: new Map()
      });
    }
    const bucket = byArea.get(record.area);
    bucket.invoiceOrClientCount += 1;
    bucket.revenue += record.revenue;
    if (record.clientId) bucket.clientIds.add(String(record.clientId));
    for (const service of record.services) {
      bucket.services.set(service, (bucket.services.get(service) || 0) + 1);
    }
  }

  const areas = [...byArea.values()].map(bucket => {
    const share = totalRevenue > 0 ? bucket.revenue / totalRevenue : bucket.invoiceOrClientCount / Math.max(1, records.length);
    return {
      area: bucket.area,
      clientCount: bucket.clientIds.size || bucket.invoiceOrClientCount,
      recordCount: bucket.invoiceOrClientCount,
      revenue: money(bucket.revenue),
      revenueShare: money(share * 100),
      densityScore: money(Math.min(100, (bucket.clientIds.size || bucket.invoiceOrClientCount) * 12 + share * 40)),
      topServices: [...bucket.services.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([service, count]) => ({ service, count }))
    };
  }).sort((a, b) => b.densityScore - a.densityScore);

  const hhi = money(areas.reduce((sum, area) => sum + (area.revenueShare / 100) ** 2, 0) * 10000);
  return {
    totalRecords: records.length,
    uniqueClients: clients.size || areas.reduce((sum, area) => sum + area.clientCount, 0),
    totalRevenue: money(totalRevenue),
    areaCount: areas.length,
    concentrationIndex: hhi,
    concentrationLevel: hhi >= 2500 ? "high" : hhi >= 1500 ? "moderate" : "diversified",
    areas
  };
}

function suggestExpansionAreas(density, input = {}) {
  const occupied = new Set(density.areas.map(area => area.area.toLowerCase()));
  const strongholds = density.areas.filter(area => area.densityScore >= 40).slice(0, 5);
  const weak = density.areas.filter(area => area.densityScore < 35);
  const recommendations = [];

  for (const hub of strongholds.length ? strongholds : density.areas.slice(0, 3)) {
    const neighbors = REGION_NEIGHBORS[hub.area] || [];
    for (const neighbor of neighbors) {
      if (occupied.has(neighbor.toLowerCase())) continue;
      const already = recommendations.find(item => item.area === neighbor);
      if (already) {
        already.basedOn.push(hub.area);
        already.priorityScore = money(Math.min(100, already.priorityScore + 8));
        continue;
      }
      recommendations.push({
        area: neighbor,
        action: "expand-geography",
        reason: `Adjacent to dense client base in ${hub.area}`,
        basedOn: [hub.area],
        priorityScore: money(Math.min(95, 55 + hub.densityScore * 0.35)),
        estimatedOpportunityRevenue: money((hub.revenue || density.totalRevenue * 0.08) * 0.35),
        suggestedInvestment: ["local marketing", "pilot crew/route", "partnership outreach"]
      });
    }
  }

  for (const area of weak) {
    recommendations.push({
      area: area.area,
      action: "deepen-penetration",
      reason: "Current footprint is thin; increase density before jumping to distant markets",
      basedOn: [area.area],
      priorityScore: money(48 + area.clientCount * 4),
      estimatedOpportunityRevenue: money(Math.max(area.revenue * 0.8, avg(density.areas.map(a => a.revenue)) || 0)),
      suggestedInvestment: ["referral program", "neighborhood canvassing", "bundle offers"]
    });
  }

  if (input.targetAreas?.length) {
    for (const target of input.targetAreas) {
      const name = normalizeArea(target);
      if (occupied.has(name.toLowerCase())) continue;
      if (recommendations.some(item => item.area === name)) continue;
      recommendations.push({
        area: name,
        action: "evaluate-new-market",
        reason: "Requested target area with no current client density",
        basedOn: [],
        priorityScore: 50,
        estimatedOpportunityRevenue: money((density.totalRevenue || 10000) * 0.1),
        suggestedInvestment: ["demand validation", "pricing-standards seed", "launch offer"]
      });
    }
  }

  // Pricing-standard areas with zero clients become whitespace candidates
  const category = input.category && supportedCategories.includes(input.category) ? input.category : null;
  if (category) {
    try {
      const standards = getPricingStandards(category);
      for (const areaName of Object.keys(standards.areas || {})) {
        if (occupied.has(areaName.toLowerCase())) continue;
        if (recommendations.some(item => item.area === areaName)) continue;
        recommendations.push({
          area: areaName,
          action: "expand-geography",
          reason: "Present in pricing standards but missing from client/invoice density",
          basedOn: [],
          priorityScore: 52,
          estimatedOpportunityRevenue: money((density.totalRevenue || 8000) * 0.12),
          suggestedInvestment: ["quote pilots", "align local unit prices", "sales blitz"]
        });
      }
    } catch {
      // ignore missing standards
    }
  }

  return recommendations.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, Number(input.limit) || 12);
}

function suggestProductExpansion(records, density, input = {}) {
  const category = input.category && supportedCategories.includes(input.category) ? input.category : null;
  const serviceCounts = new Map();
  for (const record of records) {
    for (const service of record.services) {
      serviceCounts.set(service, (serviceCounts.get(service) || 0) + 1);
    }
  }
  const currentServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([service, count]) => ({ service, count }));
  const catalog = CATEGORY_EXPANSION[category] || Object.values(CATEGORY_EXPANSION).flat().slice(0, 8);
  const present = new Set(currentServices.map(item => item.service.toLowerCase()));

  const opportunities = catalog
    .filter(service => ![...present].some(existing => existing.includes(service.toLowerCase()) || service.toLowerCase().includes(existing)))
    .map((service, index) => ({
      service,
      action: "expand-product",
      reason: category
        ? `Not yet visible in ${category} client/invoice mix`
        : "Complementary service not observed in provided client mix",
      fitScore: money(78 - index * 4),
      targetAreas: density.areas.slice(0, 3).map(area => area.area),
      goToMarket: ["attach to existing invoices", "pilot in densest areas", "update pricing standards"],
      relatedApis: category ? (categoryApiTools[category] || []).slice(0, 3) : []
    }));

  if (!opportunities.length && currentServices.length) {
    opportunities.push({
      service: `${currentServices[0].service} membership / recurring plan`,
      action: "expand-product",
      reason: "Convert one-off demand into recurring revenue in dense areas",
      fitScore: 74,
      targetAreas: density.areas.slice(0, 3).map(area => area.area),
      goToMarket: ["introduce subscription pricing", "offer annual prepay discount"],
      relatedApis: category ? (categoryApiTools[category] || []).slice(0, 2) : []
    });
  }

  return {
    currentServices,
    opportunities: opportunities.slice(0, Number(input.productLimit) || 8)
  };
}

export function analyzeClientDensity(input = {}) {
  let records = collectRecords(input);
  if (!records.length && input.category && input.useInvoiceLogs !== false) {
    records = recordsFromInvoiceLogs(input.category, Number(input.limit) || 250);
  }
  if (!records.length) {
    const error = new Error("Provide clients[], invoices[], or a category with uploaded invoice logs");
    error.statusCode = 400;
    throw error;
  }
  const density = buildDensity(records);
  return {
    generatedAt: new Date().toISOString(),
    category: input.category || null,
    sourceRecordCount: records.length,
    density,
    summary: {
      densestArea: density.areas[0]?.area || null,
      thinnestArea: density.areas[density.areas.length - 1]?.area || null,
      concentrationLevel: density.concentrationLevel,
      insight: density.concentrationLevel === "high"
        ? "Revenue is concentrated in a few areas; geographic expansion can reduce risk."
        : "Client base is relatively spread; deepen high-performing areas and test adjacent markets."
    }
  };
}

export function findExpansionOpportunities(input = {}) {
  const densityResult = analyzeClientDensity(input);
  const expansionAreas = suggestExpansionAreas(densityResult.density, input);
  return {
    ...densityResult,
    expansionAreas,
    investmentPriorities: expansionAreas.slice(0, 5).map(item => ({
      area: item.area,
      action: item.action,
      priorityScore: item.priorityScore,
      nextStep: item.suggestedInvestment[0]
    }))
  };
}

export function recommendProductExpansion(input = {}) {
  let records = collectRecords(input);
  if (!records.length && input.category && input.useInvoiceLogs !== false) {
    records = recordsFromInvoiceLogs(input.category, Number(input.limit) || 250);
  }
  if (!records.length) {
    const error = new Error("Provide clients[], invoices[], or a category with uploaded invoice logs");
    error.statusCode = 400;
    throw error;
  }
  const density = buildDensity(records);
  const product = suggestProductExpansion(records, density, input);
  const expansionAreas = suggestExpansionAreas(density, input);
  return {
    generatedAt: new Date().toISOString(),
    category: input.category || null,
    density: {
      areaCount: density.areaCount,
      totalRevenue: density.totalRevenue,
      concentrationLevel: density.concentrationLevel,
      topAreas: density.areas.slice(0, 5)
    },
    productExpansion: product,
    geographicExpansion: expansionAreas.slice(0, 6),
    playbook: [
      "Protect densest areas with retention and referral campaigns",
      "Pilot new services first where densityScore is highest",
      "Open adjacent geographies only after local utilization is healthy",
      "Sync winning offers into data/pricing-standards for the category"
    ]
  };
}

export function runMarketExpansion(input = {}) {
  const density = analyzeClientDensity(input);
  const expansionAreas = suggestExpansionAreas(density.density, input);
  let records = collectRecords(input);
  if (!records.length && input.category) records = recordsFromInvoiceLogs(input.category, Number(input.limit) || 250);
  const product = suggestProductExpansion(records, density.density, input);
  return {
    workflow: "sales-market-expansion",
    generatedAt: new Date().toISOString(),
    category: input.category || null,
    clientDensity: density,
    expansionAreas,
    productExpansion: product,
    recommendedInvestments: [
      ...expansionAreas.slice(0, 3).map(area => ({ type: "geography", target: area.area, score: area.priorityScore, why: area.reason })),
      ...product.opportunities.slice(0, 3).map(item => ({ type: "product", target: item.service, score: item.fitScore, why: item.reason }))
    ]
  };
}
