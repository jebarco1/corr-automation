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
  "bakery-food": [
    ["Peachtree Wedding Co.", "event venue", "b2b"],
    ["Midtown Cafe Group", "cafe", "b2b"],
    ["Buckhead Hotel Banquets", "hotel", "b2b"],
    ["Grant Park Birthday Host", "homeowner", "residential"],
    ["Decatur Corporate HQ", "office", "b2b"],
    ["Inman Park Dessert Table", "homeowner", "residential"]
  ],
  "law-office": [
    ["Cascade Property Mgmt", "property management", "b2b"],
    ["Startup Studio ATL", "startup", "b2b"],
    ["Ansley Medical Group", "medical practice", "b2b"],
    ["East Atlanta Homeowner", "homeowner", "residential"],
    ["West End Builders LLC", "construction", "b2b"],
    ["Ormewood Estate Client", "homeowner", "residential"]
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
  "bakery-food": ["Custom Cake Order", "Catering Tray", "Corporate Breakfast", "Wholesale Bread Program"],
  "law-office": ["Initial Consultation", "Document Review", "Divorce", "Retainer Block", "Business Formation Package"],
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
      quoteAmount: money(
        rng,
        category === "hvac" ? 180 : category === "law-office" ? 350 : category === "bakery-food" ? 65 : 95,
        category === "hvac" ? 4200 : category === "law-office" ? 6500 : category === "bakery-food" ? 1800 : 1450
      ),
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
    const quoteId = `qt_${lead.id}`;
    push(520, {
      type: "quote",
      title: `Quote drafted · ${lead.service}`,
      detail: `${lead.name} · $${lead.quoteAmount.toLocaleString()}`,
      leadId: lead.id,
      leadPatch: { stage: "quoted", quoteId, quoteStatus: "draft" },
      metric: { key: "quotes", delta: 1 },
      invoice: {
        id: quoteId,
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

  const crews = ["Crew A · North", "Crew B · Midtown", "Crew C · East"];
  won.forEach((lead, index) => {
    const quoteId = `qt_${lead.id}`;
    const jobId = `job_${lead.id}`;
    const dayOffset = 1 + index;
    push(560 + index * 160, {
      type: "accepted",
      title: `Quote accepted · ${lead.name}`,
      detail: `$${lead.quoteAmount.toLocaleString()} locked`,
      leadId: lead.id,
      leadPatch: { stage: "won", quoteId, quoteStatus: "accepted" },
      metric: { key: "won", delta: 1, revenue: lead.quoteAmount }
    });
    push(420, {
      type: "job",
      title: `Job scheduled · ${lead.service}`,
      detail: `Crew assigned · ${lead.address}`,
      leadId: lead.id,
      leadPatch: { stage: "scheduled", jobId },
      job: {
        id: jobId,
        leadId: lead.id,
        quoteId,
        title: lead.service,
        customer: lead.name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        market: lead.market,
        amount: lead.quoteAmount,
        status: "scheduled",
        assignee: crews[index % crews.length],
        scheduledLabel: `Tomorrow +${dayOffset}d · 9:00 AM`
      }
    });
    push(480, {
      type: "paid",
      title: `Payment captured · ${lead.name}`,
      detail: `Deposit/balance · $${lead.quoteAmount.toLocaleString()}`,
      leadId: lead.id,
      leadPatch: { stage: "paid", paid: true },
      jobPatch: { id: jobId, status: "paid", paidAmount: lead.quoteAmount },
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

const STAGE_LABELS = Object.fromEntries(PIPELINE_STAGES.map(item => [item.id, item.label]));

/**
 * Value snapshot + ranked next actions after a completed (or paused mid-run) cycle.
 */
export function buildAutopilotResults({
  leads = [],
  jobs = [],
  metrics = {},
  category = "landscape",
  label = "Category",
  summary = {},
  elapsed = 0
} = {}) {
  const spend = Number(metrics.costUsd || summary.estimatedApiSpend || 0);
  const revenue = Number(metrics.revenue || 0);
  const pipelineValue = leads
    .filter(lead => ["quoted", "won", "scheduled", "nurture", "contacted", "contact-ready"].includes(lead.stage))
    .reduce((sum, lead) => sum + Number(lead.quoteAmount || 0), 0);
  const openPipeline = leads
    .filter(lead => ["quoted", "nurture", "contacted", "contact-ready"].includes(lead.stage))
    .reduce((sum, lead) => sum + Number(lead.quoteAmount || 0), 0);
  const roiMultiple = spend > 0 ? Math.round((revenue / spend) * 10) / 10 : null;
  const conversionRate = metrics.leads
    ? Math.round(((metrics.won || 0) / metrics.leads) * 100)
    : 0;

  const value = {
    revenue,
    spend,
    net: Math.round((revenue - spend) * 100) / 100,
    roiMultiple,
    pipelineValue: Math.round(pipelineValue * 100) / 100,
    openPipeline: Math.round(openPipeline * 100) / 100,
    conversionRate,
    leads: metrics.leads || leads.length,
    quotes: metrics.quotes || 0,
    won: metrics.won || 0,
    paid: metrics.paid || 0,
    jobs: jobs.length,
    elapsed,
    projectedRevenue: Number(summary.projectedRevenue || 0)
  };

  const suggestions = buildAutopilotSuggestions({ leads, jobs, metrics, value, category, label });
  const detailedLeads = [...leads]
    .sort((a, b) => {
      const rank = stageRank(b.stage) - stageRank(a.stage);
      if (rank !== 0) return rank;
      return Number(b.score || 0) - Number(a.score || 0);
    })
    .map(lead => ({
      ...lead,
      stageLabel: STAGE_LABELS[lead.stage] || lead.stage,
      job: jobs.find(job => job.leadId === lead.id) || null
    }));

  return {
    category,
    label,
    value,
    suggestions,
    leads: detailedLeads,
    jobs: [...jobs].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)),
    summary
  };
}

function stageRank(stage) {
  const order = ["paid", "scheduled", "won", "quoted", "contacted", "nurture", "contact-ready", "new", "queued"];
  const index = order.indexOf(stage);
  return index === -1 ? 0 : order.length - index;
}

export function buildAutopilotSuggestions({ leads = [], jobs = [], metrics = {}, value = {}, category, label } = {}) {
  const suggestions = [];
  const nurture = leads.filter(lead => lead.stage === "nurture");
  const quoted = leads.filter(lead => lead.stage === "quoted");
  const contactReady = leads.filter(lead => lead.stage === "contact-ready");
  const paidJobs = jobs.filter(job => job.status === "paid");
  const scheduledJobs = jobs.filter(job => job.status === "scheduled");
  const topNurture = [...nurture].sort((a, b) => b.score - a.score)[0];
  const topQuoted = [...quoted].sort((a, b) => b.quoteAmount - a.quoteAmount)[0];
  const topReady = [...contactReady].sort((a, b) => b.score - a.score)[0];

  if (nurture.length) {
    suggestions.push({
      id: "follow-nurture",
      priority: "high",
      title: `Call or text ${nurture.length} nurture lead${nurture.length === 1 ? "" : "s"}`,
      detail: topNurture
        ? `Start with ${topNurture.name} (score ${topNurture.score}) — ${topNurture.service} · ${formatMoney(topNurture.quoteAmount)} potential.`
        : "Warm leads need a day-2 follow-up before they go cold.",
      actionLabel: "Execute in CRM",
      actionType: "execute-crm",
      crmAction: "follow-nurture",
      leadId: topNurture?.id,
      leadName: topNurture?.name,
      assignee: "alex",
      targetStatus: "contacted",
      note: topNurture
        ? `Day-2 nurture follow-up for ${topNurture.name} (${topNurture.service}).`
        : "Day-2 nurture follow-up started from Autopilot ROI."
    });
  }

  if (quoted.length) {
    suggestions.push({
      id: "close-quotes",
      priority: "high",
      title: `Close ${quoted.length} open quote${quoted.length === 1 ? "" : "s"}`,
      detail: topQuoted
        ? `${topQuoted.name} has a ${formatMoney(topQuoted.quoteAmount)} draft sitting unanswered — send from the live tenant pricebook.`
        : "Quoted leads convert fastest with a same-day reminder.",
      actionLabel: "Send quote in CRM",
      actionType: "execute-crm",
      crmAction: "close-quotes",
      leadId: topQuoted?.id,
      leadName: topQuoted?.name,
      amount: topQuoted?.quoteAmount,
      serviceName: topQuoted?.service
    });
  }

  if (scheduledJobs.length) {
    suggestions.push({
      id: "confirm-jobs",
      priority: "medium",
      title: `Confirm ${scheduledJobs.length} scheduled job${scheduledJobs.length === 1 ? "" : "s"}`,
      detail: `${scheduledJobs[0].customer} · ${scheduledJobs[0].title} with ${scheduledJobs[0].assignee}. Confirm window and log arrival note in CRM.`,
      actionLabel: "Confirm in CRM",
      actionType: "execute-crm",
      crmAction: "confirm-jobs",
      jobId: scheduledJobs[0].id,
      leadId: scheduledJobs[0].leadId
    });
  }

  if (paidJobs.length) {
    suggestions.push({
      id: "import-crm",
      priority: "medium",
      title: "Import paid wins into Vendor Ops CRM",
      detail: `${paidJobs.length} paid job${paidJobs.length === 1 ? "" : "s"} · ${formatMoney(value.revenue)} captured. Persist them under your tenant so crews and invoices stay real.`,
      actionLabel: "Import to CRM",
      actionType: "execute-crm",
      crmAction: "import-crm",
      category
    });
  }

  if (contactReady.length && !quoted.length) {
    suggestions.push({
      id: "start-outreach",
      priority: "high",
      title: `Start outreach on ${contactReady.length} contact-ready lead${contactReady.length === 1 ? "" : "s"}`,
      detail: topReady
        ? `${topReady.name} is enriched (${topReady.phone}) — assign + note in CRM and mark contacted.`
        : "Contacts are verified; don’t leave them idle.",
      actionLabel: "Start outreach in CRM",
      actionType: "execute-crm",
      crmAction: "start-outreach",
      leadId: topReady?.id,
      leadName: topReady?.name,
      assignee: "alex",
      targetStatus: "contacted",
      note: topReady
        ? `Outreach started for ${topReady.name} — ${topReady.service}.`
        : "Outreach started from Autopilot ROI."
    });
  }

  if ((value.roiMultiple || 0) >= 20 || (value.conversionRate || 0) >= 30) {
    suggestions.push({
      id: "expand-cities",
      priority: "medium",
      title: `Scale ${label} hunt to more cities`,
      detail: `This cycle returned ~${value.roiMultiple || "—"}× on ~${formatMoney(value.spend)} API spend. Run real autopilot across more Georgia markets.`,
      actionLabel: "Run real autopilot",
      actionType: "execute-crm",
      crmAction: "expand-cities",
      category,
      cities: ["Atlanta", "Savannah", "Augusta", "Macon"]
    });
  } else {
    suggestions.push({
      id: "tune-category",
      priority: "low",
      title: "Try another category with the same playbook",
      detail: `Compare conversion on HVAC, cleaning, or plumbing using the same Georgia pilot cities.`,
      actionLabel: "Back to live sim",
      actionType: "back-live"
    });
  }

  suggestions.push({
    id: "public-booking",
    priority: "low",
    title: "Share the public booking page",
    detail: "Customers can self-book at /book/demo-landscape while you work the CRM queue.",
    actionLabel: "Open booking page",
    actionType: "open-booking",
    href: "/book/demo-landscape"
  });

  if ((metrics.outreach || 0) > 0 && nurture.length + quoted.length > 0) {
    const copyText = `Hi — we help ${label} accounts in your area with fast quotes and scheduled crews. Want an estimate this week?`;
    suggestions.push({
      id: "copy-script",
      priority: "low",
      title: "Use today’s outreach script",
      detail: `“Hi — we help ${label.toLowerCase()} accounts in your area with fast quotes and scheduled crews. Want a ${topQuoted?.service || topNurture?.service || "service"} estimate this week?”`,
      actionLabel: "Save script to CRM",
      actionType: "execute-crm",
      crmAction: "copy-script",
      leadId: topQuoted?.id || topNurture?.id,
      leadName: topQuoted?.name || topNurture?.name,
      copyText
    });
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  return suggestions.sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9));
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
