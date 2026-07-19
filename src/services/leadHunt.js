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
    // Headhunter contact-intent queries
    queries.push(`${customerType} ${city.city} ${city.state} phone email address`);
    queries.push(`${customerType} ${city.city} ${city.state} "contact us"`);
  }
  for (const phrase of targets.intentPhrases || []) {
    queries.push(`${phrase} ${city.city} ${city.state}`);
  }
  // Prefer diverse unique queries
  return [...new Set(queries)].slice(0, Math.max(limit, 3));
}

function unwrapResultUrl(rawUrl = "") {
  let url = String(rawUrl || "").trim();
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.searchParams.get("uddg")) {
      return decodeURIComponent(parsed.searchParams.get("uddg"));
    }
  } catch {
    return url;
  }
  return url;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const ADDRESS_RE = /\d{1,6}\s+[A-Za-z0-9.'#\- ]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir|Parkway|Pkwy|Place|Pl)\.?(?:,\s*[A-Za-z .'#-]+){0,2},\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?/gi;

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return null;
}

function isUsefulAddress(address = "", city = null) {
  const value = String(address || "").replace(/\s+/g, " ").trim();
  if (value.length < 12 || value.length > 160) return false;
  if (!/\d/.test(value)) return false;
  if (/\b(PM|AM|Dr\.?,\s*PM)\b/i.test(value) && !/\bGA\b|\d{5}/.test(value)) return false;
  if (city?.city && !new RegExp(city.city, "i").test(value) && !/\bGA\b|\d{5}/.test(value)) return false;
  // Prefer real street-looking values.
  return /(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Circle|Cir|Parkway|Pkwy|Place|Pl|Highway|Hwy)\b/i.test(value)
    || /\b[A-Z]{2}\s+\d{5}\b/.test(value);
}

function isLowQualityLead(title = "", url = "") {
  const text = `${title} ${url}`.toLowerCase();
  return /laws and regulations|blog\/|\/blog|wikipedia\.org|yelp\.com|facebook\.com|linkedin\.com|angi\.com|homeadvisor|thumbtack|neddle/.test(text);
}

function cleanEmail(email = "") {
  return String(email || "")
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[<>\[\]\(\)\{\}",'\s]/g, "")
    .replace(/[.,;:]+$/g, "")
    .toLowerCase();
}

function isUsefulEmail(email = "") {
  const lower = cleanEmail(email);
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(lower)) return false;
  if (/noreply|no-reply|donotreply|example\.com|sentry\.io|wixpress|godaddy|schema\.org|png|jpg|jpeg|webp|svg/.test(lower)) return false;
  return true;
}

function extractContactsFromText(text = "", city = null) {
  const source = String(text || "");
  const emails = [...new Set((source.match(EMAIL_RE) || []).map(cleanEmail).filter(isUsefulEmail))];
  const phones = [...new Set((source.match(PHONE_RE) || []).map(normalizePhone).filter(Boolean))];
  let addresses = [...new Set((source.match(ADDRESS_RE) || []).map(v => v.replace(/\s+/g, " ").trim()))]
    .filter(value => isUsefulAddress(value, city));

  // Softer city-scoped address capture when street suffix regex misses.
  if (!addresses.length && city?.city) {
    const soft = source.match(
      new RegExp(`\\d{1,6}\\s+[A-Za-z0-9.'#\\- ]{3,60},\\s*${city.city}[,\\s]+${city.state}(?:\\s+\\d{5})?`, "i")
    );
    if (soft?.[0] && isUsefulAddress(soft[0], city)) addresses = [soft[0].replace(/\s+/g, " ").trim()];
  }

  return {
    email: emails[0] || null,
    phone: phones[0] || null,
    address: addresses[0] || null,
    emails,
    phones,
    addresses
  };
}

function mergeContacts(...parts) {
  const emails = [...new Set(parts.flatMap(part => part?.emails || []).filter(Boolean))];
  const phones = [...new Set(parts.flatMap(part => part?.phones || []).filter(Boolean))];
  const addresses = [...new Set(parts.flatMap(part => part?.addresses || []).filter(Boolean))];
  return {
    email: parts.find(part => part?.email)?.email || emails[0] || null,
    phone: parts.find(part => part?.phone)?.phone || phones[0] || null,
    address: parts.find(part => part?.address)?.address || addresses[0] || null,
    emails,
    phones,
    addresses
  };
}

function htmlToText(html = "") {
  return decodeHtml(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  );
}

