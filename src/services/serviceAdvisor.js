import crypto from "crypto";
import OpenAI from "openai";
import { appConfig } from "../config/appConfig.js";
import { getServiceDocs, listServiceDocs } from "./serviceDocs.js";
import { matchServiceFromText, patchCatalogService, slugifyServiceId, upsertCatalogService } from "./serviceCatalog.js";
import { mergeInputOverride, setFormulaOverride } from "./serviceDocOverrides.js";
import { getPricingStandards, savePricingStandards } from "./pricingStandards.js";

const client = appConfig.ai.enabled
  ? new OpenAI({ apiKey: appConfig.ai.apiKey, baseURL: appConfig.ai.baseURL })
  : null;

const sessions = new Map();
const uid = prefix => `${prefix}_${crypto.randomUUID()}`;

const COMMON_INPUT_KEYS = new Set([
  "customer", "serviceAddress", "propertyType", "requestedDate", "serviceType",
  "estimatedHours", "hourlyRate", "materialCost", "crewSize"
]);

/** Category-specific services the advisor can propose when the user asks for suggestions. */
const CATEGORY_SERVICE_SUGGESTIONS = {
  landscape: ["Seasonal Color Install", "Irrigation Start-Up", "Aeration & Overseeding", "Leaf Cleanup"],
  hvac: ["Duct Cleaning", "UV Air Purifier Install", "Mini-Split Maintenance", "Filter Subscription"],
  cleaning: ["Move-Out Deep Clean", "Carpet Extraction", "Post-Construction Clean", "Nightly Office Detail"],
  "pest-control": ["Mosquito Yard Treatment", "Rodent Exclusion", "Bed Bug Heat Prep", "Wildlife Exclusion"],
  pool: ["Pool Opening Package", "Salt Cell Replacement", "Green-to-Clean Recovery", "Weekly Chemical Route"],
  painting: ["Cabinet Refinish", "Exterior Trim Refresh", "Deck Stain Package", "Commercial Common-Area Coat"],
  roofing: ["Gutter Guard Install", "Storm Leak Repair", "Soft-Wash Roof Clean", "Attic Ventilation Upgrade"],
  plumbing: ["Water Heater Flush", "Sump Pump Install", "Camera Sewer Inspection", "Fixture Refresh Package"],
  electrical: ["EV Charger Install", "Panel Safety Inspection", "Generator Transfer Switch", "Recessed Lighting Package"],
  "general-contract": ["Kitchen Refresh Scope", "Bathroom Remodel Package", "ADA Ramp Build", "Tenant Build-Out"],
  surveillance: ["Doorbell Camera Kit", "Parking Lot Camera Expand", "NVR Storage Upgrade", "Remote Monitoring Setup"],
  "trash-removal": ["Estate Cleanout", "Construction Debris Haul", "Appliance Pickup", "Yard Waste Dumpster"],
  transportation: ["Piano Move", "Same-Day Courier Run", "Office Relocation Pod", "Appliance Delivery"],
  healthcare: ["Wound Care Visit", "Medication Reconciliation", "Post-Op Home Check", "Chronic Care Check-In"],
  "bakery-food": ["Wedding Cake Package", "Corporate Breakfast Box", "Allergy-Safe Cupcakes", "Allergen Protocol Bake", "Holiday Cookie Platter"],
  "law-office": ["Mediation Session", "Family Law Retainer", "Prenup Package", "Landlord Lease Review", "Trademark Watch Setup"]
};

