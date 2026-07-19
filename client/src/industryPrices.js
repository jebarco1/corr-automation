/** Local industry-standard unit prices used on the landing page (no API call). */
export const industryStandardPrices = {
  landscape: { hourlyRate: 65, mowingPerThousandSqft: 45, mulchPerCubicYard: 55, fertilizationVisit: 85, defaultCrewSize: 2, defaultHours: 3 },
  hvac: { hourlyRate: 125, diagnosticFee: 89, maintenancePlanMonthly: 45, replacementMarkupPercent: 35, defaultCrewSize: 1, defaultHours: 2, materialCost: 450 },
  cleaning: { hourlyRate: 45, perSquareFoot: 0.18, deepCleanMultiplier: 1.6, supplyAllowancePercent: 8, defaultCrewSize: 2, defaultHours: 4 },
  "pest-control": { hourlyRate: 95, oneTimeTreatment: 150, recurringMonthly: 55, termiteBondAnnual: 220, defaultHours: 1.5, materialCost: 65 },
  pool: { hourlyRate: 75, weeklyService: 140, chemicalAllowance: 35, equipmentRepairMultiplier: 1.4, defaultHours: 1.5, materialCost: 35 },
  painting: { hourlyRate: 55, interiorPerSqft: 2.25, exteriorPerSqft: 2.75, materialsMarkupPercent: 25, defaultHours: 16, materialCost: 350 },
  roofing: { hourlyRate: 85, perSquare: 425, repairMinimum: 350, materialsMarkupPercent: 30, defaultHours: 24, materialCost: 2800 },
  plumbing: { hourlyRate: 135, diagnosticFee: 95, waterHeaterInstall: 1400, emergencyMultiplier: 1.5, defaultHours: 2, materialCost: 180 },
  electrical: { hourlyRate: 125, panelUpgrade: 2200, evChargerInstall: 1200, diagnosticFee: 95, defaultHours: 3, materialCost: 320 },
  "general-contract": { hourlyRate: 95, remodelPerSqft: 85, markupMultiplier: 1.35, changeOrderMarkupPercent: 20, defaultHours: 40, materialCost: 4500 },
  surveillance: { hourlyRate: 95, cameraInstallEach: 275, nvrBase: 450, monitoringMonthly: 35, defaultHours: 6, materialCost: 1200 },
  "trash-removal": { hourlyRate: 75, haulMinimum: 175, perCubicYard: 55, dumpsterDay: 45, defaultHours: 3, disposalCost: 120 },
  transportation: { hourlyRate: 75, localMoveMinimum: 250, perMile: 2.75, perCubicFoot: 1.15, crewOfTwoHourly: 150, defaultCrewSize: 2, defaultHours: 4 },
  healthcare: { hourlyRate: 95, nurseVisit: 165, physicianVisit: 285, shiftHourlyRN: 95, shiftHourlyLPN: 72, travelPerMile: 1.25, suppliesPerVisit: 18, defaultHours: 1 },
  "bakery-food": { hourlyRate: 55, cakeBase: 85, perServing: 6.5, cateringTray: 95, wholesaleLoaf: 4.25, deliveryFee: 25, rushMultiplier: 1.35, allergenSurcharge: 18, defaultHours: 4 },
  "law-office": { hourlyRate: 275, partnerHourly: 375, associateHourly: 225, paralegalHourly: 125, consultationFee: 150, retainerMinimum: 1500, appearanceFee: 450, documentFlat: 350, defaultHours: 2 }
};

export const defaultMarketArea = "Atlanta, GA";

export function getIndustryPrices(category) {
  return industryStandardPrices[category] || { hourlyRate: 85, defaultHours: 2, defaultCrewSize: 1 };
}

export function formatPriceLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, c => c.toUpperCase())
    .replace(/Per /g, "per ")
    .replace(/Sqft/g, "sqft");
}

function numberFromPrompt(prompt, patterns, fallback) {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) return Number(String(match[1]).replace(/,/g, ""));
  }
  return fallback;
}

function pickOption(prompt, options = [], fallback) {
  const text = prompt.toLowerCase();
  const found = options.find(option => text.includes(String(option).toLowerCase()));
  return found || fallback || options[0] || "";
}

function detectPropertyType(prompt) {
  const text = prompt.toLowerCase();
  if (text.includes("hoa")) return "hoa";
  if (text.includes("commercial") || text.includes("office") || text.includes("retail") || text.includes("facility")) return "commercial";
  if (text.includes("apartment") || text.includes("multi")) return "multi-family";
  if (text.includes("industrial") || text.includes("warehouse")) return "industrial";
  return "residential";
}

