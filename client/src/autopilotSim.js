/** Deterministic-ish scenario data for the live autopilot demo. */

const CITY_POOL = [
  { city: "Atlanta", state: "GA" },
  { city: "Macon", state: "GA" },
  { city: "Savannah", state: "GA" },
  { city: "Augusta", state: "GA" }
];

const LEAD_NAMES = {
  landscape: [
    ["Peachtree Commons HOA", "hoa", "b2b"],
    ["Midtown Office Park", "commercial", "b2b"],
    ["Ansley Lane HOA", "hoa", "b2b"],
    ["Riverwalk Apartments", "multi-family", "b2b"],
    ["Grant Park Residences", "homeowner", "residential"],
    ["Buckhead Estates Board", "hoa", "b2b"],
    ["Decatur Townhomes Assoc.", "condo", "residential"],
    ["West End Warehouse Yard", "industrial", "b2b"]
  ],
  hvac: [
    ["Cascade Medical Plaza", "commercial", "b2b"],
    ["Old Fourth Ward Lofts", "multi-family", "b2b"],
    ["Emory Clinic Annex", "healthcare", "b2b"],
    ["Inman Park Homeowner", "homeowner", "residential"],
    ["Airport Hotel HVAC Desk", "hospitality", "b2b"],
    ["East Atlanta Duplex", "homeowner", "residential"]
  ],
  cleaning: [
    ["Ponce City Offices", "commercial", "b2b"],
    ["Tech Square Suites", "commercial", "b2b"],
    ["Virginia-Highland Dental", "healthcare", "b2b"],
    ["Move-out: Edgewood Apt", "residential", "residential"]
  ],
  default: [
    ["North Ave Property Mgmt", "property management", "b2b"],
    ["Capitol View HOA", "hoa", "b2b"],
    ["Summerhill Homeowner", "homeowner", "residential"],
    ["Freight Depot Facility", "industrial", "b2b"],
    ["Ormewood Park Condo Assoc", "condo", "residential"],
    ["Westside Logistics Yard", "commercial", "b2b"]
  ]
};

const SERVICES = {
  landscape: ["Lawn Mowing", "Full Maintenance", "Mulch Install", "Spring Cleanup"],
  hvac: ["Diagnostic Visit", "Maintenance Plan", "RTU Replacement", "Filter Program"],
  cleaning: ["Weekly Janitorial", "Deep Clean", "Move-out Clean", "Floor Care"],
  default: ["Inspection", "Service Visit", "Maintenance Plan", "Project Estimate"]
};

