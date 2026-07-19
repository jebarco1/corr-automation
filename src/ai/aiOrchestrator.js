import OpenAI from "openai";
import { appConfig } from "../config/appConfig.js";
import { categoryApiTools, supportedCategories } from "./toolCatalog.js";
import { answerGuidedWorkflow, createInvoiceFromSession, getGuidedWorkflow, runGuidedStep, startGuidedWorkflow } from "../services/guidedWorkflow.js";
import { getPricingStandards } from "../services/pricingStandards.js";
import {
  buildSmartDefaults,
  extractAddress,
  extractAddresses,
  parseCustomerFromText
} from "../services/quoteAutomation.js";
import { continueInterview, getInterview, selectServiceFromMessage, startServiceOffer } from "../services/quoteInterview.js";
import { listServices } from "../services/serviceCatalog.js";

const client = appConfig.ai.enabled ? new OpenAI({ apiKey: appConfig.ai.apiKey, baseURL: appConfig.ai.baseURL }) : null;

const categoryLabels = {
  landscape: "Landscape",
  hvac: "HVAC & Mechanical",
  cleaning: "Cleaning",
  "pest-control": "Pest Control",
  pool: "Pool",
  painting: "Painting",
  roofing: "Roofing",
  plumbing: "Plumbing",
  electrical: "Electrical",
  "general-contract": "General Contract",
  surveillance: "Surveillance",
  "trash-removal": "Trash Removal",
  transportation: "Transportation",
  healthcare: "Nursing & Doctors",
  "bakery-food": "Bakery & Food Services",
  "law-office": "Law Office"
};

const categoryWords = {
  landscape:["lawn","landscape","mowing","mulch","yard"], hvac:["hvac","air conditioner","ac ","heat pump","furnace","boiler","chiller"],
  cleaning:["cleaning","janitorial","carpet","deep clean"], "pest-control":["pest","termite","rodent","bug","mosquito"],
  pool:["pool","chlorine","ph","spa"], painting:["paint","painting","coats"], roofing:["roof","shingle","gutter"],
  plumbing:["plumb","leak","drain","water heater","sewer"], electrical:["electric","panel","circuit","outlet","generator","ev charger"],
  "general-contract":["remodel","construction","contractor","build-out"], surveillance:["camera","surveillance","security system","nvr"],
  "trash-removal":["trash","junk","dumpster","debris","haul"],
  transportation:["transport","moving","local move","long haul","delivery","freight","pickup","dropoff","relocate","truckload","courier"," move","mover","apartment move","house move"],
  healthcare:["nurse","nursing","rn ","lpn","doctor","physician","home health","home visit","patient","clinical","medical staffing","hospice","care plan"],
  "bakery-food":["bakery","cake","cupcake","pastry","catering tray","dessert table","wholesale bread","cookie box","gluten-free bake","food service catering"],
  "law-office":["lawyer","attorney","law office","legal consult","contract review","retainer","court appearance","estate planning","trademark filing","demand letter"]
};

function inferCategoryLocally(message="") {
  const text = ` ${message.toLowerCase()} `;
  for (const [category, words] of Object.entries(categoryWords)) if (words.some(word => text.includes(word))) return category;
  return null;
}

async function inferCategoryWithAI(message) {
  if (!client) return inferCategoryLocally(message);
  try {
    const response = await client.responses.create({
      model: appConfig.ai.model,
      instructions: "Classify a field-service request into exactly one HA-Corr category. Use the choose_category tool. Prefer the closest trade. Do not ask clarifying questions.",
      input: message,
      tools: [{
        type:"function", name:"choose_category", description:"Choose the correct service category.", strict:true,
        parameters:{ type:"object", properties:{ category:{type:"string",enum:supportedCategories}, reason:{type:"string"} }, required:["category","reason"], additionalProperties:false }
      }],
      tool_choice:{type:"function",name:"choose_category"}
    });
    const call = response.output?.find(item => item.type === "function_call" && item.name === "choose_category");
    return call ? JSON.parse(call.arguments).category : inferCategoryLocally(message);
  } catch (error) {
    console.warn("OpenAI category inference failed; using local keyword fallback:", error.message);
    return inferCategoryLocally(message);
  }
}

