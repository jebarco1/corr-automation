import OpenAI from "openai";
import { appConfig } from "../config/appConfig.js";
import { categoryApiTools, supportedCategories } from "./toolCatalog.js";
import { answerGuidedWorkflow, createInvoiceFromSession, getGuidedWorkflow, runGuidedStep, startGuidedWorkflow } from "../services/guidedWorkflow.js";
import { getPricingStandards } from "../services/pricingStandards.js";

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
  healthcare: "Nursing & Doctors"
};

const categoryWords = {
  landscape:["lawn","landscape","mowing","mulch","yard"], hvac:["hvac","air conditioner","ac ","heat pump","furnace","boiler","chiller"],
  cleaning:["cleaning","janitorial","carpet","deep clean"], "pest-control":["pest","termite","rodent","bug","mosquito"],
  pool:["pool","chlorine","ph","spa"], painting:["paint","painting","coats"], roofing:["roof","shingle","gutter"],
  plumbing:["plumb","leak","drain","water heater","sewer"], electrical:["electric","panel","circuit","outlet","generator","ev charger"],
  "general-contract":["remodel","construction","contractor","build-out"], surveillance:["camera","surveillance","security system","nvr"],
  "trash-removal":["trash","junk","dumpster","debris","haul"],
  transportation:["transport","moving","local move","long haul","delivery","freight","pickup","dropoff","relocate","truckload","courier"," move","mover","apartment move","house move"],
  healthcare:["nurse","nursing","rn ","lpn","doctor","physician","home health","home visit","patient","clinical","medical staffing","hospice","care plan"]
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
      instructions: "Classify a field-service request into exactly one HA-Corr category. Use the choose_category tool. Do not answer conversationally.",
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

export async function startAIWorkflow(input={}) {
  const message = String(input.message || "").trim();
  const category = input.category || await inferCategoryWithAI(message);
  if (!category || !supportedCategories.includes(category)) {
    const error = new Error("The AI could not determine a supported category. Select a category or provide more service details.");
    error.statusCode = 400; throw error;
  }
  const workflow = startGuidedWorkflow(category, input.start || {});
  return {
    mode: appConfig.ai.enabled ? "openai" : "local-fallback",
    category,
    assistantMessage: `I selected ${workflow.categoryLabel}. ${workflow.nextQuestion?.question || "The workflow is ready for an invoice."}`,
    recommendedApis: categoryApiTools[category] || [],
    workflow
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
      if (!question) return {assistantMessage:"All questions are complete. You can generate the invoice.",workflow};
      if (question.type === "number" || question.type === "currency") parsedValue = Number(String(message).replace(/[^0-9.-]/g,""));
      else parsedValue = message;
    }
    result = answerGuidedWorkflow(sessionId,{value:parsedValue});
  }
  const workflow = result.workflow || (result.invoiceId ? getGuidedWorkflow(sessionId) : result);
  return {
    assistantMessage: result.invoiceId ? `Draft invoice ${result.invoiceNumber} was created for $${result.total}.` : (workflow.nextQuestion?.question || "All required information is collected. Generate the invoice when ready."),
    result,
    workflow
  };
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

function extractAddress(message = "") {
  const text = String(message || "");
  const match = text.match(
    /\d{1,6}\s+[A-Za-z0-9.'#\- ]+,\s*[A-Za-z .'#-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?/i
  ) || text.match(
    /\d{1,6}\s+[A-Za-z0-9.'#\- ]+(?:,\s*[A-Za-z .'#-]+){1,3}(?:\s+\d{5}(?:-\d{4})?)?/
  );
  return match?.[0]?.replace(/\s+/g, " ").replace(/^[-:]\s*/, "").trim() || null;
}

function invalidAnswer(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function looksLikeGenerateCommand(message = "") {
  return /^(yes|y|ok|okay|sure|generate|create|invoice|quote|done|build it|make (the )?quote|make (the )?invoice)\b/i.test(String(message).trim());
}

function formatQuestionPrompt(question) {
  if (!question) return "I have everything needed for your quote. Reply **generate** to create the draft invoice.";
  const lines = [question.question];
  if (question.type === "select" && question.options?.length) {
    lines.push(`Options: ${question.options.join(", ")}`);
  } else if (question.example != null && question.type !== "object") {
    lines.push(`Example: ${typeof question.example === "object" ? JSON.stringify(question.example) : question.example}`);
  } else if (question.type === "object") {
    lines.push("Reply with name, email, and phone (example: Taylor Smith, taylor@example.com, 404-555-0199).");
  }
  return lines.join("\n");
}

function parseCustomer(message) {
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === "object") {
      return {
        name: parsed.name || "Customer",
        email: parsed.email || "customer@example.com",
        phone: parsed.phone || "404-555-0100"
      };
    }
  } catch {
    // freeform
  }
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = message.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0];
  let name = message
    .replace(email || "", "")
    .replace(phone || "", "")
    .replace(/[|,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || name.length < 2) name = "Customer";
  return {
    name,
    email: email || "customer@example.com",
    phone: phone || "404-555-0100"
  };
}

function parseAnswerForQuestion(question, message) {
  const text = String(message || "").trim();
  if (!question) return text;

  if (question.type === "object" || question.key === "customer") {
    return parseCustomer(text);
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

function buildPrefillFromMessage(message, category, pricing) {
  const prefill = {};
  const address = extractAddress(message);
  if (address) prefill.serviceAddress = address;

  const text = message.toLowerCase();
  if (/commercial|office|retail|warehouse/.test(text)) prefill.propertyType = "commercial";
  else if (/hoa/.test(text)) prefill.propertyType = "hoa";
  else if (/apartment|multi[- ]?family/.test(text)) prefill.propertyType = "multi-family";
  else if (address || /home|house|residential/.test(text)) prefill.propertyType = "residential";

  if (pricing?.unitPrices?.hourlyRate != null) prefill.hourlyRate = pricing.unitPrices.hourlyRate;

  if (category === "landscape") {
    if (/mow/.test(text)) prefill.serviceType = "mowing";
    else if (/mulch/.test(text)) prefill.serviceType = "mulch";
    else if (/fertil/.test(text)) prefill.serviceType = "fertilization";
    else if (/cleanup|clean up/.test(text)) prefill.serviceType = "cleanup";
  }
  if (category === "hvac") {
    if (/replac/.test(text)) prefill.serviceType = "replacement";
    else if (/maintain|tune/.test(text)) prefill.serviceType = "maintenance";
    else if (/install/.test(text)) prefill.serviceType = "installation";
    else if (/repair|cool|heat|ac |a\/c/.test(text)) prefill.serviceType = "diagnostic";
  }
  if (category === "plumbing") {
    if (/water heater/.test(text)) prefill.serviceType = "water heater";
    else if (/drain|clog/.test(text)) prefill.serviceType = "drain clearing";
    else if (/leak/.test(text)) prefill.serviceType = "leak repair";
  }

  return prefill;
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

function questionResponse({ workflow, intro, mode = "quote-chat" }) {
  const pricing = pricingSnapshot(workflow.category);
  const nextQuestion = workflow.nextQuestion;
  const ready = !nextQuestion;
  const reply = [
    intro,
    "",
    formatQuestionPrompt(nextQuestion)
  ].filter(Boolean).join("\n").trim();

  return assistantEnvelope({
    mode,
    reply,
    category: workflow.category,
    categoryLabel: workflow.categoryLabel || categoryLabels[workflow.category],
    workflow,
    nextQuestion,
    suggestedActions: ready ? ["generate-invoice"] : ["answer-question"],
    pricing,
    recommendedApis: pricing?.recommendedApis || categoryApiTools[workflow.category] || []
  });
}

async function continueQuoteChat(sessionId, message, input = {}) {
  let workflow;
  try {
    workflow = getGuidedWorkflow(sessionId);
  } catch {
    const error = new Error("Quote session not found. Describe the job again to start a new quote.");
    error.statusCode = 404;
    throw error;
  }

  if (!workflow.nextQuestion) {
    if (looksLikeGenerateCommand(message) || input.action === "invoice") {
      const invoice = createInvoiceFromSession(sessionId, input.invoice || input.start || {});
      const fresh = getGuidedWorkflow(sessionId);
      return assistantEnvelope({
        mode: "quote-chat",
        reply: `Draft quote ${invoice.invoiceNumber} is ready for $${Number(invoice.total).toFixed(2)} ${invoice.currency}. Review the line items in the side panel.`,
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
    return questionResponse({
      workflow,
      intro: `I already have the details for your ${workflow.categoryLabel} quote${workflow.answers?.serviceAddress ? ` at ${workflow.answers.serviceAddress}` : ""}.`
    });
  }

  let value;
  try {
    value = parseAnswerForQuestion(workflow.nextQuestion, message);
  } catch (error) {
    return questionResponse({
      workflow,
      intro: `${error.message}`
    });
  }

  const updated = answerGuidedWorkflow(sessionId, { value });
  const acknowledged = typeof value === "object" ? (value.name || "saved") : String(value);

  if (!updated.nextQuestion) {
    return questionResponse({
      workflow: updated,
      intro: `Thanks — recorded **${acknowledged}**. I have everything needed for your ${updated.categoryLabel} quote.`
    });
  }

  return questionResponse({
    workflow: updated,
    intro: `Thanks — recorded **${acknowledged}**.`
  });
}

function startQuoteChat({ message, category, input = {} }) {
  const pricing = pricingSnapshot(category);
  const prefill = buildPrefillFromMessage(message, category, pricing);
  const workflow = startGuidedWorkflow(category, {
    ...(input.start || {}),
    prefill: {
      ...(input.start?.prefill || {}),
      ...prefill
    }
  });

  const label = workflow.categoryLabel || categoryLabels[category];
  const hourly = pricing?.unitPrices?.hourlyRate;
  const addressNote = prefill.serviceAddress ? ` for ${prefill.serviceAddress}` : "";
  const intro = [
    `I'll build a ${label} quote${addressNote}.`,
    hourly ? `Industry-standard labor near Atlanta starts around $${hourly}/hr.` : null,
    Object.keys(prefill).length
      ? `I prefilled: ${Object.keys(prefill).join(", ")}. Answer the next question to continue.`
      : "Answer a few quick questions so I can price it."
  ].filter(Boolean).join(" ");

  return questionResponse({ workflow, intro, mode: appConfig.ai.enabled ? "openai-quote-chat" : "quote-chat" });
}

/**
 * Homepage chatbot: starts/continues a quote interview by asking the next question.
 */
export async function chatWithAssistant(input = {}) {
  const message = String(input.message || "").trim();
  if (!message) {
    const error = new Error("message is required");
    error.statusCode = 400;
    throw error;
  }

  if (input.sessionId) {
    return continueQuoteChat(input.sessionId, message, input);
  }

  const categoryHint = input.category && supportedCategories.includes(input.category) ? input.category : null;
  let inferred = categoryHint || matchCategoryFromMessage(message) || null;
  if (!inferred && !input.skipLlm) {
    inferred = await inferCategoryWithAI(message);
  }
  if (!inferred) inferred = inferCategoryLocally(message);

  if (!inferred) {
    const options = supportedCategories.map((category, index) => `${index + 1}. ${categoryLabels[category]}`).join("\n");
    return assistantEnvelope({
      mode: "quote-chat",
      reply: [
        extractAddress(message)
          ? `I can quote work at ${extractAddress(message)}. Which service is this for?`
          : "I can build a quote for that. Which service is this for?",
        "",
        options,
        "",
        "Reply with the service name (for example: Landscape, HVAC, Plumbing)."
      ].join("\n"),
      category: null,
      categoryLabel: null,
      suggestedActions: ["clarify-category", "answer-question"],
      awaitingCategory: true,
      pricing: null,
      recommendedApis: []
    });
  }

  return startQuoteChat({ message, category: inferred, input });
}