function extractJsonLdContacts(html = "", city = null) {
  const blocks = [...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const emails = [];
  const phones = [];
  const addresses = [];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed["@graph"] || [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        if (node.email) emails.push(String(node.email));
        if (node.telephone) phones.push(String(node.telephone));
        const addr = node.address || node.location?.address;
        if (typeof addr === "string" && isUsefulAddress(addr, city)) addresses.push(addr);
        if (addr && typeof addr === "object") {
          const line = [addr.streetAddress, addr.addressLocality || city?.city, addr.addressRegion || city?.state, addr.postalCode]
            .filter(Boolean)
            .join(", ");
          if (line && isUsefulAddress(line, city)) addresses.push(line);
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }

  return {
    email: emails.map(cleanEmail).find(isUsefulEmail) || null,
    phone: phones.map(normalizePhone).filter(Boolean)[0] || null,
    address: addresses.map(v => v.replace(/\s+/g, " ").trim())[0] || null,
    emails: [...new Set(emails.map(cleanEmail).filter(isUsefulEmail))],
    phones: [...new Set(phones.map(normalizePhone).filter(Boolean))],
    addresses: [...new Set(addresses.map(v => v.replace(/\s+/g, " ").trim()))]
  };
}

function extractMailtoTel(html = "") {
  const emails = [...String(html).matchAll(/mailto:([^"'?\s]+)/gi)].map(m => decodeURIComponent(m[1]));
  const phones = [...String(html).matchAll(/tel:([^"'?\s]+)/gi)].map(m => decodeURIComponent(m[1]));
  return {
    email: emails.map(cleanEmail).find(isUsefulEmail) || null,
    phone: phones.map(normalizePhone)[0] || null,
    address: null,
    emails: [...new Set(emails.map(cleanEmail).filter(isUsefulEmail))],
    phones: [...new Set(phones.map(normalizePhone))],
    addresses: []
  };
}

async function fetchPageBundle(url, timeout = 10000) {
  if (!url) return { text: "", html: "" };
  try {
    const response = await axios.get(url, {
      timeout,
      maxRedirects: 5,
      headers: {
        "User-Agent": "HA-CorrLeadHunt/0.5 (+https://github.com/jebarco1/corr-automation)",
        Accept: "text/html,application/xhtml+xml"
      },
      validateStatus: status => status >= 200 && status < 400,
      responseType: "text",
      transformResponse: [data => data]
    });
    const html = String(response.data || "");
    return { html, text: htmlToText(html).slice(0, 120000) };
  } catch {
    return { text: "", html: "" };
  }
}

async function enrichFromUrl(url, city) {
  const { html, text } = await fetchPageBundle(url);
  if (!html && !text) return null;
  return mergeContacts(
    extractJsonLdContacts(html, city),
    extractMailtoTel(html),
    extractContactsFromText(text, city)
  );
}

async function enrichLeadContacts(lead, city, options = {}) {
  const existing = {
    email: lead.email || null,
    phone: lead.phone || null,
    address: lead.address || null,
    emails: lead.email ? [lead.email] : [],
    phones: lead.phone ? [lead.phone] : [],
    addresses: lead.address ? [lead.address] : []
  };
  const fromSnippet = extractContactsFromText(`${lead.name}\n${lead.snippet || ""}`, city);
  let contacts = mergeContacts(existing, fromSnippet);
  const enrichEnabled = options.enrichContacts !== false;
  const pageUrl = unwrapResultUrl(lead.url);

  // Already have full contact card — skip extra page fetches.
  if (contacts.phone && contacts.email && contacts.address) {
    return {
      ...lead,
      url: pageUrl || lead.url,
      phone: contacts.phone,
      email: contacts.email,
      address: contacts.address,
      contacts: {
        phone: contacts.phone,
        email: contacts.email,
        address: contacts.address,
        phones: contacts.phones,
        emails: contacts.emails,
        addresses: contacts.addresses,
        marketHint: city?.label || null,
        completeness: 3,
        enriched: false
      },
      score: Math.min(99, Number(lead.score || 0) + 15),
      status: "contact-ready"
    };
  }

  if (enrichEnabled && pageUrl) {
    const primary = await enrichFromUrl(pageUrl, city);
    if (primary) contacts = mergeContacts(contacts, primary);

    // If still missing key fields, try common contact paths.
    if ((!contacts.phone || !contacts.email || !contacts.address) && pageUrl.startsWith("http")) {
      try {
        const base = new URL(pageUrl);
        const paths = ["/contact", "/contact-us", "/about", "/about-us", "/locations", "/find-us"];
        for (const suffix of paths) {
          if (contacts.phone && contacts.email && contacts.address) break;
          const candidate = `${base.origin}${suffix}`;
          if (candidate === pageUrl) continue;
          const extra = await enrichFromUrl(candidate, city);
          if (extra) contacts = mergeContacts(contacts, extra);
        }
      } catch {
        // ignore URL parse/fetch issues
      }
    }
  }

  if (!contacts.address && city?.label) {
    contacts.marketHint = city.label;
  }

  const completeness = [contacts.phone, contacts.email, contacts.address].filter(Boolean).length;
  return {
    ...lead,
    url: pageUrl || lead.url,
    phone: contacts.phone,
    email: contacts.email,
    address: contacts.address,
    contacts: {
      phone: contacts.phone,
      email: contacts.email,
      address: contacts.address,
      phones: contacts.phones,
      emails: contacts.emails,
      addresses: contacts.addresses,
      marketHint: contacts.marketHint || city?.label || null,
      completeness,
      enriched: enrichEnabled
    },
    score: Math.min(99, Number(lead.score || 0) + completeness * 5),
    status: completeness >= 2 ? "contact-ready" : (lead.status || "new")
  };
}

function isCompetitor(text = "", excludeKeywords = [], segment = "b2b") {
  const lower = String(text).toLowerCase();
  if (excludeKeywords.some(keyword => lower.includes(String(keyword).toLowerCase()))) return true;
  // Keep property/customer language; drop obvious vendor ads.
  const vendorHits = COMPETITOR_HINTS.filter(hint => lower.includes(hint)).length;
  const customerHits = [
    "hoa", "association", "apartment", "leasing office", "property management",
    "school", "church", "hospital", "warehouse", "hotel", "assisted living",
    "senior living", "university", "condo", "neighborhood"
  ].filter(hint => lower.includes(hint)).length;
  if (segment === "residential" && customerHits > 0) return false;
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
    snippet: `Potential ${category} customer target: ${customerType} in ${city.label}. Phone/email/address not found yet — verify before outreach.`,
    source: "local-fallback",
    customerType,
    rank: index + 1,
    phone: null,
    email: null,
    address: null
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectSearchResults(queries, options = {}) {
  const all = [];
  for (const query of queries) {
    try {
      const hits = await searchDuckDuckGo(query, options.perQueryLimit || 4);
      for (const hit of hits) all.push({ ...hit, query });
      await sleep(options.delayMs ?? 350);
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

function loadSiblingSegmentLeads(segment, category, city) {
  const sibling = segment === "residential" ? "b2b" : "b2b";
  const filePath = path.join(segmentDir(sibling), category, `${city.slug}.json`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const payload = readJson(filePath);
    return (payload.leads || []).filter(lead => {
      const text = `${lead.name} ${lead.customerType} ${lead.snippet || ""}`.toLowerCase();
      return /hoa|association|apartment|leasing|condo|community|senior living|assisted living/.test(text)
        && (lead.phone || lead.email || lead.address);
    });
  } catch {
    return [];
  }
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
    // Residential often needs association/office contact queries to get public phone/email/address.
    if (segment === "residential") {
      const contactQueries = [
        `HOA management ${city.city} ${city.state} phone email`,
        `condo association ${city.city} ${city.state} contact address`,
        `apartment leasing office ${city.city} ${city.state} phone`,
        `community association ${city.city} ${city.state} "contact us"`
      ];
      raw = raw.concat(await collectSearchResults(contactQueries, { perQueryLimit: 4 }));
    }
    // If web search is empty/rate-limited, reuse contact-ready association leads from B2B.
    let borrowed = [];
    if (!raw.length && segment === "residential") {
      borrowed = loadSiblingSegmentLeads(segment, category, city).map(lead => ({
        title: lead.name,
        url: lead.url,
        snippet: lead.snippet,
        source: "b2b-contact-transfer",
        query: "transferred from b2b contact-ready lead",
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        customerType: lead.customerType
      }));
      raw = borrowed;
    }
    if (!raw.length) {
      raw = localFallbackLeads(category, city, targets).map(item => ({ ...item, query: queries[0] }));
    }

    const dedupe = new Map();
    for (const item of raw) {
      if (item.source !== "b2b-contact-transfer") {
        if (isCompetitor(`${item.title} ${item.snippet}`, targets.excludeKeywords || [], segment)) continue;
        if (isLowQualityLead(item.title, item.url)) continue;
      }
      const key = (item.url || item.title || "").toLowerCase();
      if (!key || dedupe.has(key)) continue;
      const customerType = item.customerType || (targets.customerTypes || []).find(type =>
        `${item.title} ${item.snippet}`.toLowerCase().includes(String(type).toLowerCase().split(" ")[0])
      ) || targets.customerTypes?.[0] || "prospect";

      const resolvedUrl = unwrapResultUrl(item.url);
      const snippetContacts = extractContactsFromText(`${item.title}\n${item.snippet || ""}`, city);
      const lead = {
        leadId: leadId(segment, category, city, item.title, resolvedUrl || item.url),
        segment,
        category,
        city: city.city,
        state: city.state,
        market: city.label,
        region: city.region,
        pilotMarket: !!city.pilot,
        name: item.title,
        url: resolvedUrl || item.url,
        snippet: item.snippet,
        phone: item.phone || snippetContacts.phone,
        email: item.email || snippetContacts.email,
        address: item.address || snippetContacts.address,
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

    const shortlist = [...dedupe.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, perCityLimit);

    const leads = [];
    for (const lead of shortlist) {
      leads.push(await enrichLeadContacts(lead, city, input));
    }
    leads.sort((a, b) => b.score - a.score);

    const withContacts = leads.filter(lead => lead.phone || lead.email || lead.address).length;
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
      contactCoverage: {
        withAnyContact: withContacts,
        withPhone: leads.filter(lead => lead.phone).length,
        withEmail: leads.filter(lead => lead.email).length,
        withAddress: leads.filter(lead => lead.address).length
      },
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
    contactCoverage: {
      withAnyContact: allLeads.filter(lead => lead.phone || lead.email || lead.address).length,
      withPhone: allLeads.filter(lead => lead.phone).length,
      withEmail: allLeads.filter(lead => lead.email).length,
      withAddress: allLeads.filter(lead => lead.address).length
    },
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
    contactCoverage: summary.contactCoverage,
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