function pricingSnapshot(category) {
  if (!category) return null;
  try {
    const standards = getPricingStandards(category);
    const atlanta = standards.areas?.["Atlanta, GA"]?.unitPrices || standards.defaults?.unitPrices || {};
    return {
      category,
      label: categoryLabels[category] || category,
      market: "Atlanta, GA",
      version: standards.version,
      unitPrices: atlanta,
      recommendedApis: categoryApiTools[category] || []
    };
  } catch {
    return null;
  }
}

function invalidAnswer(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function looksLikeGenerateCommand(message = "") {
  return /^(yes|y|ok|okay|sure|generate|create|invoice|quote|done|build it|make (the )?quote|make (the )?invoice)\b/i.test(String(message).trim());
}

function shouldAutoGenerate(input = {}) {
  return input.autoGenerate !== false;
}

function formatQuestionPrompt(question) {
  if (!question) return "Draft invoice is ready to generate.";
  const lines = [question.question];
  if (question.key?.includes("Address") || question.key === "serviceAddress") {
    lines.push("Paste a full street address (example: 123 Main St, Atlanta, GA 30303). Everything else is auto-filled.");
  } else if (question.type === "select" && question.options?.length) {
    lines.push(`Options: ${question.options.join(", ")}`);
  } else if (question.example != null && question.type !== "object") {
    lines.push(`Example: ${typeof question.example === "object" ? JSON.stringify(question.example) : question.example}`);
  }
  return lines.join("\n");
}

function parseAnswerForQuestion(question, message) {
  const text = String(message || "").trim();
  if (!question) return text;

  if (question.type === "object" || question.key === "customer") {
    return parseCustomerFromText(text);
  }

  if (question.type === "select") {
    const options = question.options || [];
    const lower = text.toLowerCase();
    const numbered = lower.match(/^(\d+)\b/);
    if (numbered) {
      const index = Number(numbered[1]) - 1;
      if (options[index]) return options[index];
    }
    const exact = options.find(option => String(option).toLowerCase() === lower);
    if (exact) return exact;
    const partial = options.find(option => lower.includes(String(option).toLowerCase()) || String(option).toLowerCase().includes(lower));
    if (partial) return partial;
    throw invalidAnswer(`Please choose one of: ${options.join(", ")}`);
  }

  if (question.type === "number" || question.type === "currency") {
    const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (match) return Number(match[0]);
    throw invalidAnswer(`Please reply with a number${question.example != null ? ` (example: ${question.example})` : ""}.`);
  }

  if (question.type === "date") {
    const iso = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (iso) return iso;
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed) && /[0-9]/.test(text)) return new Date(parsed).toISOString().slice(0, 10);
    throw invalidAnswer("Please reply with a date like 2026-07-25.");
  }

  if (question.key === "serviceAddress" || question.key === "pickupAddress" || question.key === "dropoffAddress") {
    return extractAddress(text) || text;
  }

  return text;
}

function buildPrefillFromMessage(message, category, businessSettings = {}) {
  return buildSmartDefaults(category, message, businessSettings, {});
}

function matchCategoryFromMessage(message = "") {
  const text = message.toLowerCase().trim();
  for (const category of supportedCategories) {
    const label = (categoryLabels[category] || category).toLowerCase();
    if (text === category || text === label || text.includes(category) || text.includes(label)) return category;
  }
  return inferCategoryLocally(message);
}

function assistantEnvelope(partial) {
  return {
    provider: appConfig.ai.enabled ? "openai" : "local-fallback",
    model: appConfig.ai.enabled ? appConfig.ai.model : null,
    generatedAt: new Date().toISOString(),
    ...partial
  };
}