/** Menu-builder presets: catalog + inputs + pricebook keys applied together. */
const MENU_BUILDER_PRESETS = {
  "bakery-food:allergy-safe-cupcakes": {
    description: "Allergy-aware cupcake bake with dedicated utensils, labeling, and surcharge.",
    aliases: ["allergy safe cupcakes", "allergen cupcakes", "nut-free cupcakes"],
    defaultHours: 3,
    relatedApis: ["bakery-order-profile", "bakery-allergen-check", "bakery-production-estimate"],
    calculation: {
      formula: "(productionHours × hourlyRate + ingredientCost + allergenSurcharge + deliveryFee) × 1.45",
      summary: "Bakery production with allergen surcharge baked into the quote.",
      notes: ["Runs bakery-allergen-check before production.", "Label packaging and confirm ingredients."]
    },
    inputOverride: {
      add: [
        {
          key: "dietaryNotes",
          label: "Any allergen or dietary requirements?",
          type: "string",
          required: true,
          askedOfUser: true,
          notes: "Required for allergen protocol bakes."
        },
        {
          key: "allergenSurcharge",
          label: "Allergen protocol surcharge",
          type: "currency",
          required: false,
          askedOfUser: false,
          notes: "Defaults from pricing standards."
        }
      ],
      remove: [],
      patch: { dietaryNotes: { required: true, askedOfUser: true } }
    },
    unitPrices: { allergenSurcharge: 18, perServing: 7.25 }
  },
  "bakery-food:allergen-protocol-bake": {
    description: "Dedicated allergen-controlled bake protocol with surcharge and compliance checklist.",
    aliases: ["allergen protocol", "allergy protocol bake"],
    defaultHours: 4,
    relatedApis: ["bakery-allergen-check", "bakery-production-estimate"],
    calculation: {
      formula: "(productionHours × hourlyRate + ingredientCost + allergenSurcharge) × 1.45 × rushMultiplier?",
      summary: "Allergen protocol bake with compliance surcharge.",
      notes: ["Always collect dietaryNotes.", "Verify cottage-food / health rules before sale."]
    },
    inputOverride: {
      add: [{
        key: "dietaryNotes",
        label: "Allergen / dietary protocol notes",
        type: "string",
        required: true,
        askedOfUser: true
      }],
      remove: [],
      patch: {}
    },
    unitPrices: { allergenSurcharge: 24 }
  },
  "law-office:family-law-retainer": {
    description: "Family-law retainer engagement with prepaid hours and replenishment threshold.",
    aliases: ["family retainer", "divorce retainer", "retainer agreement"],
    defaultHours: 10,
    relatedApis: ["law-office-matter-profile", "law-office-retainer-estimate"],
    calculation: {
      formula: "max(retainerMinimum, billableHours × roleHourlyRate × 1.25)",
      summary: "Retainer-floor family law engagement.",
      notes: ["Practice area defaults to family.", "Replenish when trust balance hits 25%."]
    },
    inputOverride: {
      add: [{
        key: "retainerAmount",
        label: "What retainer amount should be proposed?",
        type: "currency",
        required: true,
        askedOfUser: false,
        notes: "Defaults to retainerMinimum from pricebook."
      }],
      remove: [],
      patch: {
        practiceArea: { example: "family" },
        retainerAmount: { required: true }
      }
    },
    unitPrices: { retainerMinimum: 2500, consultationFee: 175 }
  }
};

function menuPresetFor(category, serviceNameOrId) {
  const id = slugifyServiceId(serviceNameOrId);
  return MENU_BUILDER_PRESETS[`${category}:${id}`] || null;
}

function mergeUnitPricesIntoStandards(category, unitPrices = {}) {
  if (!unitPrices || !Object.keys(unitPrices).length) return null;
  const current = getPricingStandards(category);
  const defaults = {
    ...(current.defaults || {}),
    unitPrices: {
      ...(current.defaults?.unitPrices || {}),
      ...unitPrices
    }
  };
  const areas = { ...(current.areas || {}) };
  for (const [areaName, area] of Object.entries(areas)) {
    areas[areaName] = {
      ...area,
      unitPrices: {
        ...(area.unitPrices || {}),
        ...unitPrices
      }
    };
  }
  return savePricingStandards(category, {
    ...current,
    defaults,
    areas,
    meta: {
      ...(current.meta || {}),
      source: "service-advisor-menu-builder",
      lastAdvisorPricingAt: new Date().toISOString()
    }
  }, { bumpVersion: true });
}

