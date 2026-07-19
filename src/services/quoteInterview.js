import crypto from "crypto";
import { answerGuidedWorkflow, createInvoiceFromSession, getGuidedWorkflow, startGuidedWorkflow } from "./guidedWorkflow.js";
import { buildSmartDefaults, extractAddress, extractAddresses } from "./quoteAutomation.js";
import { getServiceById, listServices, matchServiceFromText } from "./serviceCatalog.js";

const interviews = new Map();
const uid = () => `interview_${crypto.randomUUID()}`;

function serviceOptions(category) {
  const catalog = listServices(category);
  return {
    catalog,
    services: catalog.services.filter(service => service.active !== false).map((service, index) => ({
      index: index + 1,
      id: service.id,
      name: service.name,
      description: service.description,
      quoteKey: service.quoteKey,
      aliases: service.aliases || [],
      defaultHours: service.defaultHours,
      billingUnit: service.billingUnit,
      typicalFrequency: service.typicalFrequency,
      relatedApis: service.relatedApis || [],
      inGuidedWorkflow: !!service.inGuidedWorkflow,
      requiresShipping: service.requiresShipping === true
        || (category === "transportation" && service.requiresShipping !== false
          && !["packing", "loading-only"].includes(service.id))
    }))
  };
}

function serviceNeedsShipping(service, category) {
  if (!service) return false;
  if (service.requiresShipping === true) return true;
  if (service.requiresShipping === false) return false;
  if (category !== "transportation") return false;
  return !["packing", "loading-only"].includes(service.id);
}

/** Strict selection: number, id, name, or alias. Returns null if unclear. */
export function selectServiceFromMessage(category, message = "") {
  const { services } = serviceOptions(category);
  const text = String(message || "").trim();
  if (!text) return null;

  const numbered = text.match(/^(\d{1,3})\b/);
  if (numbered) {
    const hit = services.find(service => service.index === Number(numbered[1]));
    if (hit) return hit;
  }

  const lower = text.toLowerCase();
  const exact = services.find(service =>
    service.id.toLowerCase() === lower
    || service.name.toLowerCase() === lower
    || service.quoteKey?.toLowerCase() === lower
  );
  if (exact) return exact;

  // Prefer explicit catalog match with score; ignore weak default-only matches.
  const matched = matchServiceFromText(category, text);
  if (!matched) return null;

  const needles = [matched.id, matched.name, matched.quoteKey, ...(matched.aliases || [])]
    .map(value => String(value || "").toLowerCase())
    .filter(Boolean);
  const hasSignal = needles.some(needle => lower.includes(needle) || needle.includes(lower));
  if (!hasSignal) return null;

  return services.find(service => service.id === matched.id) || null;
}

function parcelSummary(answers = {}) {
  if (!answers.serviceAddress && !answers.pickupAddress && !answers.dropoffAddress && !answers.regridLookupAt) {
    return null;
  }
  return {
    address: answers.matchedAddress || answers.serviceAddress || answers.pickupAddress || null,
    pickupAddress: answers.pickupAddress || null,
    dropoffAddress: answers.dropoffAddress || null,
    squareFeet: answers.squareFeet ?? null,
    lotSquareFeet: answers.lotSquareFeet ?? null,
    buildingSquareFeet: answers.buildingSquareFeet ?? null,
    acres: answers.acres ?? null,
    parcelId: answers.parcelId ?? null,
    measurementSource: answers.regridMeasurementSource ?? null,
    error: answers.regridError ?? null
  };
}

function formatParcelLines(parcel) {
  if (!parcel) return [];
  const lines = [];
  if (parcel.pickupAddress || parcel.dropoffAddress) {
    if (parcel.pickupAddress) lines.push(`From (pickup): ${parcel.pickupAddress}`);
    if (parcel.dropoffAddress) lines.push(`To (dropoff): ${parcel.dropoffAddress}`);
  } else if (parcel.address) {
    lines.push(`Parcel address: ${parcel.address}`);
  }
  if (parcel.error && parcel.squareFeet == null) {
    lines.push(`Parcel lookup: could not resolve size yet (${parcel.error}).`);
    return lines;
  }
  if (parcel.squareFeet != null) {
    const acresPart = parcel.acres != null && Number(parcel.squareFeet) === Number(parcel.lotSquareFeet)
      ? ` (${parcel.acres} acres)`
      : "";
    lines.push(`Measured area: ${Number(parcel.squareFeet).toLocaleString()} sqft${acresPart}`);
  }
  if (parcel.buildingSquareFeet != null && parcel.buildingSquareFeet !== parcel.squareFeet) {
    lines.push(`Building footprint: ${Number(parcel.buildingSquareFeet).toLocaleString()} sqft`);
  }
  if (parcel.lotSquareFeet != null && parcel.lotSquareFeet !== parcel.squareFeet) {
    const acresPart = parcel.acres != null ? ` (${parcel.acres} acres)` : "";
    lines.push(`Lot size: ${Number(parcel.lotSquareFeet).toLocaleString()} sqft${acresPart}`);
  }
  if (parcel.parcelId) lines.push(`Parcel ID: ${parcel.parcelId}`);
  return lines;
}