/** Build auto-walkthrough answers from chat prompt + industry standard prices. */
export function buildAutoAnswers(categoryDef, promptText = "", prices = {}) {
  const prompt = String(promptText || categoryDef?.prompts?.[0] || "").trim();
  const answers = {
    customer: {
      name: "Alex Rivera",
      email: "alex.rivera@example.com",
      phone: "404-555-0148"
    },
    serviceAddress: `${defaultMarketArea.replace(", ", " Peachtree St, ") } 30303`.replace("Atlanta Peachtree St, GA", "123 Peachtree St, Atlanta, GA"),
    propertyType: detectPropertyType(prompt),
    requestedDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    crewSize: prices.defaultCrewSize || 2,
    estimatedHours: prices.defaultHours || 2,
    hourlyRate: prices.hourlyRate || 85,
    materialCost: prices.materialCost || 0,
    disposalCost: prices.disposalCost || 0,
    markupMultiplier: prices.markupMultiplier || 1.35
  };

  // Normalize a nicer Atlanta address
  answers.serviceAddress = "123 Peachtree St, Atlanta, GA 30303";

  if (categoryDef?.category === "landscape") {
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft)/i], 8000);
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "mowing");
    answers.estimatedHours = Math.max(1, Number((answers.squareFeet / 4000).toFixed(1)));
  }

  if (categoryDef?.category === "hvac") {
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft|ton)/i], 2200);
    answers.systemType = pickOption(prompt, ["split system", "heat pump", "rooftop unit", "boiler", "chiller", "air handler", "other"], "split system");
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "diagnostic");
    if (/replac/i.test(prompt)) {
      answers.serviceType = "replacement";
      answers.materialCost = 4500;
      answers.estimatedHours = 6;
    } else if (/install/i.test(prompt)) {
      answers.serviceType = "installation";
      answers.materialCost = 1200;
      answers.estimatedHours = 4;
    } else {
      answers.materialCost = 0;
      answers.estimatedHours = answers.serviceType === "maintenance" ? 1.5 : 1;
      answers.diagnosticFee = prices.diagnosticFee || 89;
      answers.hourlyRate = prices.hourlyRate || 125;
    }
  }

  if (categoryDef?.category === "cleaning") {
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft)/i], 2500);
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "recurring janitorial");
    answers.frequency = pickOption(prompt, ["one-time", "daily", "weekly", "biweekly", "monthly"], "weekly");
    answers.estimatedHours = Math.max(1, Number((answers.squareFeet * (prices.perSquareFoot || 0.18) / (prices.hourlyRate || 45)).toFixed(1)));
  }

  if (categoryDef?.category === "pest-control") {
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft)/i], 2200);
    answers.pestType = pickOption(prompt, categoryDef.questions.find(q => q.key === "pestType")?.options, "general insects");
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "one-time treatment");
    answers.materialCost = prices.materialCost || prices.oneTimeTreatment || 65;
  }

  if (categoryDef?.category === "pool") {
    answers.poolGallons = numberFromPrompt(prompt, [/([\d,]+)\s*gallons?/i], 15000);
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "weekly service");
    answers.materialCost = prices.chemicalAllowance || 35;
  }

  if (categoryDef?.category === "painting") {
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft)/i], 1800);
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "interior");
    answers.coats = numberFromPrompt(prompt, [/(\d+)\s*coats?/i], 2);
    answers.materialCost = Math.round(answers.squareFeet * (answers.serviceType === "exterior" ? prices.exteriorPerSqft || 2.75 : prices.interiorPerSqft || 2.25) * 0.35);
  }

  if (categoryDef?.category === "roofing") {
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft)/i], 2200);
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "replacement");
    answers.roofMaterial = pickOption(prompt, categoryDef.questions.find(q => q.key === "roofMaterial")?.options, "asphalt shingle");
    answers.materialCost = Math.round((answers.squareFeet / 100) * (prices.perSquare || 425) * 0.55);
  }

  if (categoryDef?.category === "plumbing") {
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "leak repair");
    answers.urgency = pickOption(prompt, ["routine", "same day", "emergency"], /emerg/i.test(prompt) ? "emergency" : "same day");
    answers.materialCost = /water heater/i.test(prompt) ? prices.waterHeaterInstall || 1400 : prices.materialCost || 180;
  }

  if (categoryDef?.category === "electrical") {
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "diagnostic");
    if (/ev|charger/i.test(prompt)) {
      answers.serviceType = "EV charger";
      answers.materialCost = prices.evChargerInstall || 1200;
    }
    if (/panel/i.test(prompt)) {
      answers.serviceType = "panel upgrade";
      answers.materialCost = prices.panelUpgrade || 2200;
    }
  }

  if (categoryDef?.category === "general-contract") {
    answers.projectType = pickOption(prompt, categoryDef.questions.find(q => q.key === "projectType")?.options, "remodel");
    answers.squareFeet = numberFromPrompt(prompt, [/([\d,]+)\s*(?:sq\.?\s*ft|square feet|sqft)/i], 400);
    answers.materialCost = Math.round(answers.squareFeet * (prices.remodelPerSqft || 85) * 0.45);
    answers.markupMultiplier = prices.markupMultiplier || 1.35;
  }

  if (categoryDef?.category === "surveillance") {
    answers.cameraCount = numberFromPrompt(prompt, [/(\d+)\s*cameras?/i], 8);
    answers.retentionDays = numberFromPrompt(prompt, [/(\d+)\s*days?/i], 30);
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "new installation");
    answers.materialCost = (prices.nvrBase || 450) + answers.cameraCount * (prices.cameraInstallEach || 275);
  }

  if (categoryDef?.category === "trash-removal") {
    answers.volumeCubicYards = numberFromPrompt(prompt, [/([\d.]+)\s*(?:cubic yards?|cu\.?\s*yd|yards?)/i], 12);
    answers.materialType = pickOption(prompt, categoryDef.questions.find(q => q.key === "materialType")?.options, "household debris");
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "single haul");
    answers.disposalCost = Math.round(answers.volumeCubicYards * (prices.perCubicYard || 55));
  }

  if (categoryDef?.category === "transportation") {
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "local move");
    answers.requiresShipping = !/packing|loading only/i.test(answers.serviceType);
    // Auto walkthrough supplies demo FROM/TO when the prompt didn't include both.
    answers.pickupAddress = "100 Peachtree St, Atlanta, GA 30303";
    if (answers.requiresShipping) {
      answers.dropoffAddress = "500 Ponce De Leon Ave, Atlanta, GA 30308";
    }
    answers.serviceAddress = answers.pickupAddress;
    answers.distanceMiles = numberFromPrompt(prompt, [/([\d.]+)\s*miles?/i], answers.requiresShipping ? 8 : 0);
    answers.volumeCubicFeet = numberFromPrompt(prompt, [/([\d.]+)\s*(?:cubic feet|cu\.?\s*ft|sqft|sq\.?\s*ft)/i], 450);
    answers.crewSize = prices.defaultCrewSize || 2;
    answers.estimatedHours = prices.defaultHours || 4;
    answers.hourlyRate = prices.hourlyRate || 75;
  }

  if (categoryDef?.category === "healthcare") {
    answers.careSetting = pickOption(prompt, categoryDef.questions.find(q => q.key === "careSetting")?.options, "home");
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "nursing visit");
    answers.acuityLevel = pickOption(prompt, ["low", "moderate", "high", "critical"], "moderate");
    answers.role = pickOption(prompt, ["RN", "LPN", "NP", "physician", "caregiver with RN oversight"], /physician|doctor/i.test(prompt) ? "physician" : "RN");
    answers.visitMinutes = numberFromPrompt(prompt, [/(\d+)\s*minutes?/i], 60);
    answers.estimatedHours = Number((answers.visitMinutes / 60).toFixed(2));
    answers.hourlyRate = answers.role === "physician" ? 225 : prices.shiftHourlyRN || prices.hourlyRate || 95;
  }

  if (categoryDef?.category === "bakery-food") {
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "custom cake");
    answers.guestCount = numberFromPrompt(prompt, [/(\d+)\s*(?:guests?|servings?|people)/i], 24);
    answers.fulfillment = pickOption(prompt, ["pickup", "delivery", "on-site event"], /deliver/i.test(prompt) ? "delivery" : "pickup");
    answers.eventDate = "this weekend";
    answers.dietaryNotes = /gluten|vegan|nut|allerg/i.test(prompt) ? "See allergen notes in prompt" : "";
    answers.estimatedHours = Math.max(2, Math.round(answers.guestCount / 18));
    answers.materialCost = Math.round(answers.guestCount * (prices.perServing || 6.5) * 0.35);
    answers.hourlyRate = prices.hourlyRate || 55;
  }

  if (categoryDef?.category === "law-office") {
    answers.practiceArea = pickOption(prompt, categoryDef.questions.find(q => q.key === "practiceArea")?.options, "business");
    answers.serviceType = pickOption(prompt, categoryDef.questions.find(q => q.key === "serviceType")?.options, "initial consultation");
    answers.urgency = pickOption(prompt, ["standard", "rush", "same-week hearing"], /rush|urgent|hearing/i.test(prompt) ? "rush" : "standard");
    answers.attorneyRole = pickOption(prompt, ["partner", "associate", "paralegal with attorney review"], /partner/i.test(prompt) ? "partner" : "associate");
    answers.estimatedHours = /retainer/i.test(answers.serviceType) ? 10 : /appearance|closing|estate|formation/i.test(answers.serviceType) ? 5 : 2;
    answers.hourlyRate = answers.attorneyRole === "partner" ? (prices.partnerHourly || 375) : answers.attorneyRole.includes("paralegal") ? (prices.paralegalHourly || 125) : (prices.associateHourly || prices.hourlyRate || 225);
    answers.retainerAmount = /retainer/i.test(answers.serviceType) ? (prices.retainerMinimum || 1500) : 0;
  }

  // Fill any remaining select/number keys from question definitions
  for (const question of categoryDef?.questions || []) {
    if (answers[question.key] !== undefined) continue;
    if (question.type === "select") answers[question.key] = question.options?.[0];
    else if (question.type === "number" || question.type === "currency") answers[question.key] = question.example ?? 1;
    else if (question.type === "object") answers[question.key] = question.example || answers.customer;
    else if (question.type === "string") answers[question.key] = question.example || answers.serviceAddress;
    else if (question.type === "date") answers[question.key] = answers.requestedDate;
  }

  return answers;
}