export function listSuggestedServices(category, { limit = 4, excludeExisting = true } = {}) {
  const docs = getServiceDocs(category);
  const existing = new Set(
    (docs.services || []).flatMap(service => [
      slugifyServiceId(service.id),
      slugifyServiceId(service.name),
      slugifyServiceId(service.quoteKey || "")
    ])
  );
  const pool = CATEGORY_SERVICE_SUGGESTIONS[category] || [
    "Premium Service Package",
    "Express Service Visit",
    "Maintenance Agreement",
    "Emergency Callout"
  ];
  const suggestions = [];
  for (const name of pool) {
    const id = slugifyServiceId(name);
    if (excludeExisting && (existing.has(id) || existing.has(slugifyServiceId(name)))) continue;
    suggestions.push({
      id,
      name,
      label: name,
      prompt: `Add service "${name}" to ${docs.label}`,
      description: `${name} for ${docs.label.toLowerCase()} customers, scoped for guided quoting and automation.`
    });
    if (suggestions.length >= limit) break;
  }
  // If catalog already has all defaults, still return named ideas with unique suffixes skipped —
  // fall back to first pool entries marked as existing so UI is never empty "Add".
  if (!suggestions.length) {
    return pool.slice(0, limit).map(name => ({
      id: slugifyServiceId(name),
      name,
      label: name,
      prompt: `Suggest improving or adding "${name}" for ${docs.label}`,
      description: `${name} idea for ${docs.label}`,
      alreadyExists: true
    }));
  }
  return suggestions;
}