/** Single clean quote-result block for chat (no markdown, no duplicated sections). */
export function formatQuoteResultReply({ service, parcel, invoice, categoryLabel } = {}) {
  const lines = ["Quote result"];
  if (service?.name) {
    lines.push(`Service: ${service.name}${service.id ? ` (${service.id})` : ""}`);
  } else if (categoryLabel) {
    lines.push(`Category: ${categoryLabel}`);
  }
  lines.push(...formatParcelLines(parcel));
  if (invoice?.invoiceNumber) {
    lines.push(
      `Draft quote ${invoice.invoiceNumber} is ready for $${Number(invoice.total).toFixed(2)} ${invoice.currency || "USD"}.`
    );
    if (Array.isArray(invoice.lineItems) && invoice.lineItems.length) {
      lines.push("Line items:");
      for (const item of invoice.lineItems.slice(0, 6)) {
        lines.push(`- ${item.description}: $${Number(item.amount).toFixed(2)}`);
      }
    }
  }
  return lines.filter(Boolean).join("\n");
}

function askPickupReply(service) {
  return {
    reply: [
      `Service selected: ${service.name}.`,
      "This shipping service needs both addresses.",
      "First, what is the FROM (pickup) address?",
      "Example: 100 Peachtree St, Atlanta, GA 30303"
    ].join("\n"),
    suggestedActions: ["provide-pickup-address"],
    awaitingAddress: true,
    awaitingPickupAddress: true,
    nextQuestion: {
      key: "pickupAddress",
      question: "What is the FROM (pickup) address?",
      type: "string",
      required: true,
      ask: true,
      example: "100 Peachtree St, Atlanta, GA 30303"
    }
  };
}

function askDropoffReply(service, pickupAddress) {
  return {
    reply: [
      `Got pickup: ${pickupAddress}.`,
      `Service: ${service.name}.`,
      "What is the TO (dropoff / destination) address?",
      "Example: 500 Ponce De Leon Ave, Atlanta, GA 30308"
    ].join("\n"),
    suggestedActions: ["provide-dropoff-address"],
    awaitingAddress: true,
    awaitingDropoffAddress: true,
    nextQuestion: {
      key: "dropoffAddress",
      question: "What is the TO (dropoff / destination) address?",
      type: "string",
      required: true,
      ask: true,
      example: "500 Ponce De Leon Ave, Atlanta, GA 30308"
    }
  };
}

function interviewView(interview, extras = {}) {
  const workflow = interview.guidedSessionId
    ? getGuidedWorkflow(interview.guidedSessionId)
    : null;
  return {
    sessionId: interview.interviewId,
    interviewId: interview.interviewId,
    stage: interview.stage,
    category: interview.category,
    categoryLabel: interview.categoryLabel,
    offeredServices: interview.offeredServices,
    selectedService: interview.selectedService,
    parcel: interview.parcel,
    sourceMessage: interview.sourceMessage,
    workflow,
    ...extras
  };
}

export function getInterview(interviewId) {
  return interviews.get(interviewId) || null;
}

export async function startServiceOffer({ category, categoryLabel, message = "", start = {} }) {
  const { catalog, services } = serviceOptions(category);
  const address = extractAddress(message);
  const earlyService = selectServiceFromMessage(category, message);

  const interview = {
    interviewId: uid(),
    stage: "pick-service",
    category,
    categoryLabel: categoryLabel || catalog.label,
    offeredServices: services,
    selectedService: null,
    parcel: null,
    guidedSessionId: null,
    sourceMessage: String(message || ""),
    pendingAddress: address,
    start: { ...start }
  };
  interviews.set(interview.interviewId, interview);

  // If the opener already named a service clearly, skip the picker.
  if (earlyService) {
    return applyServiceSelection(interview.interviewId, earlyService, message);
  }

  const list = services
    .map(service => `${service.index}. **${service.name}** — ${service.description}`)
    .join("\n");

  return {
    ...interviewView(interview),
    reply: [
      `Category **${interview.categoryLabel}** selected.`,
      `I loaded **${services.length}** services from \`data/service-catalog/${category}.json\`.`,
      address ? `I also noticed address **${address}** — pick a service and I’ll pull the parcel details next.` : "Pick a service below (reply with the number or name).",
      "",
      list
    ].join("\n"),
    suggestedActions: ["pick-service"],
    awaitingService: true
  };
}

