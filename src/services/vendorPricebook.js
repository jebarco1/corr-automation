import { getStore, nowIso, parseJson, rowToVendor } from "../db/store.js";
import { getPricingStandards } from "./pricingStandards.js";
import { computePricingRefresh, suggestFromInvoiceLogs } from "./pricingIntelligence.js";
import { getVendorById } from "./vendors.js";

function readVendorRow(vendorId) {
  const row = getStore().vendors.findOne({ id: vendorId });
  if (!row) {
    const error = new Error("Vendor not found");
    error.statusCode = 404;
    throw error;
  }
  return row;
}

function readSettings(row) {
  return parseJson(row.settings_json, {});
}

function writeSettings(vendorId, settings) {
  getStore().vendors.updateWhere({ id: vendorId }, {
    settings_json: settings,
    updated_at: nowIso()
  });
  return getVendorById(vendorId);
}

function seedPricebook(category) {
  const standards = getPricingStandards(category);
  return {
    category,
    currency: standards.currency || "USD",
    version: standards.version || 1,
    updatedAt: new Date().toISOString(),
    defaults: standards.defaults || { unitPrices: {} },
    areas: standards.areas || {},
    meta: {
      ...(standards.meta || {}),
      source: "seeded-from-global-standards",
      tenantScoped: true
    }
  };
}

export function getVendorPricebook(vendorId, options = {}) {
  const row = readVendorRow(vendorId);
  const vendor = rowToVendor(row);
  const settings = readSettings(row);
  const category = options.category || vendor.defaultCategory || "landscape";
  let pricebook = settings.pricebooks?.[category] || null;
  let seeded = false;
  if (!pricebook || options.reseed) {
    pricebook = seedPricebook(category);
    seeded = true;
    const next = {
      ...settings,
      pricebooks: {
        ...(settings.pricebooks || {}),
        [category]: pricebook
      }
    };
    writeSettings(vendorId, next);
  }
  return {
    vendorId,
    category,
    seeded,
    pricebook,
    quoteDefaults: resolveQuoteDefaults(pricebook, options.area || options.city)
  };
}

export function saveVendorPricebook(vendorId, category, pricebookInput = {}) {
  const row = readVendorRow(vendorId);
  const vendor = rowToVendor(row);
  const cat = category || vendor.defaultCategory || "landscape";
  const settings = readSettings(row);
  const current = settings.pricebooks?.[cat] || seedPricebook(cat);
  const nextBook = {
    ...current,
    ...pricebookInput,
    category: cat,
    currency: pricebookInput.currency || current.currency || "USD",
    version: Number(pricebookInput.version || current.version || 1) + 1,
    updatedAt: new Date().toISOString(),
    defaults: pricebookInput.defaults || current.defaults,
    areas: pricebookInput.areas || current.areas,
    meta: {
      ...(current.meta || {}),
      ...(pricebookInput.meta || {}),
      tenantScoped: true,
      source: pricebookInput.meta?.source || "manual-tenant-update"
    }
  };
  writeSettings(vendorId, {
    ...settings,
    pricebooks: {
      ...(settings.pricebooks || {}),
      [cat]: nextBook
    }
  });
  return {
    vendorId,
    category: cat,
    pricebook: nextBook,
    quoteDefaults: resolveQuoteDefaults(nextBook)
  };
}

/** Refresh tenant pricebook from invoice intelligence (global logs blended into tenant book). */
export async function refreshVendorPricebook(vendorId, input = {}) {
  const row = readVendorRow(vendorId);
  const vendor = rowToVendor(row);
  const category = input.category || vendor.defaultCategory || "landscape";
  const current = getVendorPricebook(vendorId, { category }).pricebook;

  let computed;
  try {
    computed = await computePricingRefresh(category, {
      ...input,
      baseStandards: current,
      source: "tenant-invoice-intelligence",
      skipLlm: input.skipLlm !== false, // default local for speed in CRM
      force: input.force === true
    });
  } catch (error) {
    if (error.statusCode === 400 && input.seedIfEmpty !== false) {
      // No logs yet — keep/seed book and still return intelligence tip
      const suggestions = await suggestFromInvoiceLogs(category, { limit: 20 }).catch(() => null);
      return {
        vendorId,
        category,
        status: "no-invoice-logs",
        message: "No invoice logs yet — seeded/kept tenant pricebook from global standards. Upload invoices to refresh.",
        pricebook: current,
        quoteDefaults: resolveQuoteDefaults(current),
        suggestions
      };
    }
    throw error;
  }

  const saved = saveVendorPricebook(vendorId, category, {
    ...computed.standards,
    meta: {
      ...computed.standards.meta,
      source: "tenant-invoice-intelligence",
      lastRefreshMode: computed.mode,
      lastRefreshRationale: computed.rationale,
      invoiceCountUsed: computed.invoiceCount
    }
  });

  const suggestions = await suggestFromInvoiceLogs(category, { limit: Number(input.limit) || 50 }).catch(() => null);

  return {
    vendorId,
    category,
    status: "refreshed",
    mode: computed.mode,
    rationale: computed.rationale,
    invoiceCount: computed.invoiceCount,
    changes: computed.changes,
    pricebook: saved.pricebook,
    quoteDefaults: saved.quoteDefaults,
    suggestions
  };
}

export function resolveQuoteDefaults(pricebook, areaName = null) {
  const defaults = pricebook?.defaults?.unitPrices || {};
  let areaPrices = {};
  if (areaName && pricebook?.areas) {
    const key = Object.keys(pricebook.areas).find(name =>
      name.toLowerCase().includes(String(areaName).toLowerCase())
      || String(areaName).toLowerCase().includes(name.toLowerCase().split(",")[0])
    );
    if (key) areaPrices = pricebook.areas[key]?.unitPrices || {};
  }
  // Prefer Atlanta if present for GA demos
  if (!Object.keys(areaPrices).length && pricebook?.areas?.["Atlanta, GA"]) {
    areaPrices = pricebook.areas["Atlanta, GA"].unitPrices || {};
  }
  const unitPrices = { ...defaults, ...areaPrices };
  const hourlyRate = Number(unitPrices.hourlyRate || 95);
  const defaultHours = Number(unitPrices.defaultHours || pricebook?.defaults?.defaultHours || 2);
  const averageJobTotal = Number(unitPrices.averageJobTotal || 0);
  const jobMinimum = Number(unitPrices.jobMinimum || 0);
  const suggestedAmount = averageJobTotal || Math.max(jobMinimum, hourlyRate * defaultHours) || 285;
  return {
    unitPrices,
    hourlyRate,
    defaultHours,
    averageJobTotal: averageJobTotal || null,
    jobMinimum: jobMinimum || null,
    suggestedAmount: Number(suggestedAmount.toFixed(2))
  };
}

/** Suggested quote amount for a lead using tenant pricebook. */
export function suggestAmountForLead(vendorId, lead = {}, options = {}) {
  const category = options.category || lead.category || readVendorRow(vendorId).default_category || "landscape";
  const { pricebook, quoteDefaults } = getVendorPricebook(vendorId, {
    category,
    area: lead.city || lead.address
  });
  return {
    category,
    amount: quoteDefaults.suggestedAmount,
    quoteDefaults,
    pricebookVersion: pricebook.version,
    areaHint: lead.city || null
  };
}
