import crypto from "crypto";
import { categoryApiTools } from "../ai/toolCatalog.js";
import { runAutomation } from "./automationEngine.js";
import { getParcelAcreageByAddress } from "./regrid.js";
import { buildSmartDefaults, refineDefaultsFromMeasurements } from "./quoteAutomation.js";

const sessions = new Map();
const now = () => new Date().toISOString();
const money = value => Number(Number(value || 0).toFixed(2));
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;

const common = [
  { key:"customer", question:"Who is the customer?", type:"object", required:true, ask:false, example:{name:"Taylor Smith",email:"taylor@example.com",phone:"404-555-0199"}},
  { key:"serviceAddress", question:"What is the service address?", type:"string", required:true, ask:true, example:"123 Main St, Atlanta, GA 30303" },
  { key:"propertyType", question:"What type of property is this?", type:"select", options:["residential","commercial","hoa","multi-family","industrial"], required:true, ask:false },
  { key:"requestedDate", question:"When should the work be performed?", type:"date", required:false, ask:false, example:"2026-07-20" }
];

/** Square footage is filled from Regrid using the service address (not asked). */
const parcelAutoTriggers = {
  landscape: "mowable-area",
  hvac: "hvac-load-estimate",
  cleaning: "cleaning-property-profile",
  "pest-control": "pest-property-profile",
  painting: "paint-surface-area",
  roofing: "roof-area-estimate"
};

