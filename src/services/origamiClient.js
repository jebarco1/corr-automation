import axios from "axios";
import { appConfig } from "../config/appConfig.js";

const DEFAULT_BASE_URL = "https://origami.chat/api/v2";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(value) {
  if (value == null) return null;
  if (typeof value === "object") {
    if (typeof value.value === "string") return clean(value.value);
    if (typeof value.scalar === "string") return clean(value.scalar);
    if (typeof value.text === "string") return clean(value.text);
    return null;
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function pickField(row, keys = []) {
  if (!row || typeof row !== "object") return null;
  const entries = Object.entries(row);
  for (const key of keys) {
    const exact = entries.find(([k]) => k.toLowerCase() === key.toLowerCase());
    if (exact) {
      const value = clean(exact[1]);
      if (value) return value;
    }
  }
  for (const key of keys) {
    const soft = entries.find(([k]) => k.toLowerCase().includes(key.toLowerCase()));
    if (soft) {
      const value = clean(soft[1]);
      if (value) return value;
    }
  }
  return null;
}

function flattenRow(item) {
  if (!item || typeof item !== "object") return {};
  // ?cells=flat may return { slug: value } or still wrap under cells.
  if (item.cells && typeof item.cells === "object" && !Array.isArray(item.cells)) {
    const out = {};
    for (const [slug, cell] of Object.entries(item.cells)) {
      out[slug] = clean(cell?.value ?? cell?.scalar ?? cell);
    }
    return out;
  }
  const out = {};
  for (const [key, value] of Object.entries(item)) {
    if (["object", "id", "rowId", "createdAt", "updatedAt"].includes(key)) continue;
    out[key] = clean(value);
  }
  return out;
}

export function isOrigamiEnabled() {
  return Boolean(appConfig.origami?.enabled && appConfig.origami?.apiKey);
}

export function getOrigamiStatus() {
  return {
    provider: "origami",
    enabled: isOrigamiEnabled(),
    baseURL: appConfig.origami?.baseURL || DEFAULT_BASE_URL,
    model: appConfig.origami?.model || null,
    projectId: appConfig.origami?.projectId || null,
    docs: "https://docs.origami.chat/agents/quickstart",
    env: {
      ORIGAMI_API_KEY: Boolean(process.env.ORIGAMI_API_KEY),
      ORIGAMI_BASE_URL: Boolean(process.env.ORIGAMI_BASE_URL),
      ORIGAMI_PROJECT_ID: Boolean(process.env.ORIGAMI_PROJECT_ID),
      ORIGAMI_MODEL: Boolean(process.env.ORIGAMI_MODEL)
    }
  };
}

function client() {
  if (!isOrigamiEnabled()) {
    const error = new Error("Origami is not configured. Set ORIGAMI_API_KEY in .env");
    error.statusCode = 503;
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${appConfig.origami.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "HA-CorrLeadHunt/0.5 (+https://github.com/jebarco1/corr-automation)"
  };
  if (appConfig.origami.projectId) {
    headers["x-origami-project"] = appConfig.origami.projectId;
  }

  return axios.create({
    baseURL: appConfig.origami.baseURL || DEFAULT_BASE_URL,
    timeout: appConfig.origami.requestTimeoutMs || 30000,
    headers,
    validateStatus: () => true
  });
}

async function request(method, url, data = undefined, params = undefined) {
  const http = client();
  const response = await http.request({ method, url, data, params });
  if (response.status >= 400) {
    const message = response.data?.error || response.data?.message || `Origami ${method} ${url} failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.code = response.data?.code || "ORIGAMI_ERROR";
    error.details = response.data;
    throw error;
  }
  return { data: response.data, headers: response.headers, status: response.status };
}

export async function createAgent({ prompt, name, model, workspaceId, focusTableIds } = {}) {
  if (!prompt) {
    const error = new Error("Origami createAgent requires prompt");
    error.statusCode = 400;
    throw error;
  }
  const body = {
    prompt,
    name: name || undefined,
    model: model || appConfig.origami.model || undefined,
    workspaceId: workspaceId || undefined,
    focusTableIds: focusTableIds?.length ? focusTableIds : undefined
  };
  const { data } = await request("POST", "/agents", body);
  return data;
}

export async function getRun(agentId, runId, options = {}) {
  const params = {};
  if (options.include) params.include = options.include;
  const { data, headers } = await request("GET", `/agents/${agentId}/runs/${runId}`, undefined, params);
  const retryAfter = Number(headers["retry-after"] || headers["Retry-After"] || 0);
  return { run: data, retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null };
}

export async function pollRun(agentId, runId, options = {}) {
  const maxWaitMs = Number(options.maxWaitMs || appConfig.origami.maxWaitMs || 360000);
  const defaultPollMs = Number(options.pollMs || appConfig.origami.pollMs || 15000);
  const started = Date.now();
  let last = null;

  while (Date.now() - started < maxWaitMs) {
    const { run, retryAfter } = await getRun(agentId, runId, options);
    last = run;
    if (run?.status && run.status !== "running") return run;
    await sleep((retryAfter ? retryAfter * 1000 : defaultPollMs));
  }

  const error = new Error(`Origami run timed out after ${maxWaitMs}ms (last status: ${last?.status || "unknown"})`);
  error.statusCode = 504;
  error.details = { agentId, runId, last };
  throw error;
}

export async function listTableRowsFlat(tableId, options = {}) {
  const limit = Math.min(Number(options.limit || 50), 200);
  const rows = [];
  let cursor = null;
  let pages = 0;
  const maxPages = Number(options.maxPages || 5);

  do {
    const params = {
      cells: "flat",
      defaults: "false",
      limit
    };
    if (cursor) params.cursor = cursor;
    const { data } = await request("GET", `/tables/${tableId}/rows`, undefined, params);
    const items = data?.items || data?.rows || [];
    for (const item of items) rows.push(flattenRow(item));
    cursor = data?.nextCursor || null;
    pages += 1;
  } while (cursor && pages < maxPages && rows.length < Number(options.maxRows || 100));

  return rows;
}

export function mapOrigamiRowToLeadFields(row = {}) {
  const name = pickField(row, [
    "name", "company", "company_name", "organization", "org", "business_name", "lead_name", "title"
  ]);
  const url = pickField(row, [
    "website", "url", "company_website", "domain", "web", "homepage", "site"
  ]);
  const email = pickField(row, [
    "email", "email_address", "work_email", "contact_email", "primary_email"
  ]);
  const phone = pickField(row, [
    "phone", "phone_number", "telephone", "mobile", "work_phone", "contact_phone"
  ]);
  const address = pickField(row, [
    "address", "street_address", "company_address", "location", "full_address", "hq_address", "mailing_address"
  ]);
  const customerType = pickField(row, [
    "customer_type", "type", "segment", "industry", "category", "buyer_type"
  ]);
  const snippet = pickField(row, [
    "notes", "note", "description", "snippet", "summary", "why", "fit_explanation", "fit"
  ]);

  let website = url;
  if (website && !/^https?:\/\//i.test(website) && /\./.test(website)) {
    website = `https://${website.replace(/^\/+/, "")}`;
  }

  return {
    name: name || customerType || "Origami lead",
    url: website,
    email: email ? email.toLowerCase() : null,
    phone,
    address,
    customerType,
    snippet: snippet || null,
    raw: row
  };
}

export function buildLeadHuntPrompt({ category, segment, city, targets, limit = 8 } = {}) {
  const customerTypes = (targets?.customerTypes || []).slice(0, 8).join(", ") || "relevant buyers";
  const intent = (targets?.intentPhrases || []).slice(0, 4).join("; ");
  const exclude = (targets?.excludeKeywords || []).slice(0, 8).join(", ");
  const audience = segment === "residential"
    ? "residential / homeowner / HOA / condo association / community buyers"
    : "B2B commercial / multi-family / facility / property-management buyers";

  return [
    `Find up to ${limit} ${audience} prospects in ${city.city}, ${city.state} who are likely to BUY ${category} services.`,
    `Target customer types: ${customerTypes}.`,
    intent ? `Intent signals: ${intent}.` : "",
    exclude ? `Exclude competing vendors/contractors and directories matching: ${exclude}.` : "Exclude competing contractors and vendor directories.",
    "For each prospect collect contact-ready fields: organization/person name, website URL, phone, email, and street address in that city/market.",
    "Prefer publicly listed offices, associations, property managers, facilities, and decision-maker contacts over directories/review sites.",
    "Return one table with columns: name, website, phone, email, address, customer_type, notes.",
    "Only include rows where you can provide at least a name plus phone or email or address."
  ].filter(Boolean).join("\n");
}

/**
 * Run one Origami agent brief and map resulting table rows into raw lead hits.
 */
export async function huntCityWithOrigami({ category, segment, city, targets, limit = 8, model } = {}) {
  const prompt = buildLeadHuntPrompt({ category, segment, city, targets, limit });
  const created = await createAgent({
    prompt,
    name: `HA-Corr ${segment} ${category} ${city.city}`.slice(0, 80),
    model
  });

  const agentId = created?.agent?.id;
  const runId = created?.run?.id;
  if (!agentId || !runId) {
    const error = new Error("Origami createAgent response missing agent.id or run.id");
    error.statusCode = 502;
    error.details = created;
    throw error;
  }

  let run = created.run?.status && created.run.status !== "running"
    ? created.run
    : await pollRun(agentId, runId);

  // If the agent asks a clarifying question, answer with a short default and continue once.
  if (run?.status === "needs_input" || (run?.todo?.pendingQuestions || []).length) {
    const follow = await request("POST", `/agents/${agentId}/runs`, {
      prompt: [
        "Proceed with best judgment.",
        `Focus on ${city.city}, ${city.state}.`,
        "Prioritize phone, email, and street address columns.",
        `Return up to ${limit} contact-ready rows.`
      ].join(" "),
      model: model || appConfig.origami.model || undefined
    });
    const followRunId = follow.data?.run?.id || follow.data?.id;
    if (followRunId) {
      run = await pollRun(agentId, followRunId);
    }
  }

  if (!["completed", "needs_input", "step_cap_hit", "incomplete"].includes(run?.status)) {
    const error = new Error(`Origami run ended with status ${run?.status || "unknown"}`);
    error.statusCode = 502;
    error.details = { agentId, runId, status: run?.status, text: run?.response?.text };
    throw error;
  }

  const tables = run?.response?.tables || [];
  const tableId = tables[0]?.id;
  if (!tableId) {
    return {
      provider: "origami",
      agentId,
      runId: run.id || runId,
      workspaceId: created?.workspace?.id || created?.agent?.workspaceId || null,
      tableId: null,
      status: run.status,
      text: run?.response?.text || null,
      rows: [],
      hits: []
    };
  }

  const rows = await listTableRowsFlat(tableId, { limit: Math.max(limit, 20), maxRows: Math.max(limit, 40) });
  const hits = rows
    .map(mapOrigamiRowToLeadFields)
    .filter(hit => hit.name)
    .slice(0, limit)
    .map((hit, index) => ({
      title: hit.name,
      url: hit.url,
      snippet: hit.snippet || `Origami ${segment} lead for ${category} in ${city.label || city.city}.`,
      source: "origami",
      query: prompt.slice(0, 180),
      phone: hit.phone,
      email: hit.email,
      address: hit.address,
      customerType: hit.customerType || null,
      rank: index + 1,
      origami: {
        agentId,
        runId: run.id || runId,
        tableId,
        row: hit.raw
      }
    }));

  return {
    provider: "origami",
    agentId,
    runId: run.id || runId,
    workspaceId: created?.workspace?.id || created?.agent?.workspaceId || null,
    tableId,
    status: run.status,
    text: run?.response?.text || null,
    tableUrl: tables[0]?.url || null,
    rows,
    hits
  };
}