function automationNotes(workflow) {
  const notes = [];
  if (workflow.answers?.squareFeet != null) {
    notes.push(`Regrid auto-filled **${Number(workflow.answers.squareFeet).toLocaleString()} sqft** (${workflow.answers.acres ?? "?"} acres).`);
  } else if (workflow.answers?.regridError) {
    notes.push(`Parcel lookup note: ${workflow.answers.regridError}.`);
  }
  if (workflow.answers?.serviceType) notes.push(`Service assumed: **${workflow.answers.serviceType}**.`);
  if (workflow.answers?.hourlyRate != null) notes.push(`Labor rate: **$${workflow.answers.hourlyRate}/hr**.`);
  if (workflow.autoFilled?.length) notes.push(`Auto-filled ${workflow.autoFilled.length} fields (crew, hours, materials, etc.).`);
  return notes;
}

function invoiceReply(invoice, workflow) {
  const address = workflow?.answers?.matchedAddress || workflow?.answers?.serviceAddress || workflow?.answers?.pickupAddress || "";
  return [
    `Draft quote **${invoice.invoiceNumber}** is ready for **$${Number(invoice.total).toFixed(2)}** ${invoice.currency}.`,
    address ? `Job site: ${address}.` : null,
    "Review line items in the side panel — edit assumptions anytime and regenerate."
  ].filter(Boolean).join(" ");
}

function maybeCreateInvoice(sessionId, input = {}) {
  if (!shouldAutoGenerate(input)) return null;
  return createInvoiceFromSession(sessionId, input.invoice || input.start || {});
}

function questionResponse({ workflow, intro, mode = "quote-chat", invoice = null }) {
  const pricing = pricingSnapshot(workflow.category);
  const nextQuestion = workflow.nextQuestion;
  const ready = !nextQuestion;
  const reply = [
    intro,
    "",
    invoice ? null : formatQuestionPrompt(nextQuestion)
  ].filter(Boolean).join("\n").trim();

  return assistantEnvelope({
    mode,
    reply: invoice ? invoiceReply(invoice, workflow) : reply,
    category: workflow.category,
    categoryLabel: workflow.categoryLabel || categoryLabels[workflow.category],
    workflow,
    nextQuestion: invoice ? null : nextQuestion,
    invoice,
    result: invoice || undefined,
    suggestedActions: invoice || ready ? ["generate-invoice"] : ["answer-question"],
    pricing,
    recommendedApis: pricing?.recommendedApis || categoryApiTools[workflow.category] || []
  });
}

async function finishIfReady(sessionId, workflow, intro, input = {}, mode = "quote-chat") {
  if (workflow.nextQuestion) {
    return questionResponse({ workflow, intro, mode });
  }
  const invoice = maybeCreateInvoice(sessionId, input);
  if (!invoice) {
    return questionResponse({
      workflow,
      intro: `${intro} I have everything needed — reply **generate** to create the draft invoice.`
    });
  }
  const fresh = getGuidedWorkflow(sessionId);
  return questionResponse({
    workflow: fresh,
    intro,
    mode,
    invoice
  });
}

export async function startAIWorkflow(input={}) {
  const message = String(input.message || "").trim();
  const category = input.category || await inferCategoryWithAI(message);
  if (!category || !supportedCategories.includes(category)) {
    const error = new Error("The AI could not determine a supported category. Select a category or provide more service details.");
    error.statusCode = 400; throw error;
  }
  const start = { ...(input.start || {}), message };
  const autoPrefill = buildPrefillFromMessage(message, category, start.businessSettings || {});
  start.prefill = { ...(start.prefill || {}), ...autoPrefill };
  const workflow = await startGuidedWorkflow(category, start);
  const sqftNote = workflow.answers?.squareFeet
    ? ` Regrid measured about ${Number(workflow.answers.squareFeet).toLocaleString()} sqft from the address.`
    : "";

  let invoice = null;
  if (!workflow.nextQuestion && shouldAutoGenerate(input)) {
    invoice = createInvoiceFromSession(workflow.sessionId, input.invoice || start);
  }
  const fresh = invoice ? getGuidedWorkflow(workflow.sessionId) : workflow;

  return {
    mode: appConfig.ai.enabled ? "openai" : "local-fallback",
    category,
    assistantMessage: invoice
      ? invoiceReply(invoice, fresh)
      : `I selected ${fresh.categoryLabel}.${sqftNote} ${fresh.nextQuestion?.question || "Ready for invoice."}`,
    recommendedApis: categoryApiTools[category] || [],
    workflow: fresh,
    invoice,
    result: invoice || undefined
  };
}