const flows = {
  landscape:{ label:"Landscape", description:"Lawn care, grounds maintenance, mowing, mulch, irrigation, and property outdoor service estimates.", questions:[...common,
    {key:"serviceType",question:"Which landscape service is needed?",type:"select",options:["mowing","cleanup","mulch","fertilization","full maintenance"],ask:false, required:true},
    {key:"crewSize",question:"How many crew members should be used?",type:"number",ask:false, required:true},
    {key:"estimatedHours",question:"How many work hours are expected?",type:"number",ask:false, required:true,trigger:"labor"},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",ask:false, required:true,trigger:"landscaping-estimate"}
  ]},
  hvac:{ label:"HVAC & Mechanical", description:"Heating, cooling, and mechanical system diagnostics, load estimates, replacements, and maintenance plans.", questions:[...common,
    {key:"systemType",question:"Which system needs service?",type:"select",options:["split system","heat pump","rooftop unit","boiler","chiller","air handler","other"],ask:false, required:true},
    {key:"serviceType",question:"What HVAC service is requested?",type:"select",options:["diagnostic","repair","maintenance","replacement","installation"],ask:false, required:true,trigger:"hvac-fault-detection"},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",ask:false, required:true},
    {key:"materialCost",question:"What is the estimated equipment and material cost?",type:"currency",ask:false, required:true,trigger:"hvac-replacement-estimate"}
  ]},
  cleaning:{ label:"Janitorial & Cleaning", description:"Recurring janitorial, deep cleans, move-in/out, post-construction, carpet, floor care, and window cleaning.", questions:[...common,
    {key:"serviceType",question:"Which cleaning service is needed?",type:"select",options:["recurring janitorial","deep clean","move-in/out","post-construction","carpet","floor care","windows"],ask:false, required:true},
    {key:"frequency",question:"How often should service occur?",type:"select",options:["one-time","daily","weekly","biweekly","monthly"],ask:false, required:true},
    {key:"crewSize",question:"How many cleaners should be assigned?",type:"number",ask:false, required:true},
    {key:"estimatedHours",question:"How many hours per visit are expected?",type:"number",ask:false, required:true},
    {key:"hourlyRate",question:"What hourly rate should be used?",type:"currency",ask:false, required:true,trigger:"cleaning-service-estimate"}
  ]},
  "pest-control":{ label:"Pest Control", description:"Inspections, treatments, termite bonds, rodent control, and recurring pest service planning.", questions:[...common,
    {key:"pestType",question:"Which pest is involved?",type:"select",options:["general insects","termites","rodents","bed bugs","mosquitoes","wildlife","other"],ask:false, required:true,trigger:"pest-risk-assessment"},
    {key:"serviceType",question:"Which treatment plan is requested?",type:"select",options:["inspection","one-time treatment","recurring service","termite bond","exclusion"],ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"materialCost",question:"What is the estimated treatment material cost?",type:"currency",ask:false, required:true,trigger:"pest-treatment-estimate"}
  ]},
  pool:{ label:"Pool Service", description:"Pool chemistry, equipment checks, openings/closings, repairs, and recurring pool maintenance.", questions:[...common,
    {key:"poolGallons",question:"What is the estimated pool volume in gallons?",type:"number",ask:false, required:true,trigger:"pool-water-chemistry"},
    {key:"serviceType",question:"Which pool service is needed?",type:"select",options:["weekly service","opening","closing","equipment repair","cleaning","chemical balancing"],ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"materialCost",question:"What chemical and parts cost is expected?",type:"currency",ask:false, required:true,trigger:"pool-service-estimate"}
  ]},
  painting:{ label:"Painting", description:"Interior and exterior painting, cabinets, surface area takeoffs, materials, and crew planning.", questions:[...common,
    {key:"serviceType",question:"Which painting service is needed?",type:"select",options:["interior","exterior","cabinets","touch-up","commercial coating"],ask:false, required:true},
    {key:"coats",question:"How many coats are required?",type:"number",ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"materialCost",question:"What is the estimated paint and materials cost?",type:"currency",ask:false, required:true,trigger:"paint-interior-estimate"}
  ]},
  roofing:{ label:"Roofing", description:"Roof inspections, repairs, replacements, storm damage assessments, and material calculations.", questions:[...common,
    {key:"serviceType",question:"Which roofing service is needed?",type:"select",options:["inspection","repair","replacement","storm damage","maintenance"],ask:false, required:true},
    {key:"roofMaterial",question:"What roofing material is involved?",type:"select",options:["asphalt shingle","metal","tile","flat membrane","wood shake","other"],ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"materialCost",question:"What is the estimated roofing material cost?",type:"currency",ask:false, required:true,trigger:"roof-replacement-estimate"}
  ]},
  plumbing:{ label:"Plumbing", description:"Leak and drain diagnostics, water heater work, repiping, sewer camera review, and emergency dispatch.", questions:[...common,
    {key:"serviceType",question:"Which plumbing service is needed?",type:"select",options:["leak repair","drain clearing","water heater","fixture installation","repiping","sewer","backflow"],ask:false, required:true,trigger:"plumbing-leak-diagnostic"},
    {key:"urgency",question:"How urgent is the request?",type:"select",options:["routine","same day","emergency"],ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",ask:false, required:true},
    {key:"materialCost",question:"What parts and materials cost is expected?",type:"currency",ask:false, required:true,trigger:"plumbing-repair-estimate"}
  ]},
  electrical:{ label:"Electrical", description:"Panel capacity, circuit diagnostics, EV chargers, generators, lighting upgrades, and electrical safety inspections.", questions:[...common,
    {key:"serviceType",question:"Which electrical service is needed?",type:"select",options:["diagnostic","panel upgrade","EV charger","generator","lighting","rewire","safety inspection"],ask:false, required:true,trigger:"electrical-circuit-diagnostic"},
    {key:"voltage",question:"What voltage applies?",type:"number",ask:false, required:false,example:240},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",ask:false, required:true},
    {key:"materialCost",question:"What equipment and materials cost is expected?",type:"currency",ask:false, required:true,trigger:"electrical-service-upgrade"}
  ]},
  "general-contract":{ label:"General Contracting", description:"Remodels, build-outs, project scopes, bids, critical-path scheduling, and closeout packages.", questions:[...common,
    {key:"projectType",question:"What type of project is planned?",type:"select",options:["remodel","addition","repair","build-out","new construction","restoration"],ask:false, required:true,trigger:"gc-scope-generator"},
    {key:"estimatedHours",question:"How many total labor hours are expected?",type:"number",ask:false, required:true},
    {key:"materialCost",question:"What material cost is expected?",type:"currency",ask:false, required:true},
    {key:"equipmentCost",question:"What equipment or rental cost is expected?",type:"currency",ask:false, required:false},
    {key:"markupMultiplier",question:"What pricing multiplier should be applied?",type:"number",ask:false, required:true,example:1.35,trigger:"gc-project-estimate"}
  ]},
  surveillance:{ label:"Surveillance", description:"Camera layouts, storage and bandwidth planning, installation estimates, and site security assessments.", questions:[...common,
    {key:"cameraCount",question:"How many cameras are required?",type:"number",ask:false, required:true,trigger:"camera-layout-design"},
    {key:"retentionDays",question:"How many days should video be retained?",type:"number",ask:false, required:true,trigger:"surveillance-storage-calculator"},
    {key:"serviceType",question:"Which surveillance service is requested?",type:"select",options:["new installation","upgrade","repair","site assessment","maintenance"],ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"materialCost",question:"What equipment and materials cost is expected?",type:"currency",ask:false, required:true,trigger:"surveillance-install-estimate"}
  ]},
  "trash-removal":{ label:"Trash Removal", description:"Junk hauling, dumpster rentals, volume estimates, disposal site matching, and waste compliance manifests.", questions:[...common,
    {key:"volumeCubicYards",question:"What is the estimated debris volume in cubic yards?",type:"number",ask:false, required:true,trigger:"trash-volume-estimate"},
    {key:"materialType",question:"What material will be removed?",type:"select",options:["household debris","construction debris","yard waste","appliances","furniture","mixed waste"],ask:false, required:true,trigger:"trash-material-classification"},
    {key:"serviceType",question:"Which removal service is needed?",type:"select",options:["single haul","dumpster rental","recurring pickup","property cleanout"],ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true},
    {key:"disposalCost",question:"What disposal or tipping fee is expected?",type:"currency",ask:false, required:true,trigger:"trash-haul-estimate"}
  ]},
  transportation:{ label:"Transportation", description:"Local moves, long-haul and delivery quoting, load planning, route optimization, fleet capacity, and dispatch.", questions:[...common,
    {key:"pickupAddress",question:"What is the pickup address?",type:"string",ask:true, required:true,trigger:"transport-property-profile"},
    {key:"dropoffAddress",question:"What is the dropoff or destination address?",type:"string",ask:true, required:true},
    {key:"serviceType",question:"Which transportation service is needed?",type:"select",options:["local move","long haul","same-day delivery","scheduled delivery","light freight","materials haul"],ask:false, required:true},
    {key:"distanceMiles",question:"What is the estimated trip distance in miles?",type:"number",ask:false, required:true},
    {key:"volumeCubicFeet",question:"What is the estimated load volume in cubic feet?",type:"number",ask:false, required:true,trigger:"transport-load-plan"},
    {key:"crewSize",question:"How many crew members should be used?",type:"number",ask:false, required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",ask:false, required:true,trigger:"transport-local-move-estimate"}
  ]},
  healthcare:{ label:"Nursing & Doctors", description:"Home health and clinical staffing for nursing and physician visits, care plans, credentials, shift coverage, and visit routing.", questions:[...common,
    {key:"careSetting",question:"Where will care be delivered?",type:"select",options:["home","assisted living","clinic","facility","telehealth hybrid"],ask:false, required:true,trigger:"healthcare-patient-profile"},
    {key:"serviceType",question:"Which clinical service is needed?",type:"select",options:["nursing visit","physician visit","private duty shift","post-acute follow-up","chronic care management","urgent home visit"],ask:false, required:true},
    {key:"acuityLevel",question:"What is the patient acuity level?",type:"select",options:["low","moderate","high","critical"],ask:false, required:true,trigger:"healthcare-risk-assessment"},
    {key:"role",question:"Which clinician role should be assigned?",type:"select",options:["RN","LPN","NP","physician","caregiver with RN oversight"],ask:false, required:true},
    {key:"visitMinutes",question:"How many minutes should the visit or shift block cover?",type:"number",ask:false, required:true},
    {key:"estimatedHours",question:"How many billable clinical hours are expected?",type:"number",ask:false, required:true,trigger:"healthcare-nursing-visit-estimate"}
  ]}
};

// Transportation uses pickup/dropoff; service address is auto-copied from pickup.
flows.transportation.questions = flows.transportation.questions.map(question => (
  question.key === "serviceAddress"
    ? { ...question, ask: false, required: false }
    : question
));

function defaultValueForQuestion(question) {
  if (question.type === "select") return question.options?.[0];
  if (question.type === "number" || question.type === "currency") return question.example ?? 1;
  if (question.type === "object") return question.example || { name: "Property Owner", email: "customer@example.com", phone: "404-555-0100" };
  if (question.type === "date") return new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  return question.example || "";
}

function applyAutomationDefaults(session, message = "") {
  const smart = buildSmartDefaults(session.category, message, session.businessSettings, session.answers);
  session.answers = refineDefaultsFromMeasurements(session.category, smart, session.businessSettings);
  if (session.category === "transportation" && session.answers.pickupAddress && !session.answers.serviceAddress) {
    session.answers.serviceAddress = session.answers.pickupAddress;
  }
  for (const question of session.questions) {
    if (session.answers[question.key] !== undefined) continue;
    if (question.ask === false) {
      session.answers[question.key] = defaultValueForQuestion(question);
    }
  }
  return session;
}

function runAnswerTriggers(session) {
  const ran = new Set(session.apiResults.map(item => `${item.questionKey}:${item.endpointType}`));
  for (const question of session.questions) {
    if (!question.trigger || session.answers[question.key] === undefined) continue;
    const stamp = `${question.key}:${question.trigger}`;
    if (ran.has(stamp)) continue;
    const result = runAutomation(question.trigger, buildAutomationInput(session));
    session.apiResults.push({ questionKey: question.key, endpointType: question.trigger, result, source: "auto-default" });
    ran.add(stamp);
  }
}

/** Only surface questions the user must answer; skip AI/auto-filled fields. */
function nextQuestion(session) {
  while (session.currentIndex < session.questions.length) {
    const question = session.questions[session.currentIndex];
    if (session.answers[question.key] !== undefined) {
      session.currentIndex += 1;
      continue;
    }
    if (question.ask === false) {
      session.answers[question.key] = defaultValueForQuestion(question);
      session.currentIndex += 1;
      continue;
    }
    return question;
  }
  return null;
}

function buildAutomationInput(session) {
  const a = session.answers;
  const b = session.businessSettings || {};
  const unitPrices = b.unitPrices || {};
  return {
    ...a,
    address:a.serviceAddress,
    customer:a.customer,
    serviceType:a.serviceType || a.projectType,
    crewSize:Number(a.crewSize||b.defaultCrewSize||1),
    estimatedHours:Number(a.estimatedHours||1),
    hourlyRate:Number(a.hourlyRate||unitPrices.hourlyRate||b.defaultHourlyRate||85),
    materialCost:Number(a.materialCost||unitPrices.materialCost||0),
    equipmentCost:Number(a.equipmentCost||unitPrices.equipmentCost||0),
    disposalCost:Number(a.disposalCost||unitPrices.disposalCost||0),
    squareFeet:Number(a.squareFeet||a.areaSquareFeet||2500),
    unitPrices
  };
}

function resultToLineItem(result, session) {
  const data = result.data || {};
  const type = result.type || "";
  const billableType = /estimate|pricing|service|replacement|installation|haul|coding-suggest/i.test(type);
  const nonBillable = /diagnostic|risk|profile|classification|layout|chemistry|health-score|pump-health|device-health|turf-health|symptom-triage|credentials-check|skill-match|care-plan|documentation-compliance/i.test(type);
  if (!billableType || nonBillable) return null;
  const amount = money(data.suggestedPrice ?? data.estimatedPrice ?? data.estimatedCost ?? 0);
  if (!amount) return null;
  return { description:`${session.label}: ${String(session.answers.serviceType || session.answers.projectType || result.type).replaceAll("-"," ")}`, quantity:1, unit:"service", unitPrice:amount, amount, sourceApi:result.type, sourceRequestId:result.requestId };
}

function categorySummary(category, flow) {
  return {
    category,
    label: flow.label,
    description: flow.description,
    namespace: `/api/v1/${category}`,
    endpoints: {
      start: `/api/v1/${category}/start`,
      quote: `/api/v1/${category}/quote`,
      sessions: `/api/v1/${category}/sessions/{sessionId}`,
      pricingStandards: `/api/v1/${category}/pricing-standards`,
      pricingRefresh: `/api/v1/${category}/pricing-standards/refresh`,
      invoiceLog: `/api/v1/${category}/invoices/log`,
      invoiceSuggest: `/api/v1/${category}/invoices/suggest`
    },
    pricingStandardsFile: `data/pricing-standards/${category}.json`,
    recommendedApis: categoryApiTools[category] || []
  };
}

export function listGuidedCategories() {
  return Object.entries(flows).map(([category, flow]) => ({
    category,
    label: flow.label,
    description: flow.description,
    startEndpoint: `/api/v1/${category}/start`
  }));
}

export function listCategories() {
  const categories = Object.entries(flows).map(([category, flow]) => categorySummary(category, flow));
  return { count: categories.length, categories };
}

export function getCategory(category) {
  const flow = flows[category];
  if (!flow) {
    const error = new Error(`Unsupported category: ${category}`);
    error.statusCode = 404;
    throw error;
  }
  return categorySummary(category, flow);
}

function squareFeetForCategory(category, parcel) {
  const lot = parcel.lotSquareFeet || parcel.squareFeet || null;
  const building = parcel.buildingSquareFeet || null;
  // Landscape/pest use lot area; building-centric trades prefer footprint/living area.
  if (["landscape", "pest-control"].includes(category)) return lot;
  if (["hvac", "cleaning", "painting", "roofing", "general-contract"].includes(category)) return building || lot;
  return lot || building;
}

async function enrichSessionFromRegrid(session) {
  const address = session.answers.serviceAddress || session.answers.pickupAddress;
  if (!address || session.answers.regridLookupAt) return session;

  try {
    const parcel = await getParcelAcreageByAddress(address);
    const squareFeet = squareFeetForCategory(session.category, parcel);
    session.answers.squareFeet = squareFeet;
    session.answers.acres = parcel.acreage;
    session.answers.lotSquareFeet = parcel.lotSquareFeet || parcel.squareFeet;
    session.answers.buildingSquareFeet = parcel.buildingSquareFeet;
    session.answers.parcelId = parcel.parcelId;
    session.answers.matchedAddress = parcel.matchedAddress;
    session.answers.regridMeasurementSource = parcel.measurementSource;
    session.answers.regridLookupAt = now();
    if (parcel.matchedAddress && session.answers.serviceAddress) {
      session.answers.serviceAddress = parcel.matchedAddress;
    }

    const trigger = parcelAutoTriggers[session.category];
    if (trigger && squareFeet != null) {
      const result = runAutomation(trigger, buildAutomationInput(session));
      session.apiResults.push({ questionKey: "squareFeet", endpointType: trigger, result, source: "regrid-auto" });
    }
  } catch (error) {
    session.answers.regridLookupAt = now();
    session.answers.regridError = error.message || "Regrid lookup failed";
    // Keep quote flowing even if parcel lookup misses.
    if (session.answers.squareFeet == null) {
      session.answers.squareFeet = null;
    }
  }
  session.updatedAt = now();
  return session;
}

export async function startGuidedWorkflow(category, input={}) {
  const flow=flows[category];
  if(!flow){ const e=new Error(`Unsupported category: ${category}`); e.statusCode=404; throw e; }
  const session={
    sessionId:uid("session"),
    category,
    label:flow.label,
    status:"in_progress",
    createdAt:now(),
    updatedAt:now(),
    currentIndex:0,
    questions:flow.questions.map(question => ({ ...question })),
    answers:{...(input.prefill||{})},
    apiResults:[],
    sourceMessage: String(input.message || input.prompt || ""),
    businessSettings:{...(input.businessSettings||{})},
    invoiceSettings:{taxRate:Number(input.taxRate||0),discount:Number(input.discount||0),currency:input.currency||"USD",paymentTerms:input.paymentTerms||"Due upon receipt"}
  };
  applyAutomationDefaults(session, session.sourceMessage);
  sessions.set(session.sessionId,session);
  if (session.answers.serviceAddress || session.answers.pickupAddress) {
    await enrichSessionFromRegrid(session);
    Object.assign(
      session.answers,
      refineDefaultsFromMeasurements(session.category, session.answers, session.businessSettings)
    );
  }
  runAnswerTriggers(session);
  if (!nextQuestion(session)) session.status = "ready_for_invoice";
  session.updatedAt = now();
  return sessionView(session);
}

export async function answerGuidedWorkflow(sessionId, input={}) {
  const session=sessions.get(sessionId); if(!session){ const e=new Error("Guided workflow session not found"); e.statusCode=404; throw e; }
  if(session.status==="completed") return sessionView(session);
  const q=nextQuestion(session); if(!q){ session.status="ready_for_invoice"; return sessionView(session); }
  const value=input.value ?? input.answer;
  if(q.required && (value===undefined || value===null || value==="")){ const e=new Error(`Answer is required for ${q.key}`); e.statusCode=400; throw e; }
  session.answers[q.key]=value;
  session.currentIndex++;

  // One freeform reply can also carry other missing ask fields (e.g. second address).
  if (input.message || typeof value === "string") {
    const merged = buildSmartDefaults(
      session.category,
      String(input.message || value || ""),
      session.businessSettings,
      session.answers
    );
    session.answers = merged;
  }

  if (q.key === "serviceAddress" || q.key === "pickupAddress" || q.key === "dropoffAddress") {
    delete session.answers.regridLookupAt;
    await enrichSessionFromRegrid(session);
    Object.assign(
      session.answers,
      refineDefaultsFromMeasurements(session.category, session.answers, session.businessSettings)
    );
  }
  if(q.trigger){ const result=runAutomation(q.trigger,buildAutomationInput(session)); session.apiResults.push({questionKey:q.key,endpointType:q.trigger,result}); }
  applyAutomationDefaults(session, session.sourceMessage || String(input.message || ""));
  runAnswerTriggers(session);
  session.updatedAt=now();
  if(!nextQuestion(session)) session.status="ready_for_invoice";
  return sessionView(session);
}

export function runGuidedStep(sessionId, input={}) {
  const session=sessions.get(sessionId); if(!session){ const e=new Error("Guided workflow session not found"); e.statusCode=404; throw e; }
  if(!input.endpointType){ const e=new Error("endpointType is required"); e.statusCode=400; throw e; }
  const result=runAutomation(input.endpointType,{...buildAutomationInput(session),...(input.payload||{})});
  session.apiResults.push({questionKey:null,endpointType:input.endpointType,result}); session.updatedAt=now();
  return {sessionId,apiResult:result,workflow:sessionView(session)};
}

export function createInvoiceFromSession(sessionId, overrides={}) {
  const session=sessions.get(sessionId); if(!session){ const e=new Error("Guided workflow session not found"); e.statusCode=404; throw e; }
  const input=buildAutomationInput(session);
  if(session.apiResults.length===0){
    const fallback={ landscape:"landscaping-estimate",hvac:"hvac-replacement-estimate",cleaning:"cleaning-service-estimate","pest-control":"pest-treatment-estimate",pool:"pool-service-estimate",painting:"paint-interior-estimate",roofing:"roof-replacement-estimate",plumbing:"plumbing-repair-estimate",electrical:"electrical-service-upgrade","general-contract":"gc-project-estimate",surveillance:"surveillance-install-estimate","trash-removal":"trash-haul-estimate",transportation:"transport-local-move-estimate",healthcare:"healthcare-nursing-visit-estimate" }[session.category];
    session.apiResults.push({questionKey:null,endpointType:fallback,result:runAutomation(fallback,input)});
  }
  let lineItems=session.apiResults.map(x=>resultToLineItem(x.result,session)).filter(Boolean);
  if(!lineItems.length){
    const labor=money(Number(input.estimatedHours||1)*Number(input.hourlyRate||85));
    lineItems=[{description:`${session.label} labor`,quantity:Number(input.estimatedHours||1),unit:"hour",unitPrice:Number(input.hourlyRate||85),amount:labor,sourceApi:"guided-fallback"}];
    if(Number(input.materialCost)>0) lineItems.push({description:"Materials and equipment",quantity:1,unit:"lot",unitPrice:Number(input.materialCost),amount:Number(input.materialCost),sourceApi:"guided-input"});
  }
  if(Array.isArray(overrides.additionalLineItems)) lineItems.push(...overrides.additionalLineItems);
  const subtotal=money(lineItems.reduce((s,x)=>s+Number(x.amount||0),0));
  const discount=money(overrides.discount ?? session.invoiceSettings.discount);
  const taxable=money(Math.max(0,subtotal-discount));
  const taxRate=Number(overrides.taxRate ?? session.invoiceSettings.taxRate);
  const tax=money(taxable*taxRate/100); const total=money(taxable+tax);
  const invoice={ invoiceId:uid("inv"),invoiceNumber:overrides.invoiceNumber||`HC-${Date.now()}`,status:"draft",createdAt:now(),currency:overrides.currency||session.invoiceSettings.currency,category:session.category,categoryLabel:session.label,customer:session.answers.customer,serviceAddress:session.answers.serviceAddress,serviceDate:session.answers.requestedDate||null,paymentTerms:overrides.paymentTerms||session.invoiceSettings.paymentTerms,lineItems,subtotal,discount,taxRate,tax,total,notes:overrides.notes||`Generated from HA-Corr guided ${session.label} workflow. Measurements and automated estimates must be field-verified before final approval.`,business:{name:session.businessSettings?.businessName||null,email:session.businessSettings?.email||null,phone:session.businessSettings?.phone||null,licenseNumber:session.businessSettings?.licenseNumber||null},workflow:{sessionId:session.sessionId,answers:session.answers,businessSettings:session.businessSettings,apiResults:session.apiResults.map(x=>({endpointType:x.endpointType,requestId:x.result.requestId,data:x.result.data,meta:x.result.meta}))} };
  session.status="completed"; session.invoice=invoice; session.updatedAt=now();
  return invoice;
}

export function getGuidedWorkflow(sessionId){ const s=sessions.get(sessionId); if(!s){const e=new Error("Guided workflow session not found");e.statusCode=404;throw e;} return sessionView(s); }

function sessionView(session){
  const question=nextQuestion(session);
  const askable = session.questions.filter(item => item.ask !== false);
  const askableAnswered = askable.filter(item => session.answers[item.key] !== undefined).length;
  return {
    sessionId:session.sessionId,
    category:session.category,
    categoryLabel:session.label,
    status:session.status,
    progress:{
      answered:Object.keys(session.answers).length,
      total:session.questions.length,
      currentIndex:session.currentIndex,
      askableTotal: askable.length,
      askableAnswered
    },
    nextQuestion:question?{key:question.key,question:question.question,type:question.type,required:question.required,ask:question.ask !== false,options:question.options,example:question.example}:null,
    answers:session.answers,
    autoFilled: session.questions.filter(item => item.ask === false && session.answers[item.key] !== undefined).map(item => item.key),
    businessSettings:session.businessSettings,
    apiResults:session.apiResults,
    invoice:session.invoice||null,
    links:{self:`/api/v1/${session.category}/sessions/${session.sessionId}`,answer:`/api/v1/${session.category}/sessions/${session.sessionId}/answer`,runApi:`/api/v1/${session.category}/sessions/${session.sessionId}/run-api`,invoice:`/api/v1/${session.category}/sessions/${session.sessionId}/invoice`}
  };
}


export async function createInstantQuote(category, input={}) {
  const answers = input.answers || {};
  const start = await startGuidedWorkflow(category, {
    taxRate: input.taxRate,
    discount: input.discount,
    currency: input.currency,
    paymentTerms: input.paymentTerms,
    businessSettings: input.businessSettings,
    message: input.message || input.prompt || "",
    prefill: answers
  });
  const session = sessions.get(start.sessionId);
  for (const question of session.questions) {
    if (session.answers[question.key] === undefined && question.required && question.ask !== false) {
      const error = new Error(`Missing required answer: ${question.key}`);
      error.statusCode = 400;
      throw error;
    }
    if (session.answers[question.key] === undefined && question.required) {
      session.answers[question.key] = defaultValueForQuestion(question);
    }
  }
  applyAutomationDefaults(session, input.message || input.prompt || "");
  runAnswerTriggers(session);
  session.currentIndex = session.questions.length;
  session.status = "ready_for_invoice";
  return createInvoiceFromSession(session.sessionId, {
    discount: input.discount,
    taxRate: input.taxRate,
    currency: input.currency,
    paymentTerms: input.paymentTerms,
    notes: input.notes,
    additionalLineItems: input.additionalLineItems
  });
}
