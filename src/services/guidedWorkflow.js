import crypto from "crypto";
import { runAutomation } from "./automationEngine.js";

const sessions = new Map();
const now = () => new Date().toISOString();
const money = value => Number(Number(value || 0).toFixed(2));
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;

const common = [
  { key:"customer", question:"Who is the customer?", type:"object", required:true, example:{name:"Taylor Smith",email:"taylor@example.com",phone:"404-555-0199"}},
  { key:"serviceAddress", question:"What is the service address?", type:"string", required:true, example:"123 Main St, Atlanta, GA 30303" },
  { key:"propertyType", question:"What type of property is this?", type:"select", options:["residential","commercial","hoa","multi-family","industrial"], required:true },
  { key:"requestedDate", question:"When should the work be performed?", type:"date", required:false, example:"2026-07-20" }
];

const flows = {
  landscape:{ label:"Landscape", questions:[...common,
    {key:"squareFeet",question:"What is the estimated service area in square feet?",type:"number",required:true,trigger:"mowable-area"},
    {key:"serviceType",question:"Which landscape service is needed?",type:"select",options:["mowing","cleanup","mulch","fertilization","full maintenance"],required:true},
    {key:"crewSize",question:"How many crew members should be used?",type:"number",required:true},
    {key:"estimatedHours",question:"How many work hours are expected?",type:"number",required:true,trigger:"labor"},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",required:true,trigger:"landscaping-estimate"}
  ]},
  hvac:{ label:"HVAC & Mechanical", questions:[...common,
    {key:"squareFeet",question:"What is the conditioned building square footage?",type:"number",required:true,trigger:"hvac-load-estimate"},
    {key:"systemType",question:"Which system needs service?",type:"select",options:["split system","heat pump","rooftop unit","boiler","chiller","air handler","other"],required:true},
    {key:"serviceType",question:"What HVAC service is requested?",type:"select",options:["diagnostic","repair","maintenance","replacement","installation"],required:true,trigger:"hvac-fault-detection"},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",required:true},
    {key:"materialCost",question:"What is the estimated equipment and material cost?",type:"currency",required:true,trigger:"hvac-replacement-estimate"}
  ]},
  cleaning:{ label:"Janitorial & Cleaning", questions:[...common,
    {key:"squareFeet",question:"How many square feet must be cleaned?",type:"number",required:true,trigger:"cleaning-property-profile"},
    {key:"serviceType",question:"Which cleaning service is needed?",type:"select",options:["recurring janitorial","deep clean","move-in/out","post-construction","carpet","floor care","windows"],required:true},
    {key:"frequency",question:"How often should service occur?",type:"select",options:["one-time","daily","weekly","biweekly","monthly"],required:true},
    {key:"crewSize",question:"How many cleaners should be assigned?",type:"number",required:true},
    {key:"estimatedHours",question:"How many hours per visit are expected?",type:"number",required:true},
    {key:"hourlyRate",question:"What hourly rate should be used?",type:"currency",required:true,trigger:"cleaning-service-estimate"}
  ]},
  "pest-control":{ label:"Pest Control", questions:[...common,
    {key:"squareFeet",question:"What is the treatment area square footage?",type:"number",required:true,trigger:"pest-property-profile"},
    {key:"pestType",question:"Which pest is involved?",type:"select",options:["general insects","termites","rodents","bed bugs","mosquitoes","wildlife","other"],required:true,trigger:"pest-risk-assessment"},
    {key:"serviceType",question:"Which treatment plan is requested?",type:"select",options:["inspection","one-time treatment","recurring service","termite bond","exclusion"],required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"materialCost",question:"What is the estimated treatment material cost?",type:"currency",required:true,trigger:"pest-treatment-estimate"}
  ]},
  pool:{ label:"Pool Service", questions:[...common,
    {key:"poolGallons",question:"What is the estimated pool volume in gallons?",type:"number",required:true,trigger:"pool-water-chemistry"},
    {key:"serviceType",question:"Which pool service is needed?",type:"select",options:["weekly service","opening","closing","equipment repair","cleaning","chemical balancing"],required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"materialCost",question:"What chemical and parts cost is expected?",type:"currency",required:true,trigger:"pool-service-estimate"}
  ]},
  painting:{ label:"Painting", questions:[...common,
    {key:"squareFeet",question:"What surface area will be painted?",type:"number",required:true,trigger:"paint-surface-area"},
    {key:"serviceType",question:"Which painting service is needed?",type:"select",options:["interior","exterior","cabinets","touch-up","commercial coating"],required:true},
    {key:"coats",question:"How many coats are required?",type:"number",required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"materialCost",question:"What is the estimated paint and materials cost?",type:"currency",required:true,trigger:"paint-interior-estimate"}
  ]},
  roofing:{ label:"Roofing", questions:[...common,
    {key:"squareFeet",question:"What is the roof footprint square footage?",type:"number",required:true,trigger:"roof-area-estimate"},
    {key:"serviceType",question:"Which roofing service is needed?",type:"select",options:["inspection","repair","replacement","storm damage","maintenance"],required:true},
    {key:"roofMaterial",question:"What roofing material is involved?",type:"select",options:["asphalt shingle","metal","tile","flat membrane","wood shake","other"],required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"materialCost",question:"What is the estimated roofing material cost?",type:"currency",required:true,trigger:"roof-replacement-estimate"}
  ]},
  plumbing:{ label:"Plumbing", questions:[...common,
    {key:"serviceType",question:"Which plumbing service is needed?",type:"select",options:["leak repair","drain clearing","water heater","fixture installation","repiping","sewer","backflow"],required:true,trigger:"plumbing-leak-diagnostic"},
    {key:"urgency",question:"How urgent is the request?",type:"select",options:["routine","same day","emergency"],required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",required:true},
    {key:"materialCost",question:"What parts and materials cost is expected?",type:"currency",required:true,trigger:"plumbing-repair-estimate"}
  ]},
  electrical:{ label:"Electrical", questions:[...common,
    {key:"serviceType",question:"Which electrical service is needed?",type:"select",options:["diagnostic","panel upgrade","EV charger","generator","lighting","rewire","safety inspection"],required:true,trigger:"electrical-circuit-diagnostic"},
    {key:"voltage",question:"What voltage applies?",type:"number",required:false,example:240},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"hourlyRate",question:"What hourly labor rate should be applied?",type:"currency",required:true},
    {key:"materialCost",question:"What equipment and materials cost is expected?",type:"currency",required:true,trigger:"electrical-service-upgrade"}
  ]},
  "general-contract":{ label:"General Contracting", questions:[...common,
    {key:"projectType",question:"What type of project is planned?",type:"select",options:["remodel","addition","repair","build-out","new construction","restoration"],required:true,trigger:"gc-scope-generator"},
    {key:"squareFeet",question:"What is the project square footage?",type:"number",required:true},
    {key:"estimatedHours",question:"How many total labor hours are expected?",type:"number",required:true},
    {key:"materialCost",question:"What material cost is expected?",type:"currency",required:true},
    {key:"equipmentCost",question:"What equipment or rental cost is expected?",type:"currency",required:false},
    {key:"markupMultiplier",question:"What pricing multiplier should be applied?",type:"number",required:true,example:1.35,trigger:"gc-project-estimate"}
  ]},
  surveillance:{ label:"Surveillance", questions:[...common,
    {key:"cameraCount",question:"How many cameras are required?",type:"number",required:true,trigger:"camera-layout-design"},
    {key:"retentionDays",question:"How many days should video be retained?",type:"number",required:true,trigger:"surveillance-storage-calculator"},
    {key:"serviceType",question:"Which surveillance service is requested?",type:"select",options:["new installation","upgrade","repair","site assessment","maintenance"],required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"materialCost",question:"What equipment and materials cost is expected?",type:"currency",required:true,trigger:"surveillance-install-estimate"}
  ]},
  "trash-removal":{ label:"Trash Removal", questions:[...common,
    {key:"volumeCubicYards",question:"What is the estimated debris volume in cubic yards?",type:"number",required:true,trigger:"trash-volume-estimate"},
    {key:"materialType",question:"What material will be removed?",type:"select",options:["household debris","construction debris","yard waste","appliances","furniture","mixed waste"],required:true,trigger:"trash-material-classification"},
    {key:"serviceType",question:"Which removal service is needed?",type:"select",options:["single haul","dumpster rental","recurring pickup","property cleanout"],required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true},
    {key:"disposalCost",question:"What disposal or tipping fee is expected?",type:"currency",required:true,trigger:"trash-haul-estimate"}
  ]},
  transportation:{ label:"Transportation", questions:[...common,
    {key:"pickupAddress",question:"What is the pickup address?",type:"string",required:true,trigger:"transport-property-profile"},
    {key:"dropoffAddress",question:"What is the dropoff or destination address?",type:"string",required:true},
    {key:"serviceType",question:"Which transportation service is needed?",type:"select",options:["local move","long haul","same-day delivery","scheduled delivery","light freight","materials haul"],required:true},
    {key:"distanceMiles",question:"What is the estimated trip distance in miles?",type:"number",required:true},
    {key:"volumeCubicFeet",question:"What is the estimated load volume in cubic feet?",type:"number",required:true,trigger:"transport-load-plan"},
    {key:"crewSize",question:"How many crew members should be used?",type:"number",required:true},
    {key:"estimatedHours",question:"How many labor hours are expected?",type:"number",required:true,trigger:"transport-local-move-estimate"}
  ]}
};

