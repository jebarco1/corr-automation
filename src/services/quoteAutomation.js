import { getPricingStandards } from "./pricingStandards.js";
import { matchServiceFromText } from "./serviceCatalog.js";

/** Local industry defaults used when pricing-standards JSON has no matching keys. */
export const industryDefaults = {
  landscape: { hourlyRate: 65, defaultCrewSize: 2, defaultHours: 3, materialCost: 0, mowingPerThousandSqft: 45 },
  hvac: { hourlyRate: 125, defaultCrewSize: 1, defaultHours: 2, materialCost: 450 },
  cleaning: { hourlyRate: 45, defaultCrewSize: 2, defaultHours: 4, materialCost: 0, perSquareFoot: 0.18 },
  "pest-control": { hourlyRate: 95, defaultHours: 1.5, materialCost: 65 },
  pool: { hourlyRate: 75, defaultHours: 1.5, materialCost: 35 },
  painting: { hourlyRate: 55, defaultHours: 16, materialCost: 350, interiorPerSqft: 2.25, exteriorPerSqft: 2.75 },
  roofing: { hourlyRate: 85, defaultHours: 24, materialCost: 2800, perSquare: 425 },
  plumbing: { hourlyRate: 135, defaultHours: 2, materialCost: 180, waterHeaterInstall: 1400 },
  electrical: { hourlyRate: 125, defaultHours: 3, materialCost: 320, panelUpgrade: 2200, evChargerInstall: 1200 },
  "general-contract": { hourlyRate: 95, defaultHours: 40, materialCost: 4500, remodelPerSqft: 85, markupMultiplier: 1.35 },
  surveillance: { hourlyRate: 95, defaultHours: 6, materialCost: 1200, cameraInstallEach: 275, nvrBase: 450 },
  "trash-removal": { hourlyRate: 75, defaultHours: 3, disposalCost: 120, perCubicYard: 55 },
  transportation: { hourlyRate: 75, defaultCrewSize: 2, defaultHours: 4, perMile: 2.75, perCubicFoot: 1.15 },
  healthcare: { hourlyRate: 95, defaultHours: 1, shiftHourlyRN: 95, suppliesPerVisit: 18 },
  "bakery-food": { hourlyRate: 55, defaultHours: 4, cakeBase: 85, perServing: 6.5, cateringTray: 95, deliveryFee: 25 },
  "law-office": { hourlyRate: 275, defaultHours: 2, consultationFee: 150, retainerMinimum: 1500, appearanceFee: 450 }
};

function pickOption(text, options = [], fallback) {
  const lower = String(text || "").toLowerCase();
  const found = options.find(option => lower.includes(String(option).toLowerCase()));
  return found || fallback || options[0];
}

function numberFromText(text, patterns, fallback) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match?.[1]) return Number(String(match[1]).replace(/,/g, ""));
  }
  return fallback;
}

