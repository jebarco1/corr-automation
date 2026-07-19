import { getStore, makeId, nowIso, parseJson } from "../db/store.js";

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
    status: "active"
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
    status: "active"
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
    status: "active"
  }
];

const SEED_SESSIONS = [
  {
    id: "bses_pg_lawn_01",
    businessId: "biz_peachtree_grounds",
    kind: "guided",
    category: "landscape",
    title: "Midtown HOA mowing route",
    status: "invoiced",
    customerName: "Cascade Commons HOA",
    summary: "Weekly mow + edging for 4.2 acres · crew of 3"
  },
  {
    id: "bses_pg_hvac_01",
    businessId: "biz_peachtree_grounds",
    kind: "guided",
    category: "hvac",
    title: "Rooftop RTU diagnostic",
    status: "quoted",
    customerName: "Buckhead Office Park",
    summary: "3-ton RTU not cooling · diagnostic + filter set"
  },
  {
    id: "bses_pg_clean_01",
    businessId: "biz_peachtree_grounds",
    kind: "ai-chat",
    category: "cleaning",
    title: "Nightly janitorial add-on",
    status: "draft",
    customerName: "Peachtree Lofts",
    summary: "Lobby + restrooms · 5 nights/week"
  },
  {
    id: "bses_ch_plumb_01",
    businessId: "biz_coastal_home",
    kind: "guided",
    category: "plumbing",
    title: "Water heater replacement",
    status: "won",
    customerName: "Elena Ruiz",
    summary: "50-gal electric swap · Isle of Hope"
  },
  {
    id: "bses_ch_elec_01",
    businessId: "biz_coastal_home",
    kind: "guided",
    category: "electrical",
    title: "Panel upgrade quote",
    status: "quoted",
    customerName: "Harbor View Inn",
    summary: "100A → 200A service · Historic District"
  },
  {
    id: "bses_ch_roof_01",
    businessId: "biz_coastal_home",
    kind: "ai-chat",
    category: "roofing",
    title: "Storm damage inspection",
    status: "contacted",
    customerName: "Marcus Bell",
    summary: "Asphalt shingle lift after coastal wind event"
  },
  {
    id: "bses_mc_pest_01",
    businessId: "biz_metro_care",
    kind: "guided",
    category: "pest-control",
    title: "Quarterly exterior treatment",
    status: "scheduled",
    customerName: "Summerville Residence",
    summary: "Perimeter spray + bait stations"
  },
  {
    id: "bses_mc_pool_01",
    businessId: "biz_metro_care",
    kind: "guided",
    category: "pool",
    title: "Weekly pool route",
    status: "invoiced",
    customerName: "River Ridge Club",
    summary: "Chem balance + skimmer clean · 2 stops"
  },
  {
    id: "bses_mc_paint_01",
    businessId: "biz_metro_care",
    kind: "ai-chat",
    category: "painting",
    title: "Interior refresh estimate",
    status: "draft",
    customerName: "The Laney Lofts",
    summary: "Hallways + unit turnovers · 18 units"
  }
];

function mapBusiness(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
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
    categories: parseJson(row.categories_json, []),
    primaryCategory: row.primary_category,
    crews: Number(row.crews || 0),
    employees: Number(row.employees || 0),
    defaultCrewSize: Number(row.default_crew_size || 2),
    unitPrices: parseJson(row.unit_prices_json, {}),
    invoiceDefaults: parseJson(row.invoice_defaults_json, {}),
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
  const categories = Array.isArray(input.categories)
    ? input.categories
    : (existing ? parseJson(existing.categories_json, []) : []);
  return {
    id: existing?.id || input.id || makeId("biz"),
    slug: input.slug || existing?.slug || `business-${Date.now()}`,
    name: input.name || existing?.name || "Untitled Business",
    legal_name: input.legalName ?? existing?.legal_name ?? null,
    email: input.email ?? existing?.email ?? null,
    phone: input.phone ?? existing?.phone ?? null,
    website: input.website ?? existing?.website ?? null,
    license_number: input.licenseNumber ?? existing?.license_number ?? null,
    address: input.address ?? existing?.address ?? null,
    city: input.city ?? existing?.city ?? null,
    state: input.state ?? existing?.state ?? null,
    zip: input.zip ?? existing?.zip ?? null,
    categories_json: categories,
    primary_category: input.primaryCategory
      || existing?.primary_category
      || categories[0]
      || null,
    crews: Number(input.crews ?? existing?.crews ?? 0),
    employees: Number(input.employees ?? existing?.employees ?? 0),
    default_crew_size: Number(input.defaultCrewSize ?? existing?.default_crew_size ?? 2),
    unit_prices_json: input.unitPrices || parseJson(existing?.unit_prices_json, {}) || {},
    invoice_defaults_json: input.invoiceDefaults || parseJson(existing?.invoice_defaults_json, {}) || {},
    notes: input.notes ?? existing?.notes ?? "",
    status: input.status || existing?.status || "active",
    created_at: existing?.created_at || now,
    updated_at: now
  };
}

/** Idempotent seed of 3 real multi-category businesses + attached sessions. */
export function ensureSeedBusinesses() {
  const db = getStore();
  let created = 0;
  for (const seed of SEED_BUSINESSES) {
    const existing = db.businesses.findOne({ id: seed.id });
    if (existing) continue;
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

  return {
    businesses: getStore().businesses.find({}).length,
    created,
    sessionsCreated
  };
}

export function listBusinesses(options = {}) {
  ensureSeedBusinesses();
  const rows = getStore().businesses.find({}, {
    sort: [{ key: "name", dir: "asc" }],
    limit: Math.min(Number(options.limit || 50), 200)
  });
  const businesses = rows.map(row => {
    const business = mapBusiness(row);
    const sessions = listBusinessSessions(business.id, { limit: 20 });
    return {
      ...business,
      sessionCount: sessions.count,
      sessions: sessions.sessions
    };
  });
  return { count: businesses.length, businesses };
}

export function getBusiness(businessId) {
  ensureSeedBusinesses();
  const row = getStore().businesses.findOne({ id: businessId })
    || getStore().businesses.findOne({ slug: businessId });
  if (!row) return null;
  const business = mapBusiness(row);
  const sessions = listBusinessSessions(business.id, { limit: 50 });
  return {
    ...business,
    sessionCount: sessions.count,
    sessions: sessions.sessions
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
  const next = toBusinessRow({ ...mapBusiness(existing), ...patch, id: existing.id, slug: existing.slug }, existing);
  getStore().businesses.updateWhere({ id: existing.id }, next);
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
  const business = getBusiness(businessId);
  if (!business) {
    const error = new Error("Business not found");
    error.statusCode = 404;
    throw error;
  }
  const now = nowIso();
  const id = input.id || makeId("bses");
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

/** Shape used by AI Chat / guided quoting as businessSettings. */
export function toBusinessSettings(business) {
  if (!business) return null;
  return {
    businessId: business.id,
    businessName: business.name,
    email: business.email,
    phone: business.phone,
    licenseNumber: business.licenseNumber,
    defaultCrewSize: business.defaultCrewSize,
    crews: business.crews,
    employees: business.employees,
    categories: business.categories,
    primaryCategory: business.primaryCategory,
    unitPrices: business.unitPrices || {},
    city: business.city,
    state: business.state
  };
}
