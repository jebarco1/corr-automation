import { listServiceCatalogs, listServices } from "./serviceCatalog.js";
import { getGuidedFlow } from "./guidedWorkflow.js";

/** Category-level pricing formulas used by automation / guided quoting. */
const categoryFormulas = {
  landscape: {
    formula: "(estimatedHours × crewSize × hourlyRate + acres × $35) × 1.35",
    summary: "Labor and acreage allowance, then standard trade markup.",
    notes: [
      "Default hours ≈ lot square feet / 4000 when parcel data is available.",
      "Mowing can also be priced from area rates ($/1,000 sqft) in pricing standards."
    ]
  },
  hvac: {
    formula: "(estimatedHours × hourlyRate) + materialCost  →  invoice; replacement uses equipment estimate × 1.35",
    summary: "Diagnostics use a visit fee; replacements use tonnage-based equipment pricing.",
    notes: [
      "Diagnostic default ≈ diagnosticFee (~$89) plus labor beyond the first hour.",
      "Replacement: (tons × $2,200 + $2,500) × 1.35 where tons ≈ buildingSqft / 600."
    ]
  },
  cleaning: {
    formula: "(laborCost + supplyCost) × 1.45",
    summary: "Hours from area production rate, then labor + supplies with cleaning markup.",
    notes: [
      "Hours ≈ squareFeet / 2200 + bathrooms × 0.2 + rooms × 0.05.",
      "Deep clean can apply a deepCleanMultiplier (~1.6) on hours or price."
    ]
  },
  "pest-control": {
    formula: "(estimatedHours × hourlyRate × crewSize + materialCost) × 1.35",
    summary: "Standard trade estimate with pest material allowance.",
    notes: [
      "One-time, recurring, and termite bond services may use flat rates from pricing standards."
    ]
  },
  pool: {
    formula: "(estimatedHours × hourlyRate × crewSize + materialCost) × 1.35",
    summary: "Labor plus chemicals/parts with trade markup.",
    notes: [
      "Weekly service may use a flat weeklyService rate; chemistry helpers estimate dosing separately."
    ]
  },
  painting: {
    formula: "(estimatedHours × hourlyRate × crewSize + materialCost) × 1.35",
    summary: "Area-driven labor and paint materials with trade markup.",
    notes: [
      "Gallons ≈ ceil(area / coverageSqftPerGallon × coats).",
      "Default hours ≈ squareFeet / 150; materials ≈ squareFeet × $/sqft × 0.35."
    ]
  },
  roofing: {
    formula: "(estimatedHours × hourlyRate × crewSize + materialCost) × 1.35",
    summary: "Squares-based material takeoff plus labor, then markup.",
    notes: [
      "Roof sqft ≈ footprint × pitchFactor (~1.12); squares = roofSqft / 100.",
      "Inspection/repair skip full replacement estimate triggers."
    ]
  },
  plumbing: {
    formula: "(estimatedHours × hourlyRate + materialCost) × urgencyMultiplier",
    summary: "Labor and parts; emergency urgency multiplies price (~1.5).",
    notes: [
      "Water heater installs may use a flat waterHeaterInstall material default.",
      "Diagnostics lean on diagnosticFee + short labor."
    ]
  },
  electrical: {
    formula: "(estimatedHours × hourlyRate + materialCost) × 1.35",
    summary: "Labor and equipment/materials with trade markup.",
    notes: [
      "Panel upgrade / EV charger use flat material defaults from pricing standards.",
      "Upgrade estimate is skipped for diagnostic/repair/inspect service types."
    ]
  },
  "general-contract": {
    formula: "(estimatedHours × hourlyRate + materialCost + equipmentCost) × markupMultiplier",
    summary: "Project estimate with configurable markup (default 1.35).",
    notes: [
      "Materials can be seeded from remodelPerSqft × squareFeet × 0.45."
    ]
  },
  surveillance: {
    formula: "(estimatedHours × hourlyRate × crewSize + materialCost) × 1.35",
    summary: "Install labor plus camera/NVR equipment with markup.",
    notes: [
      "Materials ≈ nvrBase + cameraCount × cameraInstallEach.",
      "Storage TB ≈ cameraCount × bitrateMbps × 86400 × retentionDays / (8×10^6)."
    ]
  },
  "trash-removal": {
    formula: "(estimatedHours × hourlyRate × crewSize + disposalCost + materialCost) × 1.35",
    summary: "Haul labor plus disposal/tipping fees with markup.",
    notes: [
      "Disposal ≈ volumeCubicYards × perCubicYard; haulMinimum may floor the price."
    ]
  },
  transportation: {
    formula: "(estimatedHours × hourlyRate × crewSize + packingMaterials + fuelCost + tolls) × 1.35",
    summary: "Move/delivery labor, materials, fuel, and tolls with markup.",
    notes: [
      "Default hours ≈ distanceMiles / 22 + volumeCubicFeet / 180.",
      "Fuel ≈ miles × fuelCostPerMile; local moves may enforce localMoveMinimum."
    ]
  },
  healthcare: {
    formula: "(visitMinutes / 60 × acuityFactor × roleRate × crewSize + supplyCost + travel) × 1.25",
    summary: "Clinical hours by role and acuity, plus supplies/travel, healthcare markup.",
    notes: [
      "Acuity factor: low 0.85, moderate 1.0, high/critical 1.45.",
      "Role rates differ for RN vs physician; travel ≈ miles × travelRatePerMile."
    ]
  },
  "bakery-food": {
    formula: "(productionHours × hourlyRate + ingredientCost + deliveryFee) × 1.45 × rushMultiplier",
    summary: "Production labor and ingredients with bakery markup (and optional rush).",
    notes: [
      "Hours ≈ guestCount / 18; ingredients ≈ guestCount × perServing × 0.35.",
      "Delivery fee ≈ $25 + miles × $1.50 when fulfillment is delivery; rush ≈ 1.35."
    ]
  },
  "law-office": {
    formula: "(billableHours × roleHourlyRate + filingFees [+ appearanceFee]) × 1.25",
    summary: "Billable attorney/paralegal time with legal markup; retainers use a minimum floor.",
    notes: [
      "Role rates: partner / associate / paralegal from pricing standards.",
      "Retainer matters: suggestedPrice = max(retainerMinimum, calculated price)."
    ]
  }
};