async function beginGuidedQuote(interview, message = "") {
  const service = interview.selectedService;
  const combinedMessage = [interview.sourceMessage, message].filter(Boolean).join("\n");
  const addresses = extractAddresses(combinedMessage);
  const address = interview.pendingAddress || extractAddress(message) || addresses[0];
  const needsShipping = serviceNeedsShipping(service, interview.category);

  if (!address && interview.category !== "transportation") {
    interview.stage = "need-address";
    return {
      ...interviewView(interview),
      reply: [
        `Service selected: ${service.name}.`,
        "Next I need the job-site address so I can pull parcel (lot/building) information.",
        "Paste a full street address (example: 121 Cascade Way, Coppell, TX 75019)."
      ].join("\n"),
      suggestedActions: ["provide-address"],
      awaitingAddress: true,
      nextQuestion: {
        key: "serviceAddress",
        question: "What is the service address?",
        type: "string",
        required: true,
        ask: true,
        example: "121 Cascade Way, Coppell, TX 75019"
      }
    };
  }

  if (interview.category === "transportation" && needsShipping) {
    const pickupAddress = interview.pendingPickupAddress || addresses[0] || interview.pendingAddress || null;
    const dropoffAddress = interview.pendingDropoffAddress
      || (addresses[1] && addresses[1] !== pickupAddress ? addresses[1] : null)
      || null;

    if (!pickupAddress) {
      interview.stage = "need-pickup";
      return {
        ...interviewView(interview),
        ...askPickupReply(service)
      };
    }

    interview.pendingPickupAddress = pickupAddress;
    interview.pendingAddress = pickupAddress;

    if (!dropoffAddress) {
      interview.stage = "need-dropoff";
      return {
        ...interviewView(interview),
        ...askDropoffReply(service, pickupAddress)
      };
    }

    interview.pendingDropoffAddress = dropoffAddress;
  } else if (interview.category === "transportation" && !address) {
    interview.stage = "need-address";
    return {
      ...interviewView(interview),
      reply: [
        `Service selected: ${service.name}.`,
        "What is the service address for this job?",
        "Example: 100 Peachtree St, Atlanta, GA 30303"
      ].join("\n"),
      suggestedActions: ["provide-address"],
      awaitingAddress: true,
      nextQuestion: {
        key: "serviceAddress",
        question: "What is the service address?",
        type: "string",
        required: true,
        ask: true,
        example: "100 Peachtree St, Atlanta, GA 30303"
      }
    };
  }

  const businessSettings = interview.start.businessSettings || {};
  const pickupAddress = needsShipping
    ? (interview.pendingPickupAddress || addresses[0] || address)
    : undefined;
  const dropoffAddress = needsShipping
    ? (interview.pendingDropoffAddress || addresses[1] || null)
    : undefined;

  const prefill = buildSmartDefaults(interview.category, combinedMessage, businessSettings, {
    serviceId: service.id,
    serviceType: service.quoteKey || service.name,
    estimatedHours: service.defaultHours,
    serviceAddress: needsShipping ? pickupAddress : (address || interview.pendingAddress || undefined),
    pickupAddress: needsShipping ? pickupAddress : undefined,
    dropoffAddress: needsShipping ? dropoffAddress : undefined,
    requiresShipping: needsShipping
  });

  // Shipping quotes must keep explicit from/to — don't let autofill invent a missing dropoff.
  if (needsShipping) {
    prefill.pickupAddress = pickupAddress;
    prefill.dropoffAddress = dropoffAddress;
    prefill.serviceAddress = pickupAddress;
  }

  if (interview.category === "general-contract") {
    prefill.projectType = service.quoteKey || service.id.replace(/-/g, " ");
  }

  const workflow = await startGuidedWorkflow(interview.category, {
    ...interview.start,
    message: combinedMessage,
    prefill
  });

  interview.guidedSessionId = workflow.sessionId;
  interview.parcel = parcelSummary(workflow.answers);
  interview.stage = workflow.nextQuestion ? "ask-questions" : "ready";
  interview.pendingAddress = workflow.answers.serviceAddress || workflow.answers.pickupAddress || address;

  const parcelLines = formatParcelLines(interview.parcel);

  if (!workflow.nextQuestion) {
    const invoice = createInvoiceFromSession(interview.guidedSessionId, interview.start || {});
    const fresh = getGuidedWorkflow(interview.guidedSessionId);
    interview.stage = "done";
    interview.parcel = parcelSummary(fresh.answers);
    return {
      ...interviewView(interview),
      invoice,
      result: invoice,
      reply: formatQuoteResultReply({
        service,
        parcel: interview.parcel,
        invoice,
        categoryLabel: interview.categoryLabel
      }),
      suggestedActions: ["generate-invoice"],
      nextQuestion: null
    };
  }

  return {
    ...interviewView(interview),
    reply: [
      `Service: ${service.name} (${service.id}).`,
      ...parcelLines,
      "",
      "A couple details are still needed for the quote:",
      workflow.nextQuestion.question,
      workflow.nextQuestion.options?.length ? `Options: ${workflow.nextQuestion.options.join(", ")}` : null
    ].filter(Boolean).join("\n"),
    suggestedActions: ["answer-question"],
    nextQuestion: workflow.nextQuestion
  };
}

