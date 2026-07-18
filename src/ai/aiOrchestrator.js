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

function localAssistantReply(message, category, pricing) {
  const label = pricing?.label || (category ? categoryLabels[category] : null) || "general field service";
  const hourly = pricing?.unitPrices?.hourlyRate;
  const apis = pricing?.recommendedApis?.slice(0, 3) || [];
  const parts = [
    `I reviewed your problem: "${message}".`,
    category
      ? `This looks like a ${label} request.`
      : "Tell me which trade this is (HVAC, plumbing, moving, nursing, etc.) so I can price it more precisely.",
    hourly
      ? `Current industry-standard labor around Atlanta is about $${hourly}/hr for ${label}.`
      : "I can apply industry-standard pricing once the category is clear.",
    apis.length ? `Useful next APIs: ${apis.join(", ")}.` : "",
    "Ask a follow-up, or run Auto walkthrough to generate a draft quote/invoice automatically."
  ].filter(Boolean);

  return {
    mode: "local-fallback",
    reply: parts.join(" "),
    category: category || null,
    categoryLabel: category ? categoryLabels[category] : null,
    suggestedActions: category
      ? ["auto-walkthrough", "ask-follow-up", "update-industry-standards"]
      : ["clarify-category", "ask-follow-up"],
    pricing: pricing || null,
    recommendedApis: apis
  };
}

async function askOpenAiAssistant({ message, history, category, pricing }) {
  if (!client) return null;
  try {
    const response = await client.responses.create({
      model: appConfig.ai.model,
      instructions: [
        "You are HA-Corr, an automated field-service assistant.",
        "Help the user diagnose the problem, recommend a service category, outline next steps, and reference industry-standard pricing when available.",
        "Be concise, practical, and conversational. Do not invent invoice totals unless pricing context is provided.",
        "Return JSON only via the assistant_reply tool."
      ].join(" "),
      input: JSON.stringify({
        latestUserMessage: message,
        conversationHistory: history,
        selectedOrInferredCategory: category,
        industryPricingContext: pricing,
        supportedCategories
      }),
      tools: [{
        type: "function",
        name: "assistant_reply",
        description: "Return the chatbot reply and structured guidance.",
        strict: true,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["reply", "category", "suggestedActions"],
          properties: {
            reply: { type: "string" },
            category: { type: "string", enum: supportedCategories },
            suggestedActions: {
              type: "array",
              items: {
                type: "string",
                enum: ["auto-walkthrough", "ask-follow-up", "clarify-category", "update-industry-standards", "generate-invoice"]
              }
            },
            followUpQuestion: { type: "string" }
          }
        }
      }],
      tool_choice: { type: "function", name: "assistant_reply" }
    });
    const call = response.output?.find(item => item.type === "function_call" && item.name === "assistant_reply");
    if (!call) return null;
    const parsed = JSON.parse(call.arguments);
    const resolvedCategory = parsed.category && supportedCategories.includes(parsed.category)
      ? parsed.category
      : category;
    const resolvedPricing = pricingSnapshot(resolvedCategory) || pricing;
    return {
      mode: "openai",
      reply: parsed.reply,
      category: resolvedCategory || null,
      categoryLabel: resolvedCategory ? categoryLabels[resolvedCategory] : null,
      suggestedActions: parsed.suggestedActions || ["ask-follow-up"],
      pricing: resolvedPricing,
      recommendedApis: resolvedPricing?.recommendedApis || []
    };
  } catch (error) {
    console.warn("OpenAI assistant chat failed; using local fallback:", error.message);
    return null;
  }
}

/**
 * Freeform homepage chatbot: user types a problem → AI responds via API.
 */
export async function chatWithAssistant(input = {}) {
  const message = String(input.message || "").trim();
  if (!message) {
    const error = new Error("message is required");
    error.statusCode = 400;
    throw error;
  }

  const history = Array.isArray(input.history)
    ? input.history
      .filter(item => item && (item.role === "user" || item.role === "assistant") && item.content)
      .slice(-12)
      .map(item => ({ role: item.role, content: String(item.content).slice(0, 2000) }))
    : [];

  const categoryHint = input.category && supportedCategories.includes(input.category) ? input.category : null;
  const inferred = categoryHint || await inferCategoryWithAI(message) || inferCategoryLocally(message);
  const pricing = pricingSnapshot(inferred);

  let result = null;
  if (!input.skipLlm) {
    result = await askOpenAiAssistant({ message, history, category: inferred, pricing });
  }
  if (!result) {
    result = localAssistantReply(message, inferred, pricing);
  }

  return {
    ...result,
    provider: appConfig.ai.enabled ? "openai" : "local-fallback",
    model: appConfig.ai.enabled ? appConfig.ai.model : null,
    generatedAt: new Date().toISOString()
  };
}