function nextQuestion(session) {
  while (session.currentIndex < session.questions.length && session.answers[session.questions[session.currentIndex].key] !== undefined) session.currentIndex++;
  return session.questions[session.currentIndex] || null;
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
  const billableType = /estimate|pricing|service|replacement|installation|haul/i.test(result.type || "");
  if (!billableType || /diagnostic|risk|profile|classification|health|layout|chemistry/i.test(result.type || "")) return null;
  const amount = money(data.suggestedPrice ?? data.estimatedPrice ?? data.estimatedCost ?? 0);
  if (!amount) return null;
  return { description:`${session.label}: ${String(session.answers.serviceType || session.answers.projectType || result.type).replaceAll("-"," ")}`, quantity:1, unit:"service", unitPrice:amount, amount, sourceApi:result.type, sourceRequestId:result.requestId };
}

export function listGuidedCategories() {
  return Object.entries(flows).map(([category,flow])=>({ category,label:flow.label,startEndpoint:`/api/v1/${category}/start` }));
}

export function startGuidedWorkflow(category, input={}) {
  const flow=flows[category];
  if(!flow){ const e=new Error(`Unsupported category: ${category}`); e.statusCode=404; throw e; }
  const session={ sessionId:uid("session"), category,label:flow.label,status:"in_progress",createdAt:now(),updatedAt:now(),currentIndex:0,questions:flow.questions,answers:{...(input.prefill||{})},apiResults:[],businessSettings:{...(input.businessSettings||{})},invoiceSettings:{taxRate:Number(input.taxRate||0),discount:Number(input.discount||0),currency:input.currency||"USD",paymentTerms:input.paymentTerms||"Due upon receipt"} };
  sessions.set(session.sessionId,session);
  return sessionView(session);
}