export async function continueAIWorkflow(input={}) {
  const { sessionId, message, value, action="answer", endpointType, payload } = input;
  if (!sessionId) { const e=new Error("sessionId is required");e.statusCode=400;throw e; }
  let result;
  if (action === "run-api") result = runGuidedStep(sessionId,{endpointType,payload});
  else if (action === "invoice") result = createInvoiceFromSession(sessionId,input.invoice || {});
  else {
    const workflow = getGuidedWorkflow(sessionId);
    let parsedValue = value;
    if (parsedValue === undefined) {
      const question = workflow.nextQuestion;
      if (!question) {
        if (shouldAutoGenerate(input) || looksLikeGenerateCommand(message)) {
          const invoice = createInvoiceFromSession(sessionId, input.invoice || {});
          return {
            assistantMessage: invoiceReply(invoice, getGuidedWorkflow(sessionId)),
            result: invoice,
            workflow: getGuidedWorkflow(sessionId),
            invoice
          };
        }
        return {assistantMessage:"All questions are complete. You can generate the invoice.",workflow};
      }
      parsedValue = parseAnswerForQuestion(question, message);
    }
    result = await answerGuidedWorkflow(sessionId,{ value:parsedValue, message });
  }
  let workflow = result.workflow || (result.invoiceId ? getGuidedWorkflow(sessionId) : result);

  if (!result.invoiceId && !workflow.nextQuestion && shouldAutoGenerate(input)) {
    const invoice = createInvoiceFromSession(sessionId, input.invoice || {});
    workflow = getGuidedWorkflow(sessionId);
    return {
      assistantMessage: invoiceReply(invoice, workflow),
      result: invoice,
      workflow,
      invoice
    };
  }

  return {
    assistantMessage: result.invoiceId
      ? invoiceReply(result, workflow)
      : (workflow.nextQuestion?.question || "All required information is collected. Generate the invoice when ready."),
    result,
    workflow,
    invoice: result.invoiceId ? result : undefined
  };
}

function interviewEnvelope(result, input = {}) {
  const category = result.category;
  const workflow = result.workflow || null;
  const pricing = pricingSnapshot(category);
  // Chat continues against the interview id so stage (services → address → quote) is preserved.
  const sessionWorkflow = workflow
    ? { ...workflow, sessionId: result.sessionId || result.interviewId, interviewStage: result.stage }
    : {
      sessionId: result.sessionId || result.interviewId,
      category,
      categoryLabel: result.categoryLabel,
      status: result.stage,
      progress: {
        answered: result.selectedService ? 1 : 0,
        total: 3,
        askableTotal: 3,
        askableAnswered: [result.selectedService, result.parcel, !workflow?.nextQuestion].filter(Boolean).length
      },
      nextQuestion: result.nextQuestion || (result.awaitingService
        ? { key: "serviceId", question: "Which service do you need?", type: "select", options: (result.offeredServices || []).map(s => s.name), required: true, ask: true }
        : result.awaitingAddress
          ? { key: "serviceAddress", question: "What is the service address?", type: "string", required: true, ask: true, example: "123 Main St, Atlanta, GA 30303" }
          : null),
      answers: {
        ...(result.selectedService ? { serviceId: result.selectedService.id, serviceType: result.selectedService.quoteKey || result.selectedService.name } : {}),
        ...(result.parcel || {})
      },
      autoFilled: [],
      apiResults: [],
      invoice: result.invoice || null
    };

  return assistantEnvelope({
    mode: appConfig.ai.enabled ? "openai-quote-chat" : "quote-chat",
    reply: result.reply,
    category,
    categoryLabel: result.categoryLabel || categoryLabels[category],
    stage: result.stage,
    offeredServices: result.offeredServices || [],
    selectedService: result.selectedService || null,
    parcel: result.parcel || null,
    workflow: sessionWorkflow,
    nextQuestion: sessionWorkflow.nextQuestion,
    invoice: result.invoice || null,
    result: result.invoice || result.result || undefined,
    suggestedActions: result.suggestedActions || [],
    awaitingService: !!result.awaitingService,
    awaitingAddress: !!result.awaitingAddress,
    awaitingCategory: !!result.awaitingCategory,
    pricing,
    recommendedApis: result.selectedService?.relatedApis || pricing?.recommendedApis || categoryApiTools[category] || [],
    serviceCatalogFile: category ? `data/service-catalog/${category}.json` : null
  });
}

