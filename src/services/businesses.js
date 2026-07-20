import { getStore, makeId, nowIso, parseJson } from "../db/store.js";
import { createVendor, createVendorKey, getVendorById, getVendorBySlug } from "./vendors.js";
import { listLeads } from "./vendorLeads.js";
import { listQuotes } from "./vendorQuotes.js";
import { listJobs } from "./vendorJobs.js";
import { getVendorPricebook } from "./vendorPricebook.js";

const SEED_BUSINESSES = [
  {
    id: "biz_peachtree_grounds",
    slug: "peachtree-grounds-climate",
    name: "Peachtree Grounds & Climate",
    legalName: "Peachtree Grounds & Climate LLC",
    email: "ops@peachtreegrounds.example",
    phone: "404-555-2140",
    website: "https://peachtreegrounds.example",
    licenseNumber: "GA-LS-44821",
    address: "890 West Peachtree St NW",
    city: "Atlanta",
    state: "GA",
    zip: "30309",
    categories: ["landscape", "hvac", "cleaning"],
    primaryCategory: "landscape",
    crews: 6,
    employees: 28,
    defaultCrewSize: 3,
    unitPrices: { hourlyRate: 95, materialCost: 35, equipmentCost: 25, disposalCost: 40 },
    invoiceDefaults: { taxRate: 8.9, discount: 0, currency: "USD", paymentTerms: "Net 15" },
    notes: "Commercial grounds + rooftop HVAC for Midtown / Buckhead accounts.",
    status: "active",
    markets: [
      { city: "Atlanta", state: "GA", zips: ["30309", "30308", "30305"], primary: true },
      { city: "Decatur", state: "GA", zips: ["30030"], primary: false },
      { city: "Marietta", state: "GA", zips: ["30060"], primary: false }
    ],
    categorySettings: {
      landscape: { hourlyRate: 95, defaultCrewSize: 3, licenseNumber: "GA-LS-44821", materialCost: 35 },
      hvac: { hourlyRate: 125, defaultCrewSize: 2, licenseNumber: "GA-HVAC-9021", materialCost: 60 },
      cleaning: { hourlyRate: 55, defaultCrewSize: 4, licenseNumber: null, materialCost: 15 }
    },
    team: {
      crews: [
        { id: "crew_pg_1", name: "Grounds Alpha", categories: ["landscape"], lead: "Jordan Lee", size: 5 },
        { id: "crew_pg_2", name: "Grounds Bravo", categories: ["landscape", "cleaning"], lead: "Sam Ortiz", size: 4 },
        { id: "crew_pg_3", name: "Climate Tech 1", categories: ["hvac"], lead: "Riley Chen", size: 3 },
        { id: "crew_pg_4", name: "Climate Tech 2", categories: ["hvac"], lead: "Avery Kim", size: 3 },
        { id: "crew_pg_5", name: "Night Clean", categories: ["cleaning"], lead: "Morgan Blake", size: 4 },
        { id: "crew_pg_6", name: "Swing Relief", categories: ["landscape", "hvac", "cleaning"], lead: "Casey Dunn", size: 3 }
      ],
      employees: [
        { id: "emp_pg_1", name: "Jordan Lee", role: "crew-lead", categories: ["landscape"] },
        { id: "emp_pg_2", name: "Sam Ortiz", role: "crew-lead", categories: ["landscape", "cleaning"] },
        { id: "emp_pg_3", name: "Riley Chen", role: "hvac-tech", categories: ["hvac"] },
        { id: "emp_pg_4", name: "Avery Kim", role: "hvac-tech", categories: ["hvac"] },
        { id: "emp_pg_5", name: "Morgan Blake", role: "crew-lead", categories: ["cleaning"] },
        { id: "emp_pg_6", name: "Casey Dunn", role: "dispatcher", categories: ["landscape", "hvac", "cleaning"] }
      ]
    }
  },
  {
    id: "biz_coastal_home",
    slug: "coastal-home-systems",
    name: "Coastal Home Systems Co",
    legalName: "Coastal Home Systems Company Inc",
    email: "dispatch@coastalhomesystems.example",
    phone: "912-555-3388",
    website: "https://coastalhomesystems.example",
    licenseNumber: "GA-GC-77201",
    address: "412 East Bay Street",
    city: "Savannah",
    state: "GA",
    zip: "31401",
    categories: ["plumbing", "electrical", "roofing"],
    primaryCategory: "plumbing",
    crews: 4,
    employees: 18,
    defaultCrewSize: 2,
    unitPrices: { hourlyRate: 115, materialCost: 55, equipmentCost: 30, disposalCost: 20 },
    invoiceDefaults: { taxRate: 7.0, discount: 0, currency: "USD", paymentTerms: "Due on receipt" },
    notes: "Residential + light commercial trades across Savannah and the Islands.",
    status: "active",
    markets: [
      { city: "Savannah", state: "GA", zips: ["31401", "31405", "31406"], primary: true },
      { city: "Tybee Island", state: "GA", zips: ["31328"], primary: false },
      { city: "Pooler", state: "GA", zips: ["31322"], primary: false }
    ],
    categorySettings: {
      plumbing: { hourlyRate: 125, defaultCrewSize: 2, licenseNumber: "GA-PL-4410", materialCost: 70 },
      electrical: { hourlyRate: 130, defaultCrewSize: 2, licenseNumber: "GA-EL-2288", materialCost: 55 },
      roofing: { hourlyRate: 110, defaultCrewSize: 4, licenseNumber: "GA-RF-1102", materialCost: 90 }
    },
    team: {
      crews: [
        { id: "crew_ch_1", name: "Pipe & Drain", categories: ["plumbing"], lead: "Elena Ruiz", size: 4 },
        { id: "crew_ch_2", name: "Spark Line", categories: ["electrical"], lead: "Devon Hall", size: 3 },
        { id: "crew_ch_3", name: "Roof Guard", categories: ["roofing"], lead: "Marcus Bell", size: 5 },
        { id: "crew_ch_4", name: "Island Swing", categories: ["plumbing", "electrical"], lead: "Nina Park", size: 3 }
      ],
      employees: [
        { id: "emp_ch_1", name: "Elena Ruiz", role: "plumber", categories: ["plumbing"] },
        { id: "emp_ch_2", name: "Devon Hall", role: "electrician", categories: ["electrical"] },
        { id: "emp_ch_3", name: "Marcus Bell", role: "roofer", categories: ["roofing"] },
        { id: "emp_ch_4", name: "Nina Park", role: "crew-lead", categories: ["plumbing", "electrical"] }
      ]
    }
  },
  {
    id: "biz_metro_care",
    slug: "metro-care-collective",
    name: "Metro Care Collective",
    legalName: "Metro Care Collective LLC",
    email: "hello@metrocarecollective.example",
    phone: "706-555-9012",
    website: "https://metrocarecollective.example",
    licenseNumber: "GA-SVC-11904",
    address: "255 Broad Street",
    city: "Augusta",
    state: "GA",
    zip: "30901",
    categories: ["pest-control", "pool", "painting", "trash-removal"],
    primaryCategory: "pest-control",
    crews: 5,
    employees: 22,
    defaultCrewSize: 2,
    unitPrices: { hourlyRate: 85, materialCost: 40, equipmentCost: 15, disposalCost: 55 },
    invoiceDefaults: { taxRate: 8.0, discount: 25, currency: "USD", paymentTerms: "Net 30" },
    notes: "Multi-trade home care routes across Augusta–Aiken.",
    status: "active",
    markets: [
      { city: "Augusta", state: "GA", zips: ["30901", "30904", "30907"], primary: true },
      { city: "Aiken", state: "SC", zips: ["29801"], primary: false },
      { city: "Evans", state: "GA", zips: ["30809"], primary: false }
    ],
    categorySettings: {
      "pest-control": { hourlyRate: 90, defaultCrewSize: 2, licenseNumber: "GA-PEST-330", materialCost: 45 },
      pool: { hourlyRate: 80, defaultCrewSize: 2, licenseNumber: null, materialCost: 35 },
      painting: { hourlyRate: 75, defaultCrewSize: 3, licenseNumber: null, materialCost: 50 },
      "trash-removal": { hourlyRate: 70, defaultCrewSize: 3, licenseNumber: null, materialCost: 20, disposalCost: 65 }
    },
    team: {
      crews: [
        { id: "crew_mc_1", name: "Pest Patrol", categories: ["pest-control"], lead: "Chris Vale", size: 3 },
        { id: "crew_mc_2", name: "Aqua Route", categories: ["pool"], lead: "Pat Singh", size: 3 },
        { id: "crew_mc_3", name: "Brush Crew", categories: ["painting"], lead: "Jamie Fox", size: 4 },
        { id: "crew_mc_4", name: "Haul Team", categories: ["trash-removal"], lead: "Taylor Ng", size: 4 },
        { id: "crew_mc_5", name: "Flex Route", categories: ["pest-control", "pool", "painting"], lead: "Robin May", size: 3 }
      ],
      employees: [
        { id: "emp_mc_1", name: "Chris Vale", role: "tech", categories: ["pest-control"] },
        { id: "emp_mc_2", name: "Pat Singh", role: "tech", categories: ["pool"] },
        { id: "emp_mc_3", name: "Jamie Fox", role: "painter", categories: ["painting"] },
        { id: "emp_mc_4", name: "Taylor Ng", role: "driver", categories: ["trash-removal"] },
        { id: "emp_mc_5", name: "Robin May", role: "dispatcher", categories: ["pest-control", "pool", "painting", "trash-removal"] }
      ]
    }
  }
];