export async function applyServiceSelection(interviewId, serviceOrMessage, message = "") {
  const interview = interviews.get(interviewId);
  if (!interview) {
    const error = new Error("Quote interview not found");
    error.statusCode = 404;
    throw error;
  }

  let service = serviceOrMessage;
  if (typeof serviceOrMessage === "string" || !serviceOrMessage?.id) {
    service = selectServiceFromMessage(interview.category, String(serviceOrMessage || message));
  }
  if (!service) {
    // allow getServiceById for raw ids from UI chips
    try {
      const raw = String(serviceOrMessage?.id || serviceOrMessage || message).trim();
      service = getServiceById(interview.category, raw).service;
      const offered = interview.offeredServices.find(item => item.id === service.id);
      service = offered || {
        index: 0,
        id: service.id,
        name: service.name,
        description: service.description,
        quoteKey: service.quoteKey,
        defaultHours: service.defaultHours,
        requiresShipping: service.requiresShipping === true
          || (interview.category === "transportation" && service.requiresShipping !== false
            && !["packing", "loading-only"].includes(service.id))
      };
    } catch {
      return {
        ...interviewView(interview),
        reply: [
          "I couldn’t match that to a catalog service.",
          "Reply with a service **number** or **name** from the list."
        ].join("\n"),
        suggestedActions: ["pick-service"],
        awaitingService: true
      };
    }
  }

  interview.selectedService = {
    id: service.id,
    name: service.name,
    description: service.description,
    quoteKey: service.quoteKey,
    defaultHours: service.defaultHours,
    relatedApis: service.relatedApis || [],
    requiresShipping: serviceNeedsShipping(service, interview.category)
  };
  interview.sourceMessage = [interview.sourceMessage, message].filter(Boolean).join("\n");

  const addressesInMessage = extractAddresses(message);
  if (addressesInMessage[0]) interview.pendingAddress = addressesInMessage[0];
  if (serviceNeedsShipping(interview.selectedService, interview.category)) {
    if (addressesInMessage[0]) interview.pendingPickupAddress = addressesInMessage[0];
    if (addressesInMessage[1]) interview.pendingDropoffAddress = addressesInMessage[1];
  }

  return beginGuidedQuote(interview, message);
}