/** Optional per-service formula overrides keyed by `${category}:${serviceId}` or quoteKey. */
const serviceFormulaOverrides = {
  "hvac:diagnostic": {
    formula: "diagnosticFee (+ max(0, estimatedHours − 1) × hourlyRate) [+ materials]",
    summary: "Visit/diagnostic fee first; additional labor billed hourly.",
    notes: ["Replacement estimate APIs are not used for diagnostic visits."]
  },
  "hvac:system-diagnostic": {
    formula: "diagnosticFee (+ max(0, estimatedHours − 1) × hourlyRate) [+ materials]",
    summary: "Visit/diagnostic fee first; additional labor billed hourly."
  },
  "hvac:replacement": {
    formula: "((buildingSqft / 600) × $2,200 + $2,500) × 1.35",
    summary: "Tonnage-based equipment replacement estimate with markup."
  },
  "hvac:system-replacement": {
    formula: "((buildingSqft / 600) × $2,200 + $2,500) × 1.35",
    summary: "Tonnage-based equipment replacement estimate with markup."
  },
  "law-office:divorce": {
    formula: "max(retainerMinimum, billableHours × roleHourlyRate × 1.25)  [hours default 12]",
    summary: "Family-law divorce engagement priced as a retainer-backed matter.",
    notes: ["Practice area defaults to family.", "Appearance fees may apply for hearings."]
  },
  "law-office:family-matter": {
    formula: "max(retainerMinimum, billableHours × roleHourlyRate × 1.25)  [hours default 8–10]",
    summary: "Scoped family-law matter with retainer floor."
  },
  "law-office:retainer-block": {
    formula: "max(retainerMinimum, prepaidHours × roleHourlyRate)",
    summary: "Prepaid hour block / retainer engagement."
  },
  "law-office:court-appearance": {
    formula: "max(appearanceFee, billableHours × roleHourlyRate × 1.25)",
    summary: "Hearing/appearance fee or billable time, whichever applies."
  },
  "law-office:initial-consultation": {
    formula: "max(consultationFee, billableHours × roleHourlyRate × 1.25)",
    summary: "Intake consult with consultation fee floor when configured."
  },
  "transportation:packing": {
    formula: "(estimatedHours × hourlyRate × crewSize + packingMaterials) × 1.35",
    summary: "Packing-only labor and materials (no line-haul fuel/tolls).",
    notes: ["Single service address; pickup/dropoff not required."]
  },
  "transportation:loading-only": {
    formula: "(estimatedHours × hourlyRate × crewSize) × 1.35",
    summary: "Loading labor only at a single site.",
    notes: ["Single service address; pickup/dropoff not required."]
  },
  "bakery-food:rush-order": {
    formula: "(productionHours × hourlyRate + ingredientCost + deliveryFee) × 1.45 × rushMultiplier(~1.35)",
    summary: "Standard bakery formula with rush multiplier."
  },
  "bakery-food:local-delivery": {
    formula: "deliveryFee ≈ $25 + distanceMiles × $1.50",
    summary: "Delivery fee estimate; may combine with product order pricing."
  },
  "plumbing:water-heater": {
    formula: "(estimatedHours × hourlyRate + waterHeaterInstall) × urgencyMultiplier",
    summary: "Labor plus water-heater install material default."
  },
  "electrical:panel-upgrade": {
    formula: "(estimatedHours × hourlyRate + panelUpgrade) × 1.35",
    summary: "Labor plus panel-upgrade equipment default."
  },
  "electrical:ev-charger": {
    formula: "(estimatedHours × hourlyRate + evChargerInstall) × 1.35",
    summary: "Labor plus EV charger install equipment default."
  }
};