const SEED_SESSIONS = [
  { id: "bses_pg_lawn_01", businessId: "biz_peachtree_grounds", kind: "guided", category: "landscape", title: "Midtown HOA mowing route", status: "invoiced", customerName: "Cascade Commons HOA", summary: "Weekly mow + edging for 4.2 acres · crew of 3" },
  { id: "bses_pg_hvac_01", businessId: "biz_peachtree_grounds", kind: "guided", category: "hvac", title: "Rooftop RTU diagnostic", status: "quoted", customerName: "Buckhead Office Park", summary: "3-ton RTU not cooling · diagnostic + filter set" },
  { id: "bses_pg_clean_01", businessId: "biz_peachtree_grounds", kind: "ai-chat", category: "cleaning", title: "Nightly janitorial add-on", status: "draft", customerName: "Peachtree Lofts", summary: "Lobby + restrooms · 5 nights/week" },
  { id: "bses_ch_plumb_01", businessId: "biz_coastal_home", kind: "guided", category: "plumbing", title: "Water heater replacement", status: "won", customerName: "Elena Ruiz", summary: "50-gal electric swap · Isle of Hope" },
  { id: "bses_ch_elec_01", businessId: "biz_coastal_home", kind: "guided", category: "electrical", title: "Panel upgrade quote", status: "quoted", customerName: "Harbor View Inn", summary: "100A → 200A service · Historic District" },
  { id: "bses_ch_roof_01", businessId: "biz_coastal_home", kind: "ai-chat", category: "roofing", title: "Storm damage inspection", status: "contacted", customerName: "Marcus Bell", summary: "Asphalt shingle lift after coastal wind event" },
  { id: "bses_mc_pest_01", businessId: "biz_metro_care", kind: "guided", category: "pest-control", title: "Quarterly exterior treatment", status: "scheduled", customerName: "Summerville Residence", summary: "Perimeter spray + bait stations" },
  { id: "bses_mc_pool_01", businessId: "biz_metro_care", kind: "guided", category: "pool", title: "Weekly pool route", status: "invoiced", customerName: "River Ridge Club", summary: "Chem balance + skimmer clean · 2 stops" },
  { id: "bses_mc_paint_01", businessId: "biz_metro_care", kind: "ai-chat", category: "painting", title: "Interior refresh estimate", status: "draft", customerName: "The Laney Lofts", summary: "Hallways + unit turnovers · 18 units" }
];