export async function continueInterview(interviewId, message, input = {}) {
  const interview = interviews.get(interviewId);
  if (!interview) {
    const error = new Error("Quote interview not found");
    error.statusCode = 404;
    throw error;
  }

  if (interview.stage === "pick-service") {
    return applyServiceSelection(interviewId, message, message);
  }

  if (interview.stage === "need-address" || interview.stage === "need-pickup" || interview.stage === "need-dropoff") {
    const addresses = extractAddresses(message);
    const address = extractAddress(message) || addresses[0];
    if (!address) {
      const prompt = interview.stage === "need-dropoff"
        ? "Please paste the TO (dropoff) address including city and state (example: 500 Ponce De Leon Ave, Atlanta, GA 30308)."
        : interview.stage === "need-pickup"
          ? "Please paste the FROM (pickup) address including city and state (example: 100 Peachtree St, Atlanta, GA 30303)."
          : "Please paste a full street address including city and state (example: 123 Main St, Atlanta, GA 30303).";
      return {
        ...interviewView(interview),
        reply: prompt,
        suggestedActions: interview.stage === "need-dropoff"
          ? ["provide-dropoff-address"]
          : interview.stage === "need-pickup"
            ? ["provide-pickup-address"]
            : ["provide-address"],
        awaitingAddress: true,
        awaitingPickupAddress: interview.stage === "need-pickup",
        awaitingDropoffAddress: interview.stage === "need-dropoff"
      };
    }

    interview.sourceMessage = [interview.sourceMessage, message].filter(Boolean).join("\n");

    if (interview.stage === "need-pickup") {
      interview.pendingPickupAddress = address;
      interview.pendingAddress = address;
      // If the user pasted both addresses in one reply, capture dropoff now.
      if (addresses[1] && addresses[1] !== address) {
        interview.pendingDropoffAddress = addresses[1];
      } else {
        interview.stage = "need-dropoff";
        return {
          ...interviewView(interview),
          ...askDropoffReply(interview.selectedService, address)
        };
      }
    } else if (interview.stage === "need-dropoff") {
      interview.pendingDropoffAddress = address;
    } else {
      interview.pendingAddress = address;
    }

    return beginGuidedQuote(interview, message);
  }

  // Guided question / invoice stages
  if (!interview.guidedSessionId) {
    return beginGuidedQuote(interview, message);
  }

  let workflow = getGuidedWorkflow(interview.guidedSessionId);

  if (!workflow.nextQuestion) {
    if (/^(yes|y|ok|okay|sure|generate|create|invoice|quote|done)\b/i.test(message) || input.autoGenerate !== false) {
      const invoice = createInvoiceFromSession(interview.guidedSessionId, input.invoice || interview.start || {});
      workflow = getGuidedWorkflow(interview.guidedSessionId);
      interview.stage = "done";
      interview.parcel = parcelSummary(workflow.answers);
      return {
        ...interviewView(interview),
        invoice,
        result: invoice,
        reply: formatQuoteResultReply({
          service: interview.selectedService,
          parcel: interview.parcel,
          invoice,
          categoryLabel: interview.categoryLabel
        }),
        suggestedActions: ["generate-invoice"]
      };
    }
    return {
      ...interviewView(interview),
      reply: "Everything is collected. Reply generate to create the draft invoice.",
      suggestedActions: ["generate-invoice"]
    };
  }

  // Answer the current guided question
  const question = workflow.nextQuestion;
  let value = message;
  if (question.type === "number" || question.type === "currency") {
    const match = String(message).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    value = match ? Number(match[0]) : message;
  } else if (question.key?.includes("Address") || question.key === "serviceAddress") {
    value = extractAddress(message) || message;
  } else if (question.type === "object") {
    value = message;
  }

  workflow = await answerGuidedWorkflow(interview.guidedSessionId, { value, message });
  interview.parcel = parcelSummary(workflow.answers);
  interview.stage = workflow.nextQuestion ? "ask-questions" : "ready";

  const parcelLines = formatParcelLines(interview.parcel);
  if (!workflow.nextQuestion && input.autoGenerate !== false) {
    const invoice = createInvoiceFromSession(interview.guidedSessionId, input.invoice || interview.start || {});
    workflow = getGuidedWorkflow(interview.guidedSessionId);
    interview.stage = "done";
    interview.parcel = parcelSummary(workflow.answers);
    return {
      ...interviewView(interview),
      invoice,
      result: invoice,
      reply: formatQuoteResultReply({
        service: interview.selectedService,
        parcel: interview.parcel,
        invoice,
        categoryLabel: interview.categoryLabel
      }),
      suggestedActions: ["generate-invoice"]
    };
  }

  return {
    ...interviewView(interview),
    reply: [
      "Got it.",
      ...parcelLines,
      workflow.nextQuestion
        ? `\n${workflow.nextQuestion.question}${workflow.nextQuestion.options?.length ? `\nOptions: ${workflow.nextQuestion.options.join(", ")}` : ""}`
        : "\nReply generate to create the draft invoice."
    ].filter(Boolean).join("\n"),
    suggestedActions: workflow.nextQuestion ? ["answer-question"] : ["generate-invoice"],
    nextQuestion: workflow.nextQuestion
  };
}