export function extractAddress(message = "") {
  const text = String(message || "");
  const match = text.match(
    /\d{1,6}\s+[A-Za-z0-9.'#\- ]+,\s*[A-Za-z .'#-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?/i
  ) || text.match(
    /\d{1,6}\s+[A-Za-z0-9.'#\- ]+(?:,\s*[A-Za-z .'#-]+){1,3}(?:\s+\d{5}(?:-\d{4})?)?/
  );
  return match?.[0]?.replace(/\s+/g, " ").replace(/^[-:]\s*/, "").trim() || null;
}

export function extractAddresses(message = "") {
  const text = String(message || "");
  const regex = /\d{1,6}\s+[A-Za-z0-9.'#\- ]+,\s*[A-Za-z .'#-]+,\s*[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?/gi;
  const found = [...text.matchAll(regex)].map(m => m[0].replace(/\s+/g, " ").trim());
  if (found.length) return found;
  const single = extractAddress(text);
  return single ? [single] : [];
}

export function parseCustomerFromText(message = "") {
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === "object") {
      return {
        name: parsed.name || "Property Owner",
        email: parsed.email || "customer@example.com",
        phone: parsed.phone || "404-555-0100"
      };
    }
  } catch {
    // freeform
  }
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = message.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0];
  const nameMatch = message.match(/(?:customer|client|for|name)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
  let name = nameMatch?.[1];
  if (!name && email) {
    name = message
      .replace(email, "")
      .replace(phone || "", "")
      .replace(/[|,]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (!name || name.length < 2 || /\d{3,}/.test(name)) name = "Property Owner";
  return {
    name,
    email: email || "customer@example.com",
    phone: phone || "404-555-0100"
  };
}

export function resolveUnitPrices(category, businessSettings = {}) {
  const local = industryDefaults[category] || { hourlyRate: 85, defaultHours: 2, defaultCrewSize: 1, materialCost: 0 };
  let standards = {};
  try {
    const file = getPricingStandards(category);
    standards = file.areas?.["Atlanta, GA"]?.unitPrices || file.defaults?.unitPrices || {};
  } catch {
    standards = {};
  }
  const business = businessSettings.unitPrices || {};
  return {
    ...local,
    ...standards,
    ...business,
    defaultCrewSize: businessSettings.defaultCrewSize || local.defaultCrewSize || 2,
    defaultHours: local.defaultHours || 2
  };
}

/**
 * Build automated answers for a category from freeform text + industry pricing.
 * User-facing prompts should only need an address (and destination for moves).
 */
export function buildSmartDefaults(category, message = "", businessSettings = {}, existing = {}) {
  const text = String(message || "");
  const lower = text.toLowerCase();
  const prices = resolveUnitPrices(category, businessSettings);
  const addresses = extractAddresses(text);
  const answers = { ...existing };

  if (!answers.customer) answers.customer = parseCustomerFromText(text);
  if (!answers.propertyType) {
    if (/commercial|office|retail|warehouse|facility/.test(lower)) answers.propertyType = "commercial";
    else if (/hoa/.test(lower)) answers.propertyType = "hoa";
    else if (/apartment|multi[- ]?family/.test(lower)) answers.propertyType = "multi-family";
    else if (/industrial/.test(lower)) answers.propertyType = "industrial";
    else answers.propertyType = "residential";
  }
  if (!answers.requestedDate) {
    answers.requestedDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  }

  if (!answers.serviceAddress && addresses[0]) answers.serviceAddress = addresses[0];
  if (!answers.crewSize) answers.crewSize = prices.defaultCrewSize || 2;
  if (!answers.hourlyRate) answers.hourlyRate = prices.hourlyRate || 85;
  if (answers.estimatedHours == null) answers.estimatedHours = prices.defaultHours || 2;
  if (answers.materialCost == null) {
    const serviceType = String(answers.serviceType || "").toLowerCase();
    const lightService = /diagnostic|maintenance|repair|inspection|consult|visit/.test(serviceType);
    answers.materialCost = lightService ? 0 : (prices.materialCost || 0);
  }
  if (answers.disposalCost == null && prices.disposalCost != null) answers.disposalCost = prices.disposalCost;
  if (answers.equipmentCost == null) answers.equipmentCost = prices.equipmentCost || 0;
  if (answers.markupMultiplier == null) answers.markupMultiplier = prices.markupMultiplier || 1.35;

  // Prefer catalog match for service type / hours when the prompt names a service.
  if (!answers.serviceType || !answers.serviceId) {
    try {
      const matched = matchServiceFromText(category, text);
      if (matched) {
        if (!answers.serviceId) answers.serviceId = matched.id;
        if (!answers.serviceType) answers.serviceType = matched.quoteKey || matched.name;
        if (category === "general-contract" && !answers.projectType) {
          answers.projectType = matched.quoteKey || matched.id.replace(/-/g, " ");
        }
        if (matched.defaultHours != null && (existing.estimatedHours == null)) {
          answers.estimatedHours = matched.defaultHours;
        }
      }
    } catch {
      // Catalog optional at runtime
    }
  }

  if (category === "landscape") {
    if (!answers.serviceType) {
      if (/mow/.test(lower)) answers.serviceType = "mowing";
      else if (/mulch/.test(lower)) answers.serviceType = "mulch";
      else if (/fertil/.test(lower)) answers.serviceType = "fertilization";
      else if (/cleanup|clean up/.test(lower)) answers.serviceType = "cleanup";
      else if (/maintain|full/.test(lower)) answers.serviceType = "full maintenance";
      else answers.serviceType = "mowing";
    }
  }

  if (category === "hvac") {
    if (!answers.systemType) {
      answers.systemType = pickOption(lower, ["heat pump", "rooftop unit", "boiler", "chiller", "air handler", "split system"], "split system");
    }
    if (!answers.serviceType) {
      if (/replac/.test(lower)) answers.serviceType = "replacement";
      else if (/maintain|tune/.test(lower)) answers.serviceType = "maintenance";
      else if (/install/.test(lower)) answers.serviceType = "installation";
      else if (/repair/.test(lower)) answers.serviceType = "repair";
      else answers.serviceType = "diagnostic";
    }
    if (answers.serviceType === "replacement" || answers.serviceType === "installation") {
      if (existing.materialCost == null) {
        answers.materialCost = Math.max(Number(answers.materialCost || 0), answers.serviceType === "replacement" ? 4500 : 1200);
      }
      if (existing.estimatedHours == null) {
        answers.estimatedHours = Math.max(Number(answers.estimatedHours || 0), answers.serviceType === "replacement" ? 6 : 4);
      }
    } else {
      // Diagnostic / repair / maintenance should not inherit replacement material defaults.
      if (existing.materialCost == null) answers.materialCost = 0;
      if (answers.serviceType === "diagnostic") {
        if (existing.estimatedHours == null) answers.estimatedHours = 1;
        if (answers.diagnosticFee == null) answers.diagnosticFee = prices.diagnosticFee || 89;
      } else if (answers.serviceType === "maintenance" && existing.estimatedHours == null) {
        answers.estimatedHours = 1.5;
      }
    }
  }

  if (category === "cleaning") {
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["deep clean", "move-in/out", "post-construction", "carpet", "floor care", "windows", "recurring janitorial"], "recurring janitorial");
    }
    if (!answers.frequency) {
      answers.frequency = pickOption(lower, ["daily", "weekly", "biweekly", "monthly", "one-time"], "weekly");
    }
  }

  if (category === "pest-control") {
    if (!answers.pestType) {
      answers.pestType = pickOption(lower, ["termites", "rodents", "bed bugs", "mosquitoes", "wildlife", "general insects"], "general insects");
    }
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["inspection", "recurring service", "termite bond", "exclusion", "one-time treatment"], "one-time treatment");
    }
  }

  if (category === "pool") {
    if (answers.poolGallons == null) answers.poolGallons = numberFromText(text, [/([\d,]+)\s*gallons?/i], 15000);
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["opening", "closing", "equipment repair", "cleaning", "chemical balancing", "weekly service"], "weekly service");
    }
  }

  if (category === "painting") {
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["exterior", "cabinets", "touch-up", "commercial coating", "interior"], "interior");
    }
    if (answers.coats == null) answers.coats = numberFromText(text, [/(\d+)\s*coats?/i], 2);
  }

  if (category === "roofing") {
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["inspection", "repair", "storm damage", "maintenance", "replacement"], "inspection");
    }
    if (!answers.roofMaterial) {
      answers.roofMaterial = pickOption(lower, ["metal", "tile", "flat membrane", "wood shake", "asphalt shingle"], "asphalt shingle");
    }
  }

  if (category === "plumbing") {
    if (!answers.serviceType) {
      if (/water heater/.test(lower)) answers.serviceType = "water heater";
      else if (/drain|clog/.test(lower)) answers.serviceType = "drain clearing";
      else if (/sewer/.test(lower)) answers.serviceType = "sewer";
      else if (/leak/.test(lower)) answers.serviceType = "leak repair";
      else answers.serviceType = "leak repair";
    }
    if (!answers.urgency) {
      answers.urgency = /emerg/.test(lower) ? "emergency" : /same.?day|today|asap/.test(lower) ? "same day" : "routine";
    }
    if (answers.serviceType === "water heater") answers.materialCost = prices.waterHeaterInstall || 1400;
  }

  if (category === "electrical") {
    if (!answers.serviceType) {
      if (/ev|charger/.test(lower)) answers.serviceType = "EV charger";
      else if (/panel/.test(lower)) answers.serviceType = "panel upgrade";
      else if (/generator/.test(lower)) answers.serviceType = "generator";
      else if (/light/.test(lower)) answers.serviceType = "lighting";
      else if (/rewire/.test(lower)) answers.serviceType = "rewire";
      else if (/inspect/.test(lower)) answers.serviceType = "safety inspection";
      else answers.serviceType = "diagnostic";
    }
    if (answers.serviceType === "EV charger") answers.materialCost = prices.evChargerInstall || 1200;
    if (answers.serviceType === "panel upgrade") answers.materialCost = prices.panelUpgrade || 2200;
    if (answers.voltage == null) answers.voltage = 240;
  }

  if (category === "general-contract") {
    if (!answers.projectType) {
      answers.projectType = pickOption(lower, ["addition", "repair", "build-out", "new construction", "restoration", "remodel"], "remodel");
    }
  }

  if (category === "surveillance") {
    if (answers.cameraCount == null) answers.cameraCount = numberFromText(text, [/(\d+)\s*cameras?/i], 8);
    if (answers.retentionDays == null) answers.retentionDays = numberFromText(text, [/(\d+)\s*days?/i], 30);
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["upgrade", "repair", "site assessment", "maintenance", "new installation"], "new installation");
    }
    answers.materialCost = (prices.nvrBase || 450) + Number(answers.cameraCount) * (prices.cameraInstallEach || 275);
  }

  if (category === "trash-removal") {
    if (answers.volumeCubicYards == null) {
      answers.volumeCubicYards = numberFromText(text, [/([\d.]+)\s*(?:cubic yards?|cu\.?\s*yd|yards?)/i], 12);
    }
    if (!answers.materialType) {
      answers.materialType = pickOption(lower, ["construction debris", "yard waste", "appliances", "furniture", "mixed waste", "household debris"], "household debris");
    }
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["dumpster rental", "recurring pickup", "property cleanout", "single haul"], "single haul");
    }
    answers.disposalCost = Math.round(Number(answers.volumeCubicYards) * (prices.perCubicYard || 55));
  }

  if (category === "transportation") {
    if (!answers.pickupAddress && addresses[0]) answers.pickupAddress = addresses[0];
    if (!answers.dropoffAddress && addresses[1]) answers.dropoffAddress = addresses[1];
    if (!answers.serviceAddress && answers.pickupAddress) answers.serviceAddress = answers.pickupAddress;
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["long haul", "same-day delivery", "scheduled delivery", "light freight", "materials haul", "local move"], "local move");
    }
    if (answers.distanceMiles == null) answers.distanceMiles = numberFromText(text, [/([\d.]+)\s*miles?/i], 8);
    if (answers.volumeCubicFeet == null) {
      answers.volumeCubicFeet = numberFromText(text, [/([\d.]+)\s*(?:cubic feet|cu\.?\s*ft)/i], 450);
    }
  }

  if (category === "healthcare") {
    if (!answers.careSetting) answers.careSetting = pickOption(lower, ["assisted living", "clinic", "facility", "telehealth hybrid", "home"], "home");
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["physician visit", "private duty shift", "post-acute follow-up", "chronic care management", "urgent home visit", "nursing visit"], "nursing visit");
    }
    if (!answers.acuityLevel) answers.acuityLevel = pickOption(lower, ["critical", "high", "low", "moderate"], "moderate");
    if (!answers.role) {
      answers.role = /physician|doctor/.test(lower) ? "physician" : /lpn/.test(lower) ? "LPN" : /np/.test(lower) ? "NP" : "RN";
    }
    if (answers.visitMinutes == null) answers.visitMinutes = numberFromText(text, [/(\d+)\s*minutes?/i], 60);
    answers.estimatedHours = Number((Number(answers.visitMinutes) / 60).toFixed(2));
    answers.hourlyRate = answers.role === "physician" ? 225 : prices.shiftHourlyRN || prices.hourlyRate || 95;
  }

  if (category === "bakery-food") {
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["cupcake assortment", "catering tray", "event dessert table", "wholesale bread", "wholesale pastries", "corporate breakfast", "holiday cookie boxes", "gluten-free specialty", "local delivery", "rush order", "custom cake"], "custom cake");
    }
    if (answers.guestCount == null) answers.guestCount = numberFromText(text, [/(\d+)\s*(?:guests?|servings?|people)/i], 24);
    if (!answers.fulfillment) answers.fulfillment = pickOption(lower, ["delivery", "on-site event", "pickup"], /deliver/.test(lower) ? "delivery" : "pickup");
    if (!answers.eventDate) answers.eventDate = "this weekend";
    if (answers.estimatedHours == null) answers.estimatedHours = Math.max(2, Math.round(Number(answers.guestCount) / 18));
    if (answers.materialCost == null) answers.materialCost = Math.round(Number(answers.guestCount) * (prices.perServing || 6.5) * 0.35);
    answers.hourlyRate = prices.hourlyRate || 55;
  }

  if (category === "law-office") {
    if (!answers.practiceArea) {
      answers.practiceArea = pickOption(lower, ["contracts", "employment", "real estate", "estate planning", "family", "collections", "intellectual property", "general counsel", "business"], "business");
    }
    if (!answers.serviceType) {
      answers.serviceType = pickOption(lower, ["document review", "contract drafting", "retainer block", "business formation", "employment advisory", "real estate closing", "estate planning", "court appearance", "demand letter", "compliance audit", "initial consultation"], "initial consultation");
    }
    if (!answers.urgency) answers.urgency = pickOption(lower, ["same-week hearing", "rush", "standard"], /rush|urgent|hearing/.test(lower) ? "rush" : "standard");
    if (!answers.attorneyRole) {
      answers.attorneyRole = /partner/.test(lower) ? "partner" : /paralegal/.test(lower) ? "paralegal with attorney review" : "associate";
    }
    if (answers.estimatedHours == null) {
      answers.estimatedHours = /retainer/.test(String(answers.serviceType)) ? 10 : /appearance|closing|estate|formation/.test(String(answers.serviceType)) ? 5 : 2;
    }
    answers.hourlyRate = answers.attorneyRole === "partner" ? (prices.partnerHourly || 375) : answers.attorneyRole.includes("paralegal") ? (prices.paralegalHourly || 125) : (prices.associateHourly || prices.hourlyRate || 225);
    if (answers.retainerAmount == null && /retainer/.test(String(answers.serviceType))) {
      answers.retainerAmount = prices.retainerMinimum || 1500;
    }
  }

  return answers;
}