function defaultTeam(crews = 2, employees = 6, categories = []) {
  const crewList = Array.from({ length: Math.max(1, Number(crews) || 1) }, (_, i) => ({
    id: makeId("crew"),
    name: `Crew ${i + 1}`,
    categories: categories.slice(0, 2),
    lead: `Lead ${i + 1}`,
    size: Math.max(2, Math.ceil((Number(employees) || 4) / Math.max(Number(crews) || 1, 1)))
  }));
  const employeeList = Array.from({ length: Math.min(Number(employees) || 4, 12) }, (_, i) => ({
    id: makeId("emp"),
    name: `Team member ${i + 1}`,
    role: i === 0 ? "dispatcher" : "tech",
    categories: categories.length ? [categories[i % categories.length]] : []
  }));
  return { crews: crewList, employees: employeeList };
}

function defaultMarkets(city, state, zip) {
  if (!city) return [];
  return [{ city, state: state || "GA", zips: zip ? [String(zip)] : [], primary: true }];
}

function defaultCategorySettings(categories = [], unitPrices = {}, defaultCrewSize = 2, licenseNumber = null) {
  const settings = {};
  for (const cat of categories) {
    settings[cat] = {
      hourlyRate: Number(unitPrices.hourlyRate || 95),
      defaultCrewSize: Number(defaultCrewSize || 2),
      licenseNumber: licenseNumber || null,
      materialCost: Number(unitPrices.materialCost || 0),
      disposalCost: Number(unitPrices.disposalCost || 0)
    };
  }
  return settings;
}

