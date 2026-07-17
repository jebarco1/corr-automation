import OpenAI from "openai";
import { appConfig } from "../config/appConfig.js";
import { categoryApiTools, supportedCategories } from "./toolCatalog.js";
import { answerGuidedWorkflow, createInvoiceFromSession, getGuidedWorkflow, runGuidedStep, startGuidedWorkflow } from "../services/guidedWorkflow.js";

const client = appConfig.ai.enabled ? new OpenAI({ apiKey: appConfig.ai.apiKey, baseURL: appConfig.ai.baseURL }) : null;

const categoryWords = {
  landscape:["lawn","landscape","mowing","mulch","yard"], hvac:["hvac","air conditioner","ac ","heat pump","furnace","boiler","chiller"],
  cleaning:["cleaning","janitorial","carpet","deep clean"], "pest-control":["pest","termite","rodent","bug","mosquito"],
  pool:["pool","chlorine","ph","spa"], painting:["paint","painting","coats"], roofing:["roof","shingle","gutter"],
  plumbing:["plumb","leak","drain","water heater","sewer"], electrical:["electric","panel","circuit","outlet","generator","ev charger"],
  "general-contract":["remodel","construction","contractor","build-out"], surveillance:["camera","surveillance","security system","nvr"],
  "trash-removal":["trash","junk","dumpster","debris","haul"],
  transportation:["transport","moving","local move","long haul","delivery","freight","pickup","dropoff","relocate","truckload","courier"]
};

function inferCategoryLocally(message="") {
  const text = ` ${message.toLowerCase()} `;
  for (const [category, words] of Object.entries(categoryWords)) if (words.some(word => text.includes(word))) return category;
  return null;
}

async function inferCategoryWithAI(message) {
  if (!client) return inferCategoryLocally(message);
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