export function answerGuidedWorkflow(sessionId, input={}) {
  const session=sessions.get(sessionId); if(!session){ const e=new Error("Guided workflow session not found"); e.statusCode=404; throw e; }
  if(session.status==="completed") return sessionView(session);
  const q=nextQuestion(session); if(!q){ session.status="ready_for_invoice"; return sessionView(session); }
  const value=input.value ?? input.answer;
  if(q.required && (value===undefined || value===null || value==="")){ const e=new Error(`Answer is required for ${q.key}`); e.statusCode=400; throw e; }
  session.answers[q.key]=value;
  session.currentIndex++;
  if(q.trigger){ const result=runAutomation(q.trigger,buildAutomationInput(session)); session.apiResults.push({questionKey:q.key,endpointType:q.trigger,result}); }
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
    const fallback={ landscape:"landscaping-estimate",hvac:"hvac-replacement-estimate",cleaning:"cleaning-service-estimate","pest-control":"pest-treatment-estimate",pool:"pool-service-estimate",painting:"paint-interior-estimate",roofing:"roof-replacement-estimate",plumbing:"plumbing-repair-estimate",electrical:"electrical-service-upgrade","general-contract":"gc-project-estimate",surveillance:"surveillance-install-estimate","trash-removal":"trash-haul-estimate",transportation:"transport-local-move-estimate" }[session.category];
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
  return {sessionId:session.sessionId,category:session.category,categoryLabel:session.label,status:session.status,progress:{answered:Object.keys(session.answers).length,total:session.questions.length,currentIndex:session.currentIndex},nextQuestion:question?{key:question.key,question:question.question,type:question.type,required:question.required,options:question.options,example:question.example}:null,answers:session.answers,businessSettings:session.businessSettings,apiResults:session.apiResults,invoice:session.invoice||null,links:{self:`/api/v1/${session.category}/sessions/${session.sessionId}`,answer:`/api/v1/${session.category}/sessions/${session.sessionId}/answer`,runApi:`/api/v1/${session.category}/sessions/${session.sessionId}/run-api`,invoice:`/api/v1/${session.category}/sessions/${session.sessionId}/invoice`}};
}


export function createInstantQuote(category, input={}) {
  const answers = input.answers || {};
  const start = startGuidedWorkflow(category, {
    taxRate: input.taxRate,
    discount: input.discount,
    currency: input.currency,
    paymentTerms: input.paymentTerms,
    businessSettings: input.businessSettings,
    prefill: answers
  });
  const session = sessions.get(start.sessionId);
  for (const question of session.questions) {
    if (session.answers[question.key] === undefined && question.required) {
      const error = new Error(`Missing required answer: ${question.key}`);
      error.statusCode = 400;
      throw error;
    }
    if (session.answers[question.key] !== undefined && question.trigger) {
      const result = runAutomation(question.trigger, buildAutomationInput(session));
      session.apiResults.push({ questionKey: question.key, endpointType: question.trigger, result });
    }
  }
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