function mapBusiness(row) {
  if (!row) return null;
  const categories = parseJson(row.categories_json, []);
  const unitPrices = parseJson(row.unit_prices_json, {});
  const team = parseJson(row.team_json, null) || defaultTeam(row.crews, row.employees, categories);
  const markets = parseJson(row.markets_json, null) || defaultMarkets(row.city, row.state, row.zip);
  const categorySettings = parseJson(row.category_settings_json, null)
    || defaultCategorySettings(categories, unitPrices, row.default_crew_size, row.license_number);
  return {
    id: row.id,
    slug: row.slug,
    vendorId: row.vendor_id || null,
    name: row.name,
    legalName: row.legal_name,
    email: row.email,
    phone: row.phone,
    website: row.website,
    licenseNumber: row.license_number,
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    categories,
    primaryCategory: row.primary_category,
    crews: Number(row.crews || team.crews?.length || 0),
    employees: Number(row.employees || team.employees?.length || 0),
    defaultCrewSize: Number(row.default_crew_size || 2),
    unitPrices,
    invoiceDefaults: parseJson(row.invoice_defaults_json, {}),
    categorySettings,
    team,
    markets,
    notes: row.notes || "",
    status: row.status || "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    kind: row.kind,
    category: row.category,
    title: row.title,
    status: row.status,
    customerName: row.customer_name,
    summary: row.summary,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toBusinessRow(input, existing = null) {
  const now = nowIso();
  const mappedExisting = existing ? mapBusiness(existing) : null;
  const categories = Array.isArray(input.categories)
    ? input.categories
    : (mappedExisting?.categories || []);
  const unitPrices = input.unitPrices || mappedExisting?.unitPrices || {};
  const defaultCrewSize = Number(input.defaultCrewSize ?? mappedExisting?.defaultCrewSize ?? 2);
  const crews = Number(input.crews ?? mappedExisting?.crews ?? 0);
  const employees = Number(input.employees ?? mappedExisting?.employees ?? 0);
  const licenseNumber = input.licenseNumber ?? mappedExisting?.licenseNumber ?? null;

  return {
    id: existing?.id || input.id || makeId("biz"),
    slug: input.slug || existing?.slug || `business-${Date.now()}`,
    vendor_id: input.vendorId ?? existing?.vendor_id ?? null,
    name: input.name || existing?.name || "Untitled Business",
    legal_name: input.legalName ?? existing?.legal_name ?? null,
    email: input.email ?? existing?.email ?? null,
    phone: input.phone ?? existing?.phone ?? null,
    website: input.website ?? existing?.website ?? null,
    license_number: licenseNumber,
    address: input.address ?? existing?.address ?? null,
    city: input.city ?? existing?.city ?? null,
    state: input.state ?? existing?.state ?? "GA",
    zip: input.zip ?? existing?.zip ?? null,
    categories_json: categories,
    primary_category: input.primaryCategory
      || existing?.primary_category
      || categories[0]
      || null,
    crews,
    employees,
    default_crew_size: defaultCrewSize,
    unit_prices_json: unitPrices,
    invoice_defaults_json: input.invoiceDefaults || mappedExisting?.invoiceDefaults || {},
    category_settings_json: input.categorySettings
      || mappedExisting?.categorySettings
      || defaultCategorySettings(categories, unitPrices, defaultCrewSize, licenseNumber),
    team_json: input.team || mappedExisting?.team || defaultTeam(crews, employees, categories),
    markets_json: input.markets || mappedExisting?.markets || defaultMarkets(
      input.city ?? mappedExisting?.city,
      input.state ?? mappedExisting?.state,
      input.zip ?? mappedExisting?.zip
    ),
    notes: input.notes ?? existing?.notes ?? "",
    status: input.status || existing?.status || "active",
    created_at: existing?.created_at || now,
    updated_at: now
  };
}

/** Link or create the CRM vendor tenant for a business. */
export function ensureBusinessVendor(businessId, options = {}) {
  const business = getBusiness(businessId, { skipEnrich: true });
  if (!business) {
    const error = new Error("Business not found");
    error.statusCode = 404;
    throw error;
  }

  if (business.vendorId) {
    const vendor = getVendorById(business.vendorId);
    if (vendor) {
      let apiKey = null;
      if (options.issueKey) {
        apiKey = createVendorKey(vendor.id, { label: options.keyLabel || "business-hub" }).apiKey;
      }
      return { business: getBusiness(business.id), vendor, apiKey, created: false };
    }
  }

  const bySlug = getVendorBySlug(business.slug);
  if (bySlug) {
    getStore().businesses.updateWhere({ id: business.id }, {
      vendor_id: bySlug.id,
      updated_at: nowIso()
    });
    let apiKey = null;
    if (options.issueKey) {
      apiKey = createVendorKey(bySlug.id, { label: options.keyLabel || "business-hub" }).apiKey;
    }
    return { business: getBusiness(business.id), vendor: bySlug, apiKey, created: false };
  }

  const created = createVendor({
    name: business.name,
    slug: business.slug,
    email: business.email,
    phone: business.phone,
    defaultCategory: business.primaryCategory || business.categories[0] || "landscape",
    branding: { businessId: business.id },
    settings: { businessId: business.id, markets: business.markets },
    keyLabel: options.keyLabel || "business-hub"
  });
  getStore().businesses.updateWhere({ id: business.id }, {
    vendor_id: created.vendor.id,
    updated_at: nowIso()
  });

  // Seed tenant pricebook for primary category
  try {
    getVendorPricebook(created.vendor.id, { category: business.primaryCategory || "landscape" });
  } catch {
    /* ignore */
  }

  return {
    business: getBusiness(business.id),
    vendor: created.vendor,
    apiKey: created.apiKey,
    created: true
  };
}

export function computeCapacity(business, category = null) {
  const cat = category || business.primaryCategory || business.categories?.[0];
  const catSettings = (business.categorySettings || {})[cat] || {};
  const crews = Number(business.crews || business.team?.crews?.length || 1);
  const employees = Number(business.employees || business.team?.employees?.length || crews * 3);
  const empPerCrew = employees / Math.max(crews, 1);
  // Tight crews → slight rate premium; deep benches → small discount
  const rateMultiplier = empPerCrew < 3 ? 1.08 : empPerCrew > 5.5 ? 0.97 : 1;
  const recommendedCrewSize = Math.min(
    Number(catSettings.defaultCrewSize || business.defaultCrewSize || 2),
    Math.max(1, Math.round(empPerCrew))
  );
  const weeklyCrewHours = crews * 40;
  const openJobs = Number(business.health?.openJobs || 0);
  const utilization = weeklyCrewHours
    ? Math.min(1.25, Number(((openJobs * 6) / weeklyCrewHours).toFixed(2)))
    : 0;
  return {
    category: cat,
    crews,
    employees,
    empPerCrew: Number(empPerCrew.toFixed(2)),
    rateMultiplier,
    recommendedCrewSize,
    weeklyCrewHours,
    utilization,
    overtimeRisk: utilization > 0.9
  };
}

export function computeBusinessHealth(business) {
  if (!business?.vendorId) {
    const sessions = listBusinessSessions(business.id, { limit: 100 }).sessions;
    const openSessions = sessions.filter(s => ["draft", "quoted", "contacted"].includes(s.status)).length;
    return {
      leads: 0,
      openQuotes: 0,
      wonQuotes: 0,
      openJobs: 0,
      winRate: null,
      utilization: 0,
      overdueFollowUps: openSessions,
      sessionOpen: openSessions,
      source: "sessions-only"
    };
  }

  const leads = listLeads(business.vendorId, { limit: 200 });
  const quotes = listQuotes(business.vendorId, { limit: 200 });
  const jobs = listJobs(business.vendorId, { limit: 200 });
  const openQuotes = quotes.quotes.filter(q => ["draft", "sent"].includes(q.status)).length;
  const wonQuotes = quotes.quotes.filter(q => ["accepted", "paid"].includes(q.status) || q.status === "won").length;
  const lostQuotes = quotes.quotes.filter(q => q.status === "rejected" || q.status === "lost").length;
  const decided = wonQuotes + lostQuotes;
  const openJobs = jobs.jobs.filter(j => ["scheduled", "in-progress", "queued"].includes(j.status)).length;
  const nurture = leads.leads.filter(l => ["nurture", "contact-ready", "contacted"].includes(l.status)).length;
  const capacity = computeCapacity({ ...business, health: { openJobs } });
  return {
    leads: leads.count,
    openQuotes,
    wonQuotes,
    openJobs,
    winRate: decided ? Number(((wonQuotes / decided) * 100).toFixed(1)) : null,
    utilization: capacity.utilization,
    overdueFollowUps: nurture,
    sessionOpen: listBusinessSessions(business.id, { limit: 100 }).sessions
      .filter(s => ["draft", "quoted", "contacted"].includes(s.status)).length,
    source: "crm"
  };
}

function enrichBusiness(business, options = {}) {
  if (!business) return null;
  if (options.skipEnrich) return business;
  const health = computeBusinessHealth(business);
  const capacity = computeCapacity({ ...business, health });
  const vendor = business.vendorId ? getVendorById(business.vendorId) : null;
  return {
    ...business,
    health,
    capacity,
    bookingPath: vendor ? `/book/${vendor.slug}` : `/book/${business.slug}`,
    vendor: vendor ? { id: vendor.id, slug: vendor.slug, name: vendor.name } : null
  };
}

let seeding = false;

/** Idempotent seed of 3 real multi-category businesses + attached sessions + CRM vendors. */
export function ensureSeedBusinesses() {
  if (seeding) {
    return {
      businesses: getStore().businesses.find({}).length,
      created: 0,
      sessionsCreated: 0
    };
  }
  seeding = true;
  try {
  const db = getStore();
  let created = 0;
  for (const seed of SEED_BUSINESSES) {
    const existing = db.businesses.findOne({ id: seed.id });
    if (existing) {
      // Backfill enriched fields on older rows
      const mapped = mapBusiness(existing);
      const patch = {};
      if (!existing.team_json) patch.team_json = seed.team || mapped.team;
      if (!existing.markets_json) patch.markets_json = seed.markets || mapped.markets;
      if (!existing.category_settings_json) patch.category_settings_json = seed.categorySettings || mapped.categorySettings;
      if (Object.keys(patch).length) {
        db.businesses.updateWhere({ id: existing.id }, { ...patch, updated_at: nowIso() });
      }
      continue;
    }
    db.businesses.insert(toBusinessRow(seed));
    created += 1;
  }

  let sessionsCreated = 0;
  for (const seed of SEED_SESSIONS) {
    const existing = db.business_sessions.findOne({ id: seed.id });
    if (existing) continue;
    const now = nowIso();
    db.business_sessions.insert({
      id: seed.id,
      business_id: seed.businessId,
      kind: seed.kind,
      category: seed.category,
      title: seed.title,
      status: seed.status,
      customer_name: seed.customerName,
      summary: seed.summary,
      payload_json: {},
      created_at: now,
      updated_at: now
    });
    sessionsCreated += 1;
  }

  // Ensure each seeded business has a CRM vendor tenant
  for (const seed of SEED_BUSINESSES) {
    try {
      ensureBusinessVendor(seed.id, { issueKey: false });
    } catch {
      /* ignore */
    }
  }

  return {
    businesses: getStore().businesses.find({}).length,
    created,
    sessionsCreated
  };
  } finally {
    seeding = false;
  }
}

export function listBusinesses(options = {}) {
  ensureSeedBusinesses();
  const rows = getStore().businesses.find({}, {
    sort: [{ key: "name", dir: "asc" }],
    limit: Math.min(Number(options.limit || 50), 200)
  });
  const businesses = rows.map(row => {
    const business = enrichBusiness(mapBusiness(row));
    const sessions = listBusinessSessions(business.id, { limit: 20 });
    return {
      ...business,
      sessionCount: sessions.count,
      sessions: sessions.sessions
    };
  });
  return { count: businesses.length, businesses };
}

export function getBusiness(businessId, options = {}) {
  if (!options.skipEnrich) ensureSeedBusinesses();
  const row = getStore().businesses.findOne({ id: businessId })
    || getStore().businesses.findOne({ slug: businessId });
  if (!row) return null;
  const business = mapBusiness(row);
  if (options.skipEnrich) return business;
  const sessions = listBusinessSessions(business.id, { limit: 50 });
  return enrichBusiness({
    ...business,
    sessionCount: sessions.count,
    sessions: sessions.sessions
  });
}

export function createBusiness(input = {}) {
  ensureSeedBusinesses();
  const categories = Array.isArray(input.categories) && input.categories.length
    ? input.categories
    : [input.primaryCategory || input.category || "landscape"];
  const crews = Number(input.crews || 2);
  const employees = Number(input.employees || Math.max(6, crews * 3));
  const unitPrices = input.unitPrices || { hourlyRate: 95, materialCost: 0, equipmentCost: 0, disposalCost: 0 };
  const slugBase = String(input.slug || input.name || "new-business")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  const row = toBusinessRow({
    id: makeId("biz"),
    slug: slugBase || makeId("biz"),
    name: input.name || "New Business",
    legalName: input.legalName || input.name,
    email: input.email || null,
    phone: input.phone || null,
    licenseNumber: input.licenseNumber || null,
    address: input.address || null,
    city: input.city || "Atlanta",
    state: input.state || "GA",
    zip: input.zip || null,
    categories,
    primaryCategory: input.primaryCategory || categories[0],
    crews,
    employees,
    defaultCrewSize: Number(input.defaultCrewSize || 2),
    unitPrices,
    invoiceDefaults: input.invoiceDefaults || { taxRate: 8.9, discount: 0, currency: "USD", paymentTerms: "Net 15" },
    categorySettings: input.categorySettings || defaultCategorySettings(categories, unitPrices, input.defaultCrewSize || 2, input.licenseNumber),
    team: input.team || defaultTeam(crews, employees, categories),
    markets: input.markets || defaultMarkets(input.city || "Atlanta", input.state || "GA", input.zip),
    notes: input.notes || ""
  });

  // Unique slug
  if (getStore().businesses.findOne({ slug: row.slug })) {
    row.slug = `${row.slug}-${makeId("x").slice(-4)}`;
  }
  getStore().businesses.insert(row);

  const linked = ensureBusinessVendor(row.id, { issueKey: true, keyLabel: "onboarding" });

  // First attached session
  const session = attachBusinessSession(row.id, {
    kind: "onboarding",
    category: row.primary_category,
    title: "Welcome session — first quote",
    status: "draft",
    customerName: "Sample customer",
    summary: `Onboarding for ${row.name}. Run AI Chat or Autopilot to replace this draft.`
  });

  return {
    business: getBusiness(row.id),
    vendor: linked.vendor,
    apiKey: linked.apiKey,
    session,
    warning: "Store apiKey now — it unlocks this business CRM / pipeline."
  };
}

export function updateBusiness(businessId, patch = {}) {
  ensureSeedBusinesses();
  const existing = getStore().businesses.findOne({ id: businessId })
    || getStore().businesses.findOne({ slug: businessId });
  if (!existing) {
    const error = new Error("Business not found");
    error.statusCode = 404;
    throw error;
  }
  const current = mapBusiness(existing);
  const next = toBusinessRow({
    ...current,
    ...patch,
    id: existing.id,
    slug: existing.slug,
    vendorId: patch.vendorId ?? current.vendorId
  }, existing);
  // Keep crew/employee counts aligned with team roster when team provided
  if (patch.team) {
    next.crews = patch.team.crews?.length ?? next.crews;
    next.employees = Math.max(next.employees, patch.team.employees?.length ?? 0);
  }
  getStore().businesses.updateWhere({ id: existing.id }, next);

  // Keep vendor profile in sync
  if (current.vendorId || next.vendor_id) {
    const vendorId = next.vendor_id || current.vendorId;
    getStore().vendors.updateWhere({ id: vendorId }, {
      name: next.name,
      email: next.email,
      phone: next.phone,
      default_category: next.primary_category,
      updated_at: nowIso()
    });
  }

  return getBusiness(existing.id);
}

export function listBusinessSessions(businessId, options = {}) {
  const rows = getStore().business_sessions.find({ business_id: businessId }, {
    sort: [{ key: "updated_at", dir: "desc" }],
    limit: Math.min(Number(options.limit || 50), 200)
  });
  return { count: rows.length, sessions: rows.map(mapSession) };
}

export function attachBusinessSession(businessId, input = {}) {
  const business = getBusiness(businessId, { skipEnrich: true }) || getBusiness(businessId);
  if (!business) {
    const error = new Error("Business not found");
    error.statusCode = 404;
    throw error;
  }
  const now = nowIso();
  const id = input.id || makeId("bses");
  const existing = getStore().business_sessions.findOne({ id });
  if (existing) {
    getStore().business_sessions.updateWhere({ id }, {
      kind: input.kind || existing.kind,
      category: input.category || existing.category,
      title: input.title || existing.title,
      status: input.status || existing.status,
      customer_name: input.customerName || input.customer?.name || existing.customer_name,
      summary: input.summary ?? existing.summary,
      payload_json: input.payload || parseJson(existing.payload_json, {}),
      updated_at: now
    });
    return mapSession(getStore().business_sessions.findOne({ id }));
  }
  getStore().business_sessions.insert({
    id,
    business_id: business.id,
    kind: input.kind || "guided",
    category: input.category || business.primaryCategory,
    title: input.title || `${input.category || business.primaryCategory} session`,
    status: input.status || "draft",
    customer_name: input.customerName || input.customer?.name || null,
    summary: input.summary || "",
    payload_json: input.payload || {},
    created_at: now,
    updated_at: now
  });
  return mapSession(getStore().business_sessions.findOne({ id }));
}

/** Promote a business session lead into the linked vendor CRM (creates draft quote optional). */
export async function promoteSessionToCrm(businessId, sessionId, options = {}) {
  const { promoteAutopilotSimToCrm, quoteSendJobForLead } = await import("./crmPromote.js");
  const linked = ensureBusinessVendor(businessId, { issueKey: false });
  const sessions = listBusinessSessions(linked.business.id, { limit: 100 }).sessions;
  const session = sessions.find(item => item.id === sessionId);
  if (!session) {
    const error = new Error("Session not found");
    error.statusCode = 404;
    throw error;
  }

  const imported = promoteAutopilotSimToCrm(linked.vendor.id, {
    category: session.category || linked.business.primaryCategory,
    leads: [{
      id: session.id,
      name: session.customerName || session.title,
      category: session.category,
      score: 80,
      stage: session.status === "quoted" ? "quoted" : "contact-ready",
      service: session.title,
      city: linked.business.city,
      state: linked.business.state,
      address: linked.business.address
    }]
  });

  let quoted = null;
  if (options.quote !== false && imported.leads?.[0]) {
    const settings = toBusinessSettings(linked.business, session.category);
    quoted = await quoteSendJobForLead(linked.vendor.id, imported.leads[0], {
      amount: options.amount || settings.unitPrices?.averageJobTotal || settings.capacity?.suggestedAmount,
      send: options.send === true,
      serviceName: session.title,
      notes: `Promoted from business session ${session.id}`
    });
  }

  attachBusinessSession(linked.business.id, {
    id: session.id,
    status: quoted ? "quoted" : "contacted",
    summary: quoted
      ? `${session.summary || session.title} · CRM quote ${quoted.quote?.id}`
      : `${session.summary || session.title} · promoted to CRM`,
    payload: { ...(session.payload || {}), crmLeadId: imported.leads?.[0]?.id, quoteId: quoted?.quote?.id }
  });

  return {
    business: getBusiness(linked.business.id),
    imported,
    quote: quoted?.quote || null,
    link: quoted?.link || null
  };
}

/** Shape used by AI Chat / guided quoting as businessSettings (capacity-aware, category-aware). */
export function toBusinessSettings(business, category = null) {
  if (!business) return null;
  const cat = category || business.primaryCategory || business.categories?.[0];
  const catSettings = (business.categorySettings || {})[cat] || {};
  const capacity = business.capacity || computeCapacity(business, cat);
  const baseRate = Number(catSettings.hourlyRate || business.unitPrices?.hourlyRate || 95);
  const hourlyRate = Number((baseRate * capacity.rateMultiplier).toFixed(2));
  const defaultCrewSize = capacity.recommendedCrewSize
    || Number(catSettings.defaultCrewSize || business.defaultCrewSize || 2);
  return {
    businessId: business.id,
    vendorId: business.vendorId,
    businessName: business.name,
    email: business.email,
    phone: business.phone,
    licenseNumber: catSettings.licenseNumber || business.licenseNumber,
    defaultCrewSize,
    crews: business.crews,
    employees: business.employees,
    categories: business.categories,
    primaryCategory: business.primaryCategory,
    activeCategory: cat,
    markets: business.markets || [],
    team: business.team || null,
    capacity,
    unitPrices: {
      ...(business.unitPrices || {}),
      hourlyRate,
      materialCost: Number(catSettings.materialCost ?? business.unitPrices?.materialCost ?? 0),
      disposalCost: Number(catSettings.disposalCost ?? business.unitPrices?.disposalCost ?? 0),
      defaultHours: 2,
      averageJobTotal: Number((hourlyRate * defaultCrewSize * 2).toFixed(2))
    },
    city: business.city,
    state: business.state
  };
}