function pickPool(category) {
  return LEAD_NAMES[category] || LEAD_NAMES.default;
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function money(rng, min, max) {
  return Math.round((min + (max - min) * rng()) * 100) / 100;
}

function phone(rng, cityIndex) {
  const exchange = 200 + Math.floor(rng() * 700);
  const line = 1000 + Math.floor(rng() * 9000);
  const area = [404, 478, 912, 706][cityIndex % 4];
  return `(${area}) ${exchange}-${line}`;
}

/**
 * Build a full simulated autopilot run plan for one category.
 * Returns timed events the UI can play live.
 */
export function buildAutopilotScenario(category = "landscape", options = {}) {
  const label = options.label || category;
  const seed = hashSeed(`${category}:${options.seed || "demo-v1"}`);
  const rng = mulberry32(seed);
  const pool = pickPool(category);
  const services = SERVICES[category] || SERVICES.default;
  const cities = CITY_POOL;
  const leadCount = Math.min(pool.length, Number(options.leadCount || 6));
  const costPerHunt = Number(options.estimatedHuntUsd || 10.1);

  const leads = Array.from({ length: leadCount }, (_, index) => {
    const [name, customerType, segment] = pool[index % pool.length];
    const city = cities[index % cities.length];
    const completeness = index % 5 === 0 ? 2 : 3;
    return {
      id: `sim_${category}_${index + 1}`,
      name,
      customerType,
      segment,
      city: city.city,
      state: city.state,
      market: `${city.city}, ${city.state}`,
      phone: phone(rng, index),
      email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`,
      address: `${100 + Math.floor(rng() * 800)} ${["Peachtree", "Ponce", "Cascade", "Monroe"][index % 4]} St, ${city.city}, ${city.state}`,
      service: services[index % services.length],
      score: 62 + Math.floor(rng() * 34),
      quoteAmount: money(rng, category === "hvac" ? 180 : 95, category === "hvac" ? 4200 : 1450),
      stage: "queued",
      completeness
    };
  });

  // Timeline of live events (ms offsets from start)
  const events = [];
  let t = 0;
  const push = (delay, event) => {
    t += delay;
    events.push({ at: t, ...event });
  };

  push(0, {
    type: "system",
    title: "Autopilot armed",
    detail: `${label} · Georgia pilots · simulation mode (no live spend)`
  });
  push(700, {
    type: "cost",
    title: "Cost quote preflight",
    detail: `Estimated hunt spend ~$${costPerHunt.toFixed(2)} for 1 category × 4 cities`,
    metric: { key: "costUsd", value: costPerHunt }
  });
  push(900, {
    type: "phase",
    phase: "hunt",
    title: "Lead hunt started",
    detail: "Origami + local headhunter scanning B2B and residential targets"
  });

  cities.forEach((city, index) => {
    push(650 + index * 120, {
      type: "hunt-city",
      title: `Scanning ${city.city}, ${city.state}`,
      detail: `Customer types · contact enrichment · competitor filter`,
      city: city.city
    });
  });

  leads.forEach((lead, index) => {
    push(500 + index * 180, {
      type: "lead-found",
      title: `Lead found · ${lead.name}`,
      detail: `${lead.segment.toUpperCase()} · ${lead.customerType} · ${lead.market}`,
      leadId: lead.id,
      lead: { ...lead, stage: "new" }
    });
    push(220, {
      type: "lead-enrich",
      title: `Contacts verified · ${lead.name}`,
      detail: `${lead.phone} · ${lead.email}`,
      leadId: lead.id,
      leadPatch: { stage: "contact-ready", completeness: lead.completeness }
    });
  });

  push(600, {
    type: "phase",
    phase: "outreach",
    title: "Outreach autopilot",
    detail: "Drafting intro + service offer for contact-ready leads"
  });

  // Outreach + quote for first N leads that convert
  const convertCount = Math.max(2, Math.min(4, Math.floor(leads.length * 0.55)));
  leads.slice(0, convertCount).forEach((lead, index) => {
    push(480 + index * 140, {
      type: "outreach",
      title: `Outreach sent · ${lead.name}`,
      detail: `SMS + email · offer: ${lead.service}`,
      leadId: lead.id,
      leadPatch: { stage: "contacted" }
    });
    push(520, {
      type: "quote",
      title: `Quote drafted · ${lead.service}`,
      detail: `${lead.name} · $${lead.quoteAmount.toLocaleString()}`,
      leadId: lead.id,
      leadPatch: { stage: "quoted" },
      metric: { key: "quotes", delta: 1 },
      invoice: {
        customer: lead.name,
        service: lead.service,
        amount: lead.quoteAmount,
        market: lead.market,
        status: "draft"
      }
    });
  });

  // Acceptances / jobs / payments for a subset
  const won = leads.slice(0, Math.max(1, convertCount - 1));
  push(700, {
    type: "phase",
    phase: "fulfill",
    title: "Close → schedule → collect",
    detail: "Simulating acceptances, crew dispatch, and payments"
  });

  won.forEach((lead, index) => {
    push(560 + index * 160, {
      type: "accepted",
      title: `Quote accepted · ${lead.name}`,
      detail: `$${lead.quoteAmount.toLocaleString()} locked`,
      leadId: lead.id,
      leadPatch: { stage: "won" },
      metric: { key: "won", delta: 1, revenue: lead.quoteAmount }
    });
    push(420, {
      type: "job",
      title: `Job scheduled · ${lead.service}`,
      detail: `Crew assigned · ${lead.address}`,
      leadId: lead.id,
      leadPatch: { stage: "scheduled" }
    });
    push(480, {
      type: "paid",
      title: `Payment captured · ${lead.name}`,
      detail: `Deposit/balance · $${lead.quoteAmount.toLocaleString()}`,
      leadId: lead.id,
      leadPatch: { stage: "paid" },
      metric: { key: "paid", delta: 1, revenue: lead.quoteAmount }
    });
  });

  // Remaining quoted leads stay warm
  leads.slice(convertCount).forEach((lead, index) => {
    push(300 + index * 80, {
      type: "nurture",
      title: `Follow-up queued · ${lead.name}`,
      detail: "No reply yet · nurture sequence day 2",
      leadId: lead.id,
      leadPatch: { stage: "nurture" }
    });
  });

  push(900, {
    type: "phase",
    phase: "complete",
    title: "Autopilot cycle complete",
    detail: `${label} loop finished — ready for next cycle`
  });

  const projectedRevenue = won.reduce((sum, lead) => sum + lead.quoteAmount, 0);

  return {
    category,
    label,
    seed,
    costPerHunt,
    cities: cities.map(c => `${c.city}, ${c.state}`),
    leads,
    events,
    summary: {
      leadTarget: leadCount,
      convertTarget: convertCount,
      wonTarget: won.length,
      projectedRevenue: Math.round(projectedRevenue * 100) / 100,
      estimatedApiSpend: costPerHunt
    }
  };
}

export const PIPELINE_STAGES = [
  { id: "new", label: "New" },
  { id: "contact-ready", label: "Contact ready" },
  { id: "contacted", label: "Contacted" },
  { id: "quoted", label: "Quoted" },
  { id: "won", label: "Won" },
  { id: "scheduled", label: "Scheduled" },
  { id: "paid", label: "Paid" },
  { id: "nurture", label: "Nurture" }
];

export const PHASES = [
  { id: "idle", label: "Standby" },
  { id: "hunt", label: "Hunt leads" },
  { id: "outreach", label: "Outreach" },
  { id: "fulfill", label: "Fulfill & collect" },
  { id: "complete", label: "Cycle done" }
];
