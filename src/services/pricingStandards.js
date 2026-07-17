import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supportedCategories } from "../ai/toolCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const pricingStandardsDir = path.join(__dirname, "../../data/pricing-standards");

const defaultUnitPrices = {
  landscape: { hourlyRate: 65, mowingPerThousandSqft: 45, mulchPerCubicYard: 55, fertilizationVisit: 85 },
  hvac: { hourlyRate: 125, diagnosticFee: 89, maintenancePlanMonthly: 45, replacementMarkupPercent: 35 },
  cleaning: { hourlyRate: 45, perSquareFoot: 0.18, deepCleanMultiplier: 1.6, supplyAllowancePercent: 8 },
  "pest-control": { hourlyRate: 95, oneTimeTreatment: 150, recurringMonthly: 55, termiteBondAnnual: 220 },
  pool: { hourlyRate: 75, weeklyService: 140, chemicalAllowance: 35, equipmentRepairMultiplier: 1.4 },
  painting: { hourlyRate: 55, interiorPerSqft: 2.25, exteriorPerSqft: 2.75, materialsMarkupPercent: 25 },
  roofing: { hourlyRate: 85, perSquare: 425, repairMinimum: 350, materialsMarkupPercent: 30 },
  plumbing: { hourlyRate: 135, diagnosticFee: 95, waterHeaterInstall: 1400, emergencyMultiplier: 1.5 },
  electrical: { hourlyRate: 125, panelUpgrade: 2200, evChargerInstall: 1200, diagnosticFee: 95 },
  "general-contract": { hourlyRate: 95, remodelPerSqft: 85, markupMultiplier: 1.35, changeOrderMarkupPercent: 20 },
  surveillance: { hourlyRate: 95, cameraInstallEach: 275, nvrBase: 450, monitoringMonthly: 35 },
  "trash-removal": { hourlyRate: 75, haulMinimum: 175, perCubicYard: 55, dumpsterDay: 45 },
  transportation: { hourlyRate: 75, localMoveMinimum: 250, perMile: 2.75, perCubicFoot: 1.15, crewOfTwoHourly: 150 },
  healthcare: { hourlyRate: 95, nurseVisit: 165, physicianVisit: 285, shiftHourlyRN: 95, shiftHourlyLPN: 72, travelPerMile: 1.25, suppliesPerVisit: 18 }
};

const seedAreas = [
  { key: "Atlanta, GA", region: "Southeast", factor: 1.0 },
  { key: "Dallas, TX", region: "South Central", factor: 0.97 },
  { key: "Phoenix, AZ", region: "Southwest", factor: 0.95 },
  { key: "Chicago, IL", region: "Midwest", factor: 1.08 },
  { key: "New York, NY", region: "Northeast", factor: 1.25 }
];

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function scalePrices(unitPrices, factor) {
  return Object.fromEntries(Object.entries(unitPrices).map(([key, value]) => [key, roundMoney(Number(value) * factor)]));
}

export function assertCategory(category) {
  if (!supportedCategories.includes(category)) {
    const error = new Error(`Unsupported category: ${category}`);
    error.statusCode = 404;
    throw error;
  }
}

export function pricingFilePath(category) {
  return path.join(pricingStandardsDir, `${category}.json`);
}

export function buildSeedPricingStandard(category) {
  assertCategory(category);
  const defaults = defaultUnitPrices[category];
  const areas = {};
  for (const area of seedAreas) {
    areas[area.key] = {
      region: area.region,
      currency: "USD",
      unitPrices: scalePrices(defaults, area.factor),
      notes: `Starter area pricing for ${category}. Review locally before production use.`
    };
  }
  return {
    category,
    currency: "USD",
    version: 1,
    updatedAt: new Date().toISOString(),
    defaults: { unitPrices: { ...defaults } },
    areas,
    meta: {
      source: "seed",
      editable: true,
      lastRefreshAt: null,
      lastRefreshMode: null,
      notes: "Edit this JSON or call the pricing-standards refresh workflow to update area rates from invoice logs."
    }
  };
}

export function ensurePricingStandardsFile(category) {
  assertCategory(category);
  fs.mkdirSync(pricingStandardsDir, { recursive: true });
  const filePath = pricingFilePath(category);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(buildSeedPricingStandard(category), null, 2)}\n`, "utf8");
  }
  return filePath;
}

export function ensureAllPricingStandards() {
  return supportedCategories.map(category => {
    ensurePricingStandardsFile(category);
    return category;
  });
}

export function getPricingStandards(category) {
  ensurePricingStandardsFile(category);
  return JSON.parse(fs.readFileSync(pricingFilePath(category), "utf8"));
}

export function listPricingStandards() {
  return {
    count: supportedCategories.length,
    directory: "data/pricing-standards",
    categories: supportedCategories.map(category => {
      const standards = getPricingStandards(category);
      return {
        category,
        version: standards.version,
        updatedAt: standards.updatedAt,
        areaCount: Object.keys(standards.areas || {}).length,
        file: `data/pricing-standards/${category}.json`,
        links: {
          get: `/api/v1/${category}/pricing-standards`,
          refresh: `/api/v1/${category}/pricing-standards/refresh`
        }
      };
    })
  };
}

export function savePricingStandards(category, nextStandards, meta = {}) {
  assertCategory(category);
  ensurePricingStandardsFile(category);
  const current = getPricingStandards(category);
  const merged = {
    ...current,
    ...nextStandards,
    category,
    currency: nextStandards.currency || current.currency || "USD",
    version: Number(nextStandards.version || current.version || 1) + (meta.bumpVersion ? 1 : 0),
    updatedAt: new Date().toISOString(),
    defaults: nextStandards.defaults || current.defaults,
    areas: nextStandards.areas || current.areas,
    meta: {
      ...(current.meta || {}),
      ...(nextStandards.meta || {}),
      ...(meta.meta || {}),
      editable: true
    }
  };
  if (!meta.bumpVersion) merged.version = Number(nextStandards.version || current.version || 1);
  fs.writeFileSync(pricingFilePath(category), `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

export function replacePricingStandards(category, body = {}) {
  assertCategory(category);
  if (!body.areas || typeof body.areas !== "object") {
    const error = new Error("Request body must include an areas object keyed by area name");
    error.statusCode = 400;
    throw error;
  }
  return savePricingStandards(category, {
    defaults: body.defaults,
    areas: body.areas,
    currency: body.currency,
    version: body.version,
    meta: { ...(body.meta || {}), source: body.meta?.source || "manual-update" }
  }, { bumpVersion: true, meta: { lastManualUpdateAt: new Date().toISOString() } });
}