/**
 * Homepage chatbot staged flow:
 * 1) Category (passed from UI or inferred)
 * 2) Offer services from data/service-catalog/{category}.json
 * 3) Pull parcel information from address (Regrid)
 * 4) Ask remaining questions / generate quote
 */
export async function chatWithAssistant(input = {}) {
  const message = String(input.message || "").trim();
  if (!message) {
    const error = new Error("message is required");
    error.statusCode = 400;
    throw error;
  }

  if (input.sessionId) {
    if (getInterview(input.sessionId)) {
      const continued = await continueInterview(input.sessionId, message, input);
      return interviewEnvelope(continued, input);
    }
    // Legacy guided-only sessions still work.
    try {
      const workflow = getGuidedWorkflow(input.sessionId);
      if (!workflow.nextQuestion && (looksLikeGenerateCommand(message) || input.action === "invoice" || shouldAutoGenerate(input))) {
        const invoice = createInvoiceFromSession(input.sessionId, input.invoice || input.start || {});
        const fresh = getGuidedWorkflow(input.sessionId);
        return assistantEnvelope({
          mode: "quote-chat",
          reply: invoiceReply(invoice, fresh),
          category: fresh.category,
          categoryLabel: fresh.categoryLabel,
          workflow: fresh,
          invoice,
          result: invoice,
          suggestedActions: ["generate-invoice"],
          pricing: pricingSnapshot(fresh.category),
          recommendedApis: categoryApiTools[fresh.category] || []
        });
      }
      const value = parseAnswerForQuestion(workflow.nextQuestion, message);
      const updated = await answerGuidedWorkflow(input.sessionId, { value, message });
      return finishIfReady(input.sessionId, updated, `Got it — **${typeof value === "object" ? value.name : value}**.`, input);
    } catch {
      const error = new Error("Quote session not found. Choose a category to start again.");
      error.statusCode = 404;
      throw error;
    }
  }

  const categoryHint = input.category && supportedCategories.includes(input.category) ? input.category : null;
  let inferred = categoryHint || matchCategoryFromMessage(message) || null;

  // "start" / empty intent with category: just offer services from JSON.
  const isStartIntent = /^(start|begin|quote|new quote|services|list services|hi|hello)\b/i.test(message)
    || message.toLowerCase() === categoryHint;

  if (!inferred && !isStartIntent && !input.skipLlm) {
    inferred = await inferCategoryWithAI(message);
  }
  if (!inferred) inferred = inferCategoryLocally(message);

  if (!inferred) {
    const addresses = extractAddresses(message);
    const options = supportedCategories.map((category, index) => `${index + 1}. ${categoryLabels[category]}`).join("\n");
    return assistantEnvelope({
      mode: "quote-chat",
      reply: [
        addresses[0]
          ? `I can quote work at ${addresses[0]}. First pick a category:`
          : "Pick a category to load its service catalog:",
        "",
        options,
        "",
        "Or choose the category in the dropdown, then I’ll offer services from that JSON file."
      ].join("\n"),
      category: null,
      categoryLabel: null,
      suggestedActions: ["clarify-category"],
      awaitingCategory: true,
      offeredServices: [],
      pricing: null,
      recommendedApis: []
    });
  }

  // Ensure catalog exists (throws 404 if missing).
  listServices(inferred);

  // Pure "start"/hello with a category should only open the service list (not force a service match).
  const offerMessage = (isStartIntent && !extractAddress(message) && !selectServiceFromMessage(inferred, message))
    ? "start"
    : message;

  const offer = await startServiceOffer({
    category: inferred,
    categoryLabel: categoryLabels[inferred],
    message: offerMessage,
    start: input.start || {}
  });

  return interviewEnvelope(offer, input);
}