/** Scale labor/material assumptions once Regrid (or prompt) provides square footage. */
export function refineDefaultsFromMeasurements(category, answers = {}, businessSettings = {}) {
  const prices = resolveUnitPrices(category, businessSettings);
  const next = { ...answers };
  const sqft = Number(next.squareFeet || next.buildingSquareFeet || next.lotSquareFeet || 0);

  if (category === "landscape" && sqft > 0) {
    next.estimatedHours = Math.max(1, Number((sqft / 4000).toFixed(1)));
    if (next.serviceType === "mowing" && prices.mowingPerThousandSqft) {
      // Keep hours-based estimate; automation APIs use sqft + rates.
    }
  }
  if (category === "cleaning" && sqft > 0) {
    const rate = prices.hourlyRate || 45;
    const perSqft = prices.perSquareFoot || 0.18;
    next.estimatedHours = Math.max(1, Number(((sqft * perSqft) / rate).toFixed(1)));
  }
  if (category === "painting" && sqft > 0) {
    const per = next.serviceType === "exterior" ? (prices.exteriorPerSqft || 2.75) : (prices.interiorPerSqft || 2.25);
    next.materialCost = Math.round(sqft * per * 0.35);
    next.estimatedHours = Math.max(4, Number((sqft / 150).toFixed(1)));
  }
  if (category === "roofing" && sqft > 0) {
    next.materialCost = Math.round((sqft / 100) * (prices.perSquare || 425) * 0.55);
    next.estimatedHours = Math.max(8, Number((sqft / 100).toFixed(1)));
  }
  if (category === "hvac" && sqft > 0 && next.serviceType === "replacement") {
    next.estimatedHours = Math.max(Number(next.estimatedHours || 0), 6);
  }
  if (category === "general-contract" && sqft > 0) {
    next.materialCost = Math.round(sqft * (prices.remodelPerSqft || 85) * 0.45);
  }
  return next;
}

export function summarizeAutoFilled(answers = {}, askedKeys = []) {
  const skip = new Set(["regridLookupAt", "regridError", "regridMeasurementSource", "parcelId", "matchedAddress", ...askedKeys]);
  return Object.keys(answers).filter(key => !skip.has(key) && answers[key] != null);
}