function buildAddServiceRecommendation(category, name, docs) {
  const id = slugifyServiceId(name);
  const preset = menuPresetFor(category, name);
  const categoryCalc = docs.categoryCalculation || {};
  const description = preset?.description
    || `${name} for ${docs.label.toLowerCase()} customers, scoped for guided quoting and automation.`;
  const calculation = preset?.calculation || (categoryCalc.formula ? {
    formula: categoryCalc.formula,
    summary: `${name} uses the ${docs.label} category calculation with service-specific defaults.`,
    notes: [`Added via Services AI advisor for ${category}.`]
  } : null);
  return makeRecommendation({
    type: "add_service",
    category,
    serviceId: id,
    title: name,
    rationale: preset
      ? `Menu-builder preset for ${docs.label}: adds “${name}” with inputs and pricebook updates.`
      : `Suggested ${docs.label} service: add “${name}” to the catalog.`,
    preview: {
      name,
      description,
      formula: calculation?.formula || categoryCalc.formula,
      after: description,
      unitPrices: preset?.unitPrices || null,
      menuBuilder: Boolean(preset)
    },
    patch: {
      service: {
        id,
        name,
        description,
        aliases: preset?.aliases || [name.toLowerCase()],
        billingUnit: preset?.unitPrices?.retainerMinimum ? "retainer" : "job",
        defaultHours: preset?.defaultHours ?? 3,
        quoteKey: name.toLowerCase(),
        inGuidedWorkflow: true,
        relatedApis: preset?.relatedApis || docs.services[0]?.relatedApis?.slice(0, 2) || []
      },
      calculation,
      inputOverride: preset?.inputOverride || null,
      unitPrices: preset?.unitPrices || null
    }
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function sessionView(session) {
  return {
    sessionId: session.id,
    category: session.category,
    serviceId: session.serviceId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messages: session.messages,
    recommendations: session.recommendations,
    aiEnabled: Boolean(client)
  };
}

function ensureSession({ sessionId, category, serviceId } = {}) {
  if (sessionId && sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (category) existing.category = category;
    if (serviceId !== undefined) existing.serviceId = serviceId || null;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  if (!category) throw badRequest("category is required");
  const session = {
    id: sessionId || uid("svcchat"),
    category,
    serviceId: serviceId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [{
      role: "assistant",
      text: `I can help improve the ${category} service catalog. Ask me to suggest a new service, tighten a description, update a formula, or check input variables. Accept a recommendation to apply it.`
    }],
    recommendations: []
  };
  sessions.set(session.id, session);
  return session;
}

function resolveFocusService(category, serviceId, message = "") {
  const docs = getServiceDocs(category);
  if (serviceId) {
    return docs.services.find(item => item.id === serviceId || item.name === serviceId) || null;
  }
  const matched = matchServiceFromText(category, message);
  if (!matched) return null;
  return docs.services.find(item => item.id === matched.id) || null;
}

function extractQuotedName(message = "") {
  const quoted = message.match(/["“]([^"”]{2,80})["”]/);
  if (quoted) return quoted[1].trim();
  const addMatch = message.match(/\b(?:add|create|new service(?: called| named)?)\s+([a-z0-9][\w\s/-]{1,60})/i);
  if (addMatch) {
    return addMatch[1].replace(/\b(service|please|for|with).*$/i, "").trim();
  }
  return null;
}

function validateInputs(service) {
  const issues = [];
  const keys = new Set((service.inputs || []).map(item => item.key));
  if (!keys.has("serviceType") && !keys.has("projectType")) {
    issues.push({
      severity: "warn",
      code: "missing_service_type",
      message: "No serviceType/projectType input is present for this service."
    });
  }
  if (!keys.has("estimatedHours") && !keys.has("visitMinutes") && !keys.has("guestCount")) {
    issues.push({
      severity: "error",
      code: "missing_quantity",
      message: "Missing a quantity driver (estimatedHours, visitMinutes, or guestCount)."
    });
  }
  const formula = `${service.calculation?.formula || ""} ${service.calculation?.summary || ""}`.toLowerCase();
  for (const token of ["hourlyrate", "materialcost", "crewsize", "retaineramount", "disposalcost", "distanceMiles".toLowerCase()]) {
    if (formula.includes(token.toLowerCase()) && ![...keys].some(key => key.toLowerCase() === token.toLowerCase())) {
      // map camel variations
    }
  }
  const formulaVars = (service.calculation?.formula || "").match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  const ignore = new Set(["max", "min", "ceil", "floor", "and", "or", "where", "approx", "fee", "fees"]);
  for (const raw of formulaVars) {
    const key = raw;
    if (ignore.has(key.toLowerCase())) continue;
    if (/^\d/.test(key)) continue;
    if (COMMON_INPUT_KEYS.has(key) || keys.has(key)) continue;
    // Allow common composed names that map loosely
    const aliases = {
      billableHours: "estimatedHours",
      productionHours: "estimatedHours",
      roleHourlyRate: "hourlyRate",
      roleRate: "hourlyRate",
      packingMaterials: "materialCost",
      ingredientCost: "materialCost",
      supplyCost: "materialCost",
      filingFees: "materialCost",
      diagnosticFee: "materialCost",
      appearanceFee: "retainerAmount",
      consultationFee: "retainerAmount",
      retainerMinimum: "retainerAmount",
      fuelCost: "distanceMiles",
      tolls: "distanceMiles",
      deliveryFee: "fulfillment",
      rushMultiplier: "urgency",
      markupMultiplier: "markupMultiplier",
      urgencyMultiplier: "urgency",
      acuityFactor: "acuityLevel",
      buildingSqft: "serviceAddress",
      acres: "serviceAddress",
      waterHeaterInstall: "materialCost",
      panelUpgrade: "materialCost",
      evChargerInstall: "materialCost"
    };
    if (aliases[key] && keys.has(aliases[key])) continue;
    if (/sqft|acres|miles|tons|gallons/i.test(key)) continue;
    issues.push({
      severity: "warn",
      code: "formula_var_unmapped",
      message: `Formula references "${key}" which is not a documented input variable.`,
      variable: key
    });
  }

  const asked = (service.inputs || []).filter(item => item.askedOfUser && item.required);
  if (asked.length === 0) {
    issues.push({
      severity: "info",
      code: "no_user_prompt",
      message: "No required user-facing inputs; quoting relies entirely on autofill."
    });
  }

  return issues;
}

function makeRecommendation(partial) {
  return {
    id: uid("rec"),
    status: "pending",
    createdAt: new Date().toISOString(),
    ...partial
  };
}

function localRecommendations({ category, service, message }) {
  const text = String(message || "").toLowerCase();
  const recs = [];
  const docs = getServiceDocs(category);
  const focus = service || docs.services[0] || null;

  const wantsAdd = /\b(add|create|new)\b/.test(text) && /\b(service|offering|product)\b/.test(text)
    || /\bsuggest\b/.test(text) && /\b(service|add)\b/.test(text)
    || Boolean(extractQuotedName(message) && /\b(add|create|new)\b/.test(text));
  const wantsDesc = /\b(description|wording|copy|rename)\b/.test(text) || /\bupdate\b/.test(text) && /\bdescribe|description\b/.test(text);
  const wantsCalc = /\b(formula|calculation|pricing|price|markup|retainer)\b/.test(text);
  const wantsInputs = /\b(input|variable|fields?|required|missing)\b/.test(text) || /\bcheck\b/.test(text);

  if (wantsAdd || (!wantsDesc && !wantsCalc && !wantsInputs && /\bsuggest\b/.test(text))) {
    const quoted = extractQuotedName(message);
    const namedSuggestions = quoted
      ? [{ name: quoted }]
      : listSuggestedServices(category, { limit: 3, excludeExisting: true });
    for (const item of namedSuggestions) {
      const name = item.name || item;
      const id = slugifyServiceId(name);
      if (docs.services.some(service => service.id === id || slugifyServiceId(service.name) === id)) continue;
      recs.push(buildAddServiceRecommendation(category, name, docs));
    }
  }

  if (focus && (wantsDesc || (!wantsAdd && !wantsCalc && !wantsInputs))) {
    const improved = focus.description?.length > 40
      ? focus.description.replace(/\.\s*$/, "") + " Includes scope confirmation, required inputs, and a transparent price calculation."
      : `${focus.name} for ${docs.label} — clear scope, required intake inputs, and formula-based quoting.`;
    if (improved !== focus.description) {
      recs.push(makeRecommendation({
        type: "update_description",
        category,
        serviceId: focus.id,
        title: `Update description: ${focus.name}`,
        rationale: "Clarify what the customer receives and that quoting is formula-driven.",
        preview: { before: focus.description, after: improved },
        patch: { description: improved }
      }));
    }
  }

  if (focus && wantsCalc) {
    const base = docs.categoryCalculation || focus.calculation || {};
    const nextFormula = focus.calculation?.scope === "service"
      ? focus.calculation.formula
      : (base.formula || focus.calculation?.formula);
    const nextSummary = `${focus.name} calculation: ${base.summary || focus.calculation?.summary || "category trade estimate."}`;
    recs.push(makeRecommendation({
      type: "update_calculation",
      category,
      serviceId: focus.id,
      title: `Update calculation: ${focus.name}`,
      rationale: "Pin a service-level formula so the Services page and advisor stay aligned with quoting intent.",
      preview: {
        before: focus.calculation?.formula,
        after: nextFormula,
        summary: nextSummary
      },
      patch: {
        calculation: {
          formula: nextFormula,
          summary: nextSummary,
          notes: [
            ...(focus.calculation?.notes || []).slice(0, 2),
            "Reviewed by Services AI advisor."
          ]
        }
      }
    }));
  }

  if (focus && (wantsInputs || /\b(check|review|audit|validate)\b/.test(text))) {
    const issues = validateInputs(focus);
    if (issues.length || wantsInputs) {
      const patch = { add: [], remove: [], patch: {} };
      const keys = new Set(focus.inputs.map(item => item.key));
      if (!keys.has("estimatedHours") && !keys.has("visitMinutes") && !keys.has("guestCount")) {
        patch.add.push({
          key: "estimatedHours",
          label: "How many labor hours are expected?",
          type: "number",
          required: true,
          askedOfUser: false,
          notes: "Added because the formula needs a quantity driver."
        });
      }
      if (/\bretainer|divorce|appearance|consultation\b/i.test(`${focus.id} ${focus.name} ${focus.calculation?.formula || ""}`)
        && !keys.has("retainerAmount")) {
        patch.add.push({
          key: "retainerAmount",
          label: "What retainer amount should be proposed (if any)?",
          type: "currency",
          required: false,
          askedOfUser: false,
          notes: "Supports retainer-floor pricing language in the formula."
        });
      }
      if (category === "transportation" && /move|delivery|freight|haul/i.test(`${focus.id} ${focus.name}`)) {
        for (const key of ["pickupAddress", "dropoffAddress", "distanceMiles"]) {
          if (!keys.has(key)) {
            patch.add.push({
              key,
              label: key === "pickupAddress" ? "FROM (pickup) address"
                : key === "dropoffAddress" ? "TO (dropoff) address"
                  : "Estimated trip distance in miles",
              type: key.includes("Address") ? "string" : "number",
              required: true,
              askedOfUser: key.includes("Address"),
              notes: "Shipping services need route inputs."
            });
          }
        }
      }

      recs.push(makeRecommendation({
        type: "fix_inputs",
        category,
        serviceId: focus.id,
        title: `Check inputs: ${focus.name}`,
        rationale: issues.length
          ? `Found ${issues.length} input/formula alignment issue(s).`
          : "Inputs look mostly aligned; optional hardening suggested.",
        preview: {
          issues,
          proposedAdds: patch.add.map(item => item.key)
        },
        patch: { inputOverride: patch, issues }
      }));
    }
  }

  // Deduplicate by type+serviceId
  const seen = new Set();
  return recs.filter(rec => {
    const key = `${rec.type}:${rec.serviceId || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

async function aiRecommendations({ category, service, message, history }) {
  if (!client) return null;
  const docs = getServiceDocs(category);
  const compact = {
    category,
    label: docs.label,
    categoryCalculation: docs.categoryCalculation,
    focusService: service ? {
      id: service.id,
      name: service.name,
      description: service.description,
      inputs: service.inputs?.map(i => ({ key: i.key, required: i.required, askedOfUser: i.askedOfUser, type: i.type })),
      calculation: service.calculation
    } : null,
    existingServiceNames: docs.services.map(item => item.name).slice(0, 40)
  };

  try {
    const response = await client.responses.create({
      model: appConfig.ai.model,
      instructions: `You are the HA-Corr Services catalog advisor. Propose concrete catalog improvements.
Return 1-3 recommendations via the propose_service_changes tool.
Types: add_service, update_description, update_calculation, fix_inputs.
For fix_inputs include inputOverride {add,remove,patch} and issues[].
Only suggest add_service when the service does not already exist.
Keep formulas readable and tied to documented input keys.`,
      input: [
        { role: "user", content: `Catalog context:\n${JSON.stringify(compact)}` },
        ...history.slice(-6).map(item => ({ role: item.role, content: item.text })),
        { role: "user", content: message }
      ],
      tools: [{
        type: "function",
        name: "propose_service_changes",
        description: "Propose service catalog recommendations.",
        strict: false,
        parameters: {
          type: "object",
          properties: {
            reply: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["add_service", "update_description", "update_calculation", "fix_inputs"] },
                  serviceId: { type: "string" },
                  title: { type: "string" },
                  rationale: { type: "string" },
                  patch: { type: "object" },
                  preview: { type: "object" }
                },
                required: ["type", "title", "rationale"]
              }
            }
          },
          required: ["reply", "recommendations"]
        }
      }],
      tool_choice: { type: "function", name: "propose_service_changes" }
    });

    const call = response.output?.find(item => item.type === "function_call" && item.name === "propose_service_changes");
    if (!call) return null;
    const args = JSON.parse(call.arguments || "{}");
    const recommendations = (args.recommendations || []).map(item => {
      const serviceName = item.patch?.service?.name
        || item.preview?.name
        || (item.type === "add_service" ? String(item.title || "").replace(/^add(?:\s+service)?\s*:?\s*/i, "").trim() : null)
        || service?.name
        || null;
      const title = item.type === "add_service" && serviceName
        ? serviceName
        : (item.title || serviceName || "Catalog update");
      const preview = {
        ...(item.preview || item.patch || {}),
        name: serviceName || item.preview?.name || null
      };
      if (serviceName && !preview.after && item.type === "add_service") {
        preview.after = item.patch?.service?.description || preview.description || serviceName;
      }
      return makeRecommendation({
        type: item.type,
        category,
        serviceId: item.serviceId || item.patch?.service?.id || slugifyServiceId(serviceName || "") || service?.id || null,
        title,
        rationale: item.rationale,
        preview,
        patch: item.patch || {}
      });
    });
    return {
      reply: args.reply || "Here are recommended catalog updates.",
      recommendations,
      mode: "openai"
    };
  } catch (error) {
    console.warn("Services advisor AI failed; using local recommendations:", error.message);
    return null;
  }
}

function replyFromRecommendations(category, recommendations, mode) {
  if (!recommendations.length) {
    return {
      reply: `No concrete catalog changes suggested yet for ${category}. Try a suggested service chip, or ask to update a description, improve a formula, or check inputs.`,
      mode
    };
  }
  const lines = recommendations.map((rec, index) => {
    const name = rec.preview?.name || rec.patch?.service?.name || rec.title;
    const kind = rec.type === "add_service" ? "Add" : rec.type.replace(/_/g, " ");
    return `${index + 1}. ${name} (${kind}) — ${rec.rationale}`;
  });
  return {
    reply: `I have ${recommendations.length} recommendation(s) you can apply:\n\n${lines.join("\n")}\n\nClick Apply on a card (or say “apply 1”) to update the service catalog.`,
    mode
  };
}

export async function chatServiceAdvisor(body = {}) {
  const category = body.category;
  if (!category) throw badRequest("category is required");
  const message = String(body.message || "").trim();
  if (!message) throw badRequest("message is required");

  const session = ensureSession({
    sessionId: body.sessionId,
    category,
    serviceId: body.serviceId
  });

  // Allow "apply 1" / "execute recommendation 2" from chat
  const applyMatch = message.match(/^(?:apply|execute|accept)\s*(?:recommendation\s*)?#?(\d+)\s*$/i);
  if (applyMatch) {
    const pending = session.recommendations.filter(item => item.status === "pending");
    const rec = pending[Number(applyMatch[1]) - 1];
    if (!rec) throw badRequest("No pending recommendation at that number");
    return applyServiceRecommendation({ sessionId: session.id, recommendationId: rec.id });
  }

  const focus = resolveFocusService(session.category, session.serviceId || body.serviceId, message);
  if (focus) session.serviceId = focus.id;

  session.messages.push({ role: "user", text: message });

  let ai = await aiRecommendations({
    category: session.category,
    service: focus,
    message,
    history: session.messages
  });

  if (!ai) {
    const recommendations = localRecommendations({
      category: session.category,
      service: focus,
      message
    });
    const packed = replyFromRecommendations(session.category, recommendations, client ? "fallback" : "local");
    ai = { ...packed, recommendations };
  }

  // Replace pending recommendations with the latest batch (keep applied history)
  const kept = session.recommendations.filter(item => item.status !== "pending");
  session.recommendations = [...kept, ...(ai.recommendations || [])];
  session.messages.push({ role: "assistant", text: ai.reply });
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);

  return {
    ...sessionView(session),
    reply: ai.reply,
    mode: ai.mode,
    focusServiceId: session.serviceId,
    pendingCount: session.recommendations.filter(item => item.status === "pending").length
  };
}

export function getServiceAdvisorSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw notFound(`Advisor session not found: ${sessionId}`);
  return sessionView(session);
}

export function applyServiceRecommendation(body = {}) {
  const session = sessions.get(body.sessionId);
  if (!session) throw notFound("Advisor session not found");
  const rec = session.recommendations.find(item => item.id === body.recommendationId);
  if (!rec) throw notFound("Recommendation not found");
  if (rec.status === "applied") {
    return {
      ...sessionView(session),
      applied: rec,
      docs: getServiceDocs(session.category),
      catalog: listServiceDocs()
    };
  }
  if (rec.status === "dismissed") throw badRequest("Recommendation was dismissed");

  const category = rec.category || session.category;
  let result = null;

  if (rec.type === "add_service") {
    const servicePatch = rec.patch?.service || {};
    result = upsertCatalogService(category, servicePatch);
    if (rec.patch?.calculation?.formula) {
      setFormulaOverride(category, result.service.id, rec.patch.calculation);
    }
    if (rec.patch?.inputOverride) {
      mergeInputOverride(category, result.service.id, rec.patch.inputOverride);
    }
    let pricing = null;
    if (rec.patch?.unitPrices) {
      pricing = mergeUnitPricesIntoStandards(category, rec.patch.unitPrices);
    }
    result = { ...result, pricingUpdated: Boolean(pricing), unitPrices: rec.patch?.unitPrices || null };
    session.serviceId = result.service.id;
  } else if (rec.type === "update_pricing" || rec.type === "menu_builder") {
    const serviceId = rec.serviceId || session.serviceId;
    if (rec.patch?.service && serviceId) {
      result = upsertCatalogService(category, { id: serviceId, ...rec.patch.service });
    }
    if (rec.patch?.calculation?.formula && serviceId) {
      setFormulaOverride(category, serviceId, rec.patch.calculation);
    }
    if (rec.patch?.inputOverride && serviceId) {
      mergeInputOverride(category, serviceId, rec.patch.inputOverride);
    }
    const pricing = mergeUnitPricesIntoStandards(category, rec.patch?.unitPrices || {});
    result = { category, serviceId, pricing, unitPrices: rec.patch?.unitPrices || null };
  } else if (rec.type === "update_description") {
    const serviceId = rec.serviceId || session.serviceId;
    if (!serviceId) throw badRequest("serviceId required for description update");
    result = patchCatalogService(category, serviceId, {
      description: rec.patch?.description,
      name: rec.patch?.name,
      aliases: rec.patch?.aliases
    });
  } else if (rec.type === "update_calculation") {
    const serviceId = rec.serviceId || session.serviceId;
    if (!serviceId) throw badRequest("serviceId required for calculation update");
    const calculation = rec.patch?.calculation || rec.patch || {};
    if (!calculation.formula) throw badRequest("calculation.formula is required");
    setFormulaOverride(category, serviceId, calculation);
    // Keep catalog description/hours in sync when provided
    if (rec.patch?.defaultHours != null || rec.patch?.description) {
      result = patchCatalogService(category, serviceId, {
        defaultHours: rec.patch.defaultHours,
        description: rec.patch.description
      });
    } else {
      result = { category, service: { id: serviceId }, calculation };
    }
  } else if (rec.type === "fix_inputs") {
    const serviceId = rec.serviceId || session.serviceId;
    if (!serviceId) throw badRequest("serviceId required for input fixes");
    const inputOverride = rec.patch?.inputOverride || rec.patch || {};
    mergeInputOverride(category, serviceId, inputOverride);
    result = { category, service: { id: serviceId }, inputOverride };
  } else {
    throw badRequest(`Unsupported recommendation type: ${rec.type}`);
  }

  rec.status = "applied";
  rec.appliedAt = new Date().toISOString();
  rec.result = result;
  session.updatedAt = new Date().toISOString();
  const pricingNote = result?.pricingUpdated || result?.pricing
    ? " Pricebook (pricing-standards) was updated too."
    : "";
  session.messages.push({
    role: "assistant",
    text: `Applied: ${rec.title}. The ${category} service catalog is updated.${pricingNote}`
  });
  sessions.set(session.id, session);

  const docs = getServiceDocs(category);
  return {
    ...sessionView(session),
    reply: `Applied: ${rec.title}.${pricingNote}`,
    applied: rec,
    docs,
    catalog: listServiceDocs(),
    pricing: result?.pricing || null
  };
}

export function dismissServiceRecommendation(body = {}) {
  const session = sessions.get(body.sessionId);
  if (!session) throw notFound("Advisor session not found");
  const rec = session.recommendations.find(item => item.id === body.recommendationId);
  if (!rec) throw notFound("Recommendation not found");
  rec.status = "dismissed";
  rec.dismissedAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();
  sessions.set(session.id, session);
  return sessionView(session);
}