function inputFromQuestion(question) {
  return {
    key: question.key,
    label: question.question,
    type: question.type,
    required: question.required !== false,
    askedOfUser: question.ask === true,
    autoFilled: question.ask !== true,
    options: question.options || undefined,
    example: question.example,
    triggerApi: question.trigger || undefined
  };
}

function inputsForService(category, service, questions) {
  let inputs = questions.map(inputFromQuestion);

  if (category === "transportation") {
    const shipping = service.requiresShipping !== false
      && !/packing|loading-only|loading only/i.test(`${service.id} ${service.quoteKey} ${service.name}`);
    if (!shipping) {
      inputs = inputs
        .filter(item => item.key !== "pickupAddress" && item.key !== "dropoffAddress")
        .map(item => (item.key === "serviceAddress" ? { ...item, askedOfUser: true, autoFilled: false, required: true } : item));
    } else {
      inputs = inputs.map(item => {
        if (item.key === "serviceAddress") {
          return {
            ...item,
            required: false,
            askedOfUser: false,
            autoFilled: true,
            label: "Service address (copied from pickup)"
          };
        }
        if (item.key === "pickupAddress") {
          return { ...item, label: "FROM (pickup) address", askedOfUser: true, autoFilled: false, required: true };
        }
        if (item.key === "dropoffAddress") {
          return { ...item, label: "TO (dropoff) address", askedOfUser: true, autoFilled: false, required: true };
        }
        return item;
      });
    }
  }

  if (category === "law-office" && /divorce|family/i.test(`${service.id} ${service.quoteKey}`)) {
    inputs = inputs.map(item => {
      if (item.key === "practiceArea") {
        return { ...item, example: "family", notes: "Defaults to family for divorce/family matters." };
      }
      if (item.key === "retainerAmount") {
        return { ...item, required: true, notes: "Retainer minimum applied for divorce/family matters." };
      }
      return item;
    });
  }

  return inputs;
}

function formulaForService(category, service) {
  const byId = serviceFormulaOverrides[`${category}:${service.id}`];
  const byKey = service.quoteKey
    ? serviceFormulaOverrides[`${category}:${String(service.quoteKey).replace(/\s+/g, "-")}`]
    : null;
  const base = categoryFormulas[category] || {
    formula: "(estimatedHours × hourlyRate × crewSize + materials + fees) × markupMultiplier",
    summary: "Category trade estimate with configured markup.",
    notes: []
  };
  const override = byId || byKey;
  if (!override) return { ...base, scope: "category" };
  return {
    formula: override.formula || base.formula,
    summary: override.summary || base.summary,
    notes: [...(override.notes || []), ...(base.notes || [])].filter(Boolean),
    scope: "service"
  };
}

function documentService(category, service, questions) {
  const formula = formulaForService(category, service);
  return {
    id: service.id,
    name: service.name,
    description: service.description || "",
    quoteKey: service.quoteKey || null,
    billingUnit: service.billingUnit || null,
    defaultHours: service.defaultHours ?? null,
    typicalFrequency: service.typicalFrequency || [],
    propertyTypes: service.propertyTypes || [],
    aliases: service.aliases || [],
    relatedApis: service.relatedApis || [],
    inGuidedWorkflow: !!service.inGuidedWorkflow,
    active: service.active !== false,
    requiresShipping: service.requiresShipping,
    inputs: inputsForService(category, service, questions),
    calculation: {
      formula: formula.formula,
      summary: formula.summary,
      notes: formula.notes || [],
      scope: formula.scope
    }
  };
}

export function listServiceDocs() {
  const index = listServiceCatalogs();
  const categories = (index.categories || []).map(entry => getServiceDocs(entry.category));
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    count: categories.length,
    totalServices: categories.reduce((sum, item) => sum + item.count, 0),
    categories
  };
}

export function getServiceDocs(category) {
  const catalog = listServices(category);
  const flow = getGuidedFlow(category);
  const questions = flow?.questions || [];
  const services = (catalog.services || [])
    .filter(service => service.active !== false)
    .map(service => documentService(category, service, questions));

  return {
    category: catalog.category,
    label: catalog.label || flow?.label || category,
    description: catalog.description || flow?.description || "",
    defaultServiceId: catalog.defaultServiceId,
    count: services.length,
    categoryInputs: questions.map(inputFromQuestion),
    categoryCalculation: categoryFormulas[category] || null,
    services,
    endpoint: `/api/v1/service-docs/${category}`
  };
}
