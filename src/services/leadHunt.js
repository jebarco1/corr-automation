import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { fileURLToPath } from "url";
import { supportedCategories } from "../ai/toolCatalog.js";
import { listServices } from "./serviceCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const marketsDir = path.join(__dirname, "../../data/markets");
const leadTargetsDir = path.join(__dirname, "../../data/lead-targets");
const leadsDir = path.join(__dirname, "../../data/leads");

export const LEAD_SEGMENTS = ["b2b", "residential"];

const COMPETITOR_HINTS = [
  "near me", "contractor", "company we", "our services", "call us today",
  "licensed and insured", "free estimate", "serving the", "book online"
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getGeorgiaMarkets() {
  return readJson(path.join(marketsDir, "georgia-cities.json"));
}

export function listPilotCities(options = {}) {
  const markets = getGeorgiaMarkets();
  const pilots = (markets.cities || []).filter(city => city.pilot);
  if (options.includeAll) return markets.cities || [];
  if (options.cities?.length) {
    const wanted = new Set(options.cities.map(value => String(value).toLowerCase()));
    return (markets.cities || []).filter(city =>
      wanted.has(city.city.toLowerCase()) || wanted.has(city.label.toLowerCase()) || wanted.has(city.slug)
    );
  }
  return pilots.length ? pilots : (markets.cities || []).slice(0, 4);
}

export function getLeadTargets(category) {
  const filePath = path.join(leadTargetsDir, `${category}.json`);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Lead targets not found for category: ${category}`);
    error.statusCode = 404;
    throw error;
  }
  return readJson(filePath);
}

export function normalizeLeadSegment(segment) {
  const value = String(segment || "").toLowerCase().trim();
  if (value === "b2b" || value === "business" || value === "commercial") return "b2b";
  if (value === "residential" || value === "resi" || value === "homeowner" || value === "consumer") return "residential";
  const error = new Error("segment must be 'b2b' or 'residential'");
  error.statusCode = 400;
  throw error;
}

/** Resolve B2B or residential target block for a category. */
export function getSegmentLeadTargets(category, segment) {
  const normalized = normalizeLeadSegment(segment);
  const full = getLeadTargets(category);
  const block = full[normalized] || null;
  if (!block) {
    const error = new Error(`No ${normalized} lead targets for category: ${category}`);
    error.statusCode = 404;
    throw error;
  }
  return {
    category,
    segment: normalized,
    marketFile: full.marketFile || "data/markets/georgia-cities.json",
    usePilotCities: full.usePilotCities !== false,
    queryTemplates: full.queryTemplates,
    customerTypes: block.customerTypes || [],
    intentPhrases: block.intentPhrases || [],
    excludeKeywords: block.excludeKeywords || [],
    suggestedServiceIds: block.suggestedServiceIds || []
  };
}

export function listLeadTargetCatalog() {
  const indexPath = path.join(leadTargetsDir, "index.json");
  if (fs.existsSync(indexPath)) return readJson(indexPath);
  return {
    version: 2,
    segments: LEAD_SEGMENTS,
    categories: supportedCategories.map(category => ({
      category,
      file: `data/lead-targets/${category}.json`
    }))
  };
}

function segmentDir(segment) {
  return path.join(leadsDir, normalizeLeadSegment(segment));
}

function buildQueries(category, city, targets, limit = 4) {
  const templates = targets.queryTemplates || [
    "{customerType} in {city} {state}",
    "{customerType} {city} {state} contact"
  ];
  const queries = [];
  for (const customerType of targets.customerTypes || []) {
    for (const template of templates) {
      queries.push(
        template
          .replaceAll("{customerType}", customerType)
          .replaceAll("{intentPhrase}", (targets.intentPhrases || [])[0] || customerType)
          .replaceAll("{city}", city.city)
          .replaceAll("{state}", city.state)
      );
    }
  }
  for (const phrase of targets.intentPhrases || []) {
    queries.push(`${phrase} ${city.city} ${city.state}`);
  }
  // Prefer diverse unique queries
  return [...new Set(queries)].slice(0, limit);
}

function isCompetitor(text = "", excludeKeywords = []) {
  const lower = String(text).toLowerCase();
  if (excludeKeywords.some(keyword => lower.includes(String(keyword).toLowerCase()))) return true;
  // Keep property/customer language; drop obvious vendor ads.
  const vendorHits = COMPETITOR_HINTS.filter(hint => lower.includes(hint)).length;
  const customerHits = ["hoa", "apartment", "property management", "school", "church", "hospital", "warehouse", "hotel", "assisted living", "university"]
    .filter(hint => lower.includes(hint)).length;
  return vendorHits >= 2 && customerHits === 0;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<\/?b>/g, "")
    .replace(/<[^>]+>/g, "");
}

async function searchDuckDuckGo(query, limit = 5) {
  const url = "https://html.duckduckgo.com/html/";
  const response = await axios.post(
    url,
    new URLSearchParams({ q: query }).toString(),
    {
      timeout: 15000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "HA-CorrLeadHunt/0.5 (+https://github.com/jebarco1/corr-automation)"
      },
      validateStatus: status => status >= 200 && status < 500
    }
  );

  if (response.status >= 400) return [];
  const html = String(response.data || "");
  const results = [];
  const blockRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = blockRegex.exec(html)) && results.length < limit) {
    results.push({
      title: decodeHtml(match[2].replace(/<[^>]+>/g, "")).trim(),
      url: decodeHtml(match[1]).trim(),
      snippet: decodeHtml(match[3].replace(/<[^>]+>/g, "")).trim(),
      source: "duckduckgo-html"
    });
  }

  // Fallback looser parse
  if (!results.length) {
    const loose = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((match = loose.exec(html)) && results.length < limit) {
      results.push({
        title: decodeHtml(match[2].replace(/<[^>]+>/g, "")).trim(),
        url: decodeHtml(match[1]).trim(),
        snippet: "",
        source: "duckduckgo-html"
      });
    }
  }
  return results;
}

function localFallbackLeads(category, city, targets) {
  // Deterministic public-org style placeholders when search is blocked/unavailable.
  return (targets.customerTypes || []).slice(0, 3).map((customerType, index) => ({
    title: `${city.city} ${customerType}`,
    url: null,
    snippet: `Potential ${category} customer target: ${customerType} in ${city.label}. Verify contact details before outreach.`,
    source: "local-fallback",
    customerType,
    rank: index + 1
  }));
}

function scoreLead({ title, snippet, customerType, city }) {
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 40;
  if (customerType && text.includes(String(customerType).toLowerCase().split(" ")[0])) score += 20;
  if (text.includes(city.city.toLowerCase())) score += 15;
  if (text.includes("hoa") || text.includes("property management") || text.includes("apartment")) score += 10;
  if (text.includes("contact") || text.includes("office") || text.includes("manager")) score += 5;
  if (text.includes("near me") || text.includes("contractor")) score -= 15;
  return Math.max(1, Math.min(99, score));
}

function suggestService(category, targets) {
  try {
    const catalog = listServices(category);
    const preferred = targets.suggestedServiceIds || [];
    for (const id of preferred) {
      const hit = catalog.services.find(service => service.id === id);
      if (hit) return { serviceId: hit.id, serviceName: hit.name, quoteKey: hit.quoteKey };
    }
    const fallback = catalog.services.find(service => service.id === catalog.defaultServiceId) || catalog.services[0];
    return fallback
      ? { serviceId: fallback.id, serviceName: fallback.name, quoteKey: fallback.quoteKey }
      : null;
  } catch {
    return null;
  }
}

function leadId(segment, category, city, title, url) {
  const raw = `${segment}|${category}|${city.slug}|${url || title}`;
  return `lead_${crypto.createHash("sha1").update(raw).digest("hex").slice(0, 12)}`;
}

async function collectSearchResults(queries, options = {}) {
  const all = [];
  for (const query of queries) {
    try {
      const hits = await searchDuckDuckGo(query, options.perQueryLimit || 4);
      for (const hit of hits) all.push({ ...hit, query });
    } catch (error) {
      all.push({
        title: null,
        url: null,
        snippet: error.message,
        source: "search-error",
        query
      });
    }
  }
  return all.filter(item => item.title);
}

export async function huntLeadsForCategory(category, input = {}) {
  if (!supportedCategories.includes(category)) {
    const error = new Error(`Unsupported category: ${category}`);
    error.statusCode = 400;
    throw error;
  }

  const segment = input.segment ? normalizeLeadSegment(input.segment) : "b2b";
  const targets = getSegmentLeadTargets(category, segment);
  const cities = listPilotCities({
    cities: input.cities,
    includeAll: !!input.includeAllCities
  });
  if (!cities.length) {
    const error = new Error("No target cities found in Georgia markets file");
    error.statusCode = 400;
    throw error;
  }

  const service = suggestService(category, targets);
  const perCityLimit = Number(input.perCityLimit || 5);
  const queryLimit = Number(input.queryLimit || 3);
  const cityResults = [];
  const allLeads = [];
  const outDir = path.join(segmentDir(segment), category);

  for (const city of cities) {
    const queries = buildQueries(category, city, targets, queryLimit);
    let raw = await collectSearchResults(queries, { perQueryLimit: 4 });
    if (!raw.length) {
      raw = localFallbackLeads(category, city, targets).map(item => ({ ...item, query: queries[0] }));
    }

    const dedupe = new Map();
    for (const item of raw) {
      if (isCompetitor(`${item.title} ${item.snippet}`, targets.excludeKeywords || [])) continue;
      const key = (item.url || item.title || "").toLowerCase();
      if (!key || dedupe.has(key)) continue;
      const customerType = (targets.customerTypes || []).find(type =>
        `${item.title} ${item.snippet}`.toLowerCase().includes(String(type).toLowerCase().split(" ")[0])
      ) || targets.customerTypes?.[0] || "prospect";

      const lead = {
        leadId: leadId(segment, category, city, item.title, item.url),
        segment,
        category,
        city: city.city,
        state: city.state,
        market: city.label,
        region: city.region,
        pilotMarket: !!city.pilot,
        name: item.title,
        url: item.url,
        snippet: item.snippet,
        customerType,
        suggestedService: service,
        score: scoreLead({ title: item.title, snippet: item.snippet, customerType, city }),
        query: item.query,
        source: item.source,
        status: item.source === "local-fallback" ? "needs-verification" : "new",
        gatheredAt: new Date().toISOString()
      };
      dedupe.set(key, lead);
    }

    const leads = [...dedupe.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, perCityLimit);

    const relative = `data/leads/${segment}/${category}/${city.slug}.json`;
    const payload = {
      segment,
      category,
      city: city.city,
      state: city.state,
      market: city.label,
      pilot: !!city.pilot,
      updatedAt: new Date().toISOString(),
      queries,
      count: leads.length,
      leads
    };
    writeJson(path.join(outDir, `${city.slug}.json`), payload);
    cityResults.push({
      city: city.city,
      state: city.state,
      label: city.label,
      pilot: !!city.pilot,
      count: leads.length,
      file: relative,
      queries
    });
    allLeads.push(...leads);
  }

  const summary = {
    segment,
    category,
    updatedAt: new Date().toISOString(),
    marketFile: "data/markets/georgia-cities.json",
    pilotCities: cities.filter(city => city.pilot).map(city => city.label),
    cityCount: cityResults.length,
    leadCount: allLeads.length,
    cities: cityResults
  };
  writeJson(path.join(outDir, "_summary.json"), summary);

  return {
    segment,
    category,
    marketFile: "data/markets/georgia-cities.json",
    targetFile: `data/lead-targets/${category}.json`,
    cities: cityResults,
    leadCount: allLeads.length,
    leads: allLeads.sort((a, b) => b.score - a.score),
    summaryFile: `data/leads/${segment}/${category}/_summary.json`
  };
}

export async function huntLeadsForAllCategories(input = {}) {
  const segment = input.segment ? normalizeLeadSegment(input.segment) : "b2b";
  const categories = input.categories?.length
    ? input.categories.filter(category => supportedCategories.includes(category))
    : [...supportedCategories];

  const results = [];
  for (const category of categories) {
    results.push(await huntLeadsForCategory(category, { ...input, segment }));
  }
  const index = {
    segment,
    updatedAt: new Date().toISOString(),
    marketFile: "data/markets/georgia-cities.json",
    pilotCities: listPilotCities().map(city => city.label),
    categories: results.map(result => ({
      category: result.category,
      leadCount: result.leadCount,
      cityCount: result.cities.length,
      summaryFile: result.summaryFile
    })),
    totalLeads: results.reduce((sum, result) => sum + result.leadCount, 0)
  };
  writeJson(path.join(segmentDir(segment), "index.json"), index);
  // Keep root index pointing at both segment indexes.
  writeJson(path.join(leadsDir, "index.json"), {
    updatedAt: index.updatedAt,
    marketFile: index.marketFile,
    pilotCities: index.pilotCities,
    segments: {
      b2b: "data/leads/b2b/index.json",
      residential: "data/leads/residential/index.json"
    },
    lastHunt: { segment, totalLeads: index.totalLeads }
  });
  return index;
}

export async function huntB2bLeads(input = {}) {
  return huntLeadsForAllCategories({ ...input, segment: "b2b" });
}

export async function huntResidentialLeads(input = {}) {
  return huntLeadsForAllCategories({ ...input, segment: "residential" });
}

export function listLeads(category, options = {}) {
  const segment = options.segment ? normalizeLeadSegment(options.segment) : null;
  const dirs = segment
    ? [path.join(segmentDir(segment), category)]
    : [
      path.join(segmentDir("b2b"), category),
      path.join(segmentDir("residential"), category),
      path.join(leadsDir, category) // legacy unsegmented
    ];

  const leads = [];
  const cities = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const cityFiles = fs.readdirSync(dir).filter(name => name.endsWith(".json") && !name.startsWith("_"));
    for (const fileName of cityFiles) {
      if (options.city && slugify(options.city) !== fileName.replace(/\.json$/, "")) continue;
      const payload = readJson(path.join(dir, fileName));
      const relSegment = payload.segment || segment || "legacy";
      cities.push({
        segment: relSegment,
        city: payload.city,
        state: payload.state,
        market: payload.market,
        count: payload.count,
        file: path.relative(path.join(__dirname, "../.."), path.join(dir, fileName)).replaceAll("\\", "/")
      });
      leads.push(...(payload.leads || []).map(lead => ({
        segment: lead.segment || relSegment,
        ...lead
      })));
    }
  }

  leads.sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    segment: segment || "all",
    category,
    count: leads.length,
    cities,
    leads: options.limit ? leads.slice(0, Number(options.limit)) : leads
  };
}

export function listSegmentLeads(segment, options = {}) {
  const normalized = normalizeLeadSegment(segment);
  const categories = (options.category ? [options.category] : supportedCategories)
    .filter(category => supportedCategories.includes(category));

  const categoryResults = categories.map(category => listLeads(category, { ...options, segment: normalized }));
  return {
    segment: normalized,
    marketFile: "data/markets/georgia-cities.json",
    pilotCities: listPilotCities().map(city => city.label),
    updatedAt: new Date().toISOString(),
    endpoints: {
      list: `/api/v1/leads/${normalized}`,
      hunt: `/api/v1/leads/${normalized}/hunt`
    },
    categories: categoryResults.map(item => ({
      category: item.category,
      count: item.count,
      cities: item.cities
    })),
    totalLeads: categoryResults.reduce((sum, item) => sum + item.count, 0),
    leads: options.includeLeads === false
      ? undefined
      : categoryResults
        .flatMap(item => item.leads)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, options.limit ? Number(options.limit) : undefined)
  };
}

export function listAllLeads(options = {}) {
  if (options.segment) return listSegmentLeads(options.segment, options);
  const b2b = listSegmentLeads("b2b", { ...options, includeLeads: false });
  const residential = listSegmentLeads("residential", { ...options, includeLeads: false });
  return {
    marketFile: "data/markets/georgia-cities.json",
    pilotCities: listPilotCities().map(city => city.label),
    updatedAt: new Date().toISOString(),
    segments: {
      b2b: { totalLeads: b2b.totalLeads, endpoint: "/api/v1/leads/b2b", hunt: "/api/v1/leads/b2b/hunt" },
      residential: { totalLeads: residential.totalLeads, endpoint: "/api/v1/leads/residential", hunt: "/api/v1/leads/residential/hunt" }
    },
    totalLeads: b2b.totalLeads + residential.totalLeads,
    b2b,
    residential
  };
}
