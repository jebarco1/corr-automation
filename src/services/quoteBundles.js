import { createInstantQuote } from "./guidedWorkflow.js";
import { runAutomation } from "./automationEngine.js";

const money = value => Number(Number(value || 0).toFixed(2));

/** Preset multi-trade bundles customers commonly request together. */
export const BUNDLE_PRESETS = {
  "landscape-trash": {
    id: "landscape-trash",
    label: "Landscape + Trash Haul",
    description: "Lawn service paired with debris/haul removal.",
    trades: [
      { category: "landscape", role: "primary" },
      { category: "trash-removal", role: "addon", serviceHint: "single haul" }
    ]
  },
  "bakery-delivery": {
    id: "bakery-delivery",
    label: "Bakery + Delivery",
    description: "Bakery order with local delivery fee and route estimate.",
    trades: [
      { category: "bakery-food", role: "primary" },
      { category: "transportation", role: "addon", serviceHint: "same-day delivery" }
    ]
  },
  "hvac-electrical": {
    id: "hvac-electrical",
    label: "HVAC + Electrical Support",
    description: "HVAC service with electrical diagnostic support line.",
    trades: [
      { category: "hvac", role: "primary" },
      { category: "electrical", role: "addon", serviceHint: "diagnostic" }
    ]
  }
};

function invoiceToAddonLines(invoice, label) {
  return (invoice.lineItems || []).map(item => ({
    ...item,
    description: `[${label}] ${item.description}`,
    sourceApi: item.sourceApi || `${invoice.category}-bundle`
  }));
}

/**
 * Create a multi-trade quote by running each trade's instant quote and merging line items.
 * Body: { bundleId? | trades:[{category, answers?, message?}], shared?, taxRate?, discount? }
 */
export async function createBundleQuote(input = {}) {
  const preset = input.bundleId ? BUNDLE_PRESETS[input.bundleId] : null;
  const trades = Array.isArray(input.trades) && input.trades.length
    ? input.trades
    : (preset?.trades || []);
  if (trades.length < 2) {
    const error = new Error("Provide bundleId or at least two trades[{category,...}]");
    error.statusCode = 400;
    throw error;
  }

  const shared = input.shared || {};
  const parts = [];
  let lineItems = [];

  for (const trade of trades) {
    const category = trade.category;
    if (!category) {
      const error = new Error("Each trade requires a category");
      error.statusCode = 400;
      throw error;
    }
    const answers = {
      ...(shared.answers || {}),
      ...(trade.answers || {})
    };
    if (shared.serviceAddress && !answers.serviceAddress) answers.serviceAddress = shared.serviceAddress;
    if (shared.customer && !answers.customer) answers.customer = shared.customer;
    if (shared.pickupAddress && !answers.pickupAddress) answers.pickupAddress = shared.pickupAddress;
    if (shared.dropoffAddress && !answers.dropoffAddress) answers.dropoffAddress = shared.dropoffAddress;
    if (trade.serviceHint && !answers.serviceType) answers.serviceType = trade.serviceHint;
    if (category === "bakery-food" && answers.fulfillment == null) answers.fulfillment = "delivery";

    const invoice = await createInstantQuote(category, {
      answers,
      message: trade.message || input.message || `${category} bundle trade`,
      businessSettings: input.businessSettings || shared.businessSettings,
      taxRate: 0,
      discount: 0,
      currency: input.currency || "USD"
    });

    parts.push({
      category,
      role: trade.role || "trade",
      invoiceId: invoice.invoiceId,
      subtotal: invoice.subtotal,
      lineItemCount: invoice.lineItems?.length || 0
    });
    lineItems = lineItems.concat(invoiceToAddonLines(invoice, invoice.categoryLabel || category));
  }

  const subtotal = money(lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const discount = money(input.discount || 0);
  const taxRate = Number(input.taxRate ?? 8.9);
  const taxable = money(Math.max(0, subtotal - discount));
  const tax = money(taxable * taxRate / 100);
  const total = money(taxable + tax);

  return {
    bundleId: preset?.id || input.bundleId || "custom",
    label: preset?.label || input.label || "Multi-trade bundle",
    description: preset?.description || null,
    status: "draft",
    currency: input.currency || "USD",
    customer: shared.customer || input.customer || null,
    serviceAddress: shared.serviceAddress || input.serviceAddress || null,
    trades: parts,
    lineItems,
    subtotal,
    discount,
    taxRate,
    tax,
    total,
    notes: input.notes || "Multi-trade bundle quote. Verify each trade on-site before approval."
  };
}

export function listBundlePresets() {
  return {
    count: Object.keys(BUNDLE_PRESETS).length,
    presets: Object.values(BUNDLE_PRESETS)
  };
}

/**
 * Transportation operations pack: load plan + route optimize + fuel cost.
 */
export function createTransportPack(input = {}) {
  const pickup = input.pickupAddress || input.serviceAddress || "100 Peachtree St, Atlanta, GA 30303";
  const dropoff = input.dropoffAddress || input.destinationAddress || "500 Ponce De Leon Ave, Atlanta, GA 30308";
  const distanceMiles = Number(input.distanceMiles || 8);
  const volumeCubicFeet = Number(input.volumeCubicFeet || 350);
  const crewSize = Number(input.crewSize || 2);
  const payload = {
    pickupAddress: pickup,
    dropoffAddress: dropoff,
    address: pickup,
    distanceMiles,
    volumeCubicFeet,
    crewSize,
    estimatedHours: input.estimatedHours,
    hourlyRate: input.hourlyRate || 75,
    mpg: input.mpg || 12,
    fuelPrice: input.fuelPrice || 3.5,
    jobs: [
      { id: "pickup", address: pickup, priority: 1 },
      { id: "dropoff", address: dropoff, priority: 2 }
    ]
  };

  const loadPlan = runAutomation("transport-load-plan", payload);
  const route = runAutomation("transport-route-optimize", payload);
  const fuel = runAutomation("fuel-cost", payload);
  const move = runAutomation("transport-local-move-estimate", payload);

  const fuelAmount = money(fuel.data?.estimatedFuelCost || 0);
  const laborAmount = money(move.data?.suggestedPrice || move.data?.estimatedCost || 0);
  const lineItems = [
    {
      description: "Local move / delivery labor",
      quantity: 1,
      unit: "job",
      unitPrice: laborAmount,
      amount: laborAmount,
      sourceApi: "transport-local-move-estimate"
    },
    {
      description: "Fuel allowance",
      quantity: 1,
      unit: "trip",
      unitPrice: fuelAmount,
      amount: fuelAmount,
      sourceApi: "fuel-cost"
    }
  ];
  const subtotal = money(lineItems.reduce((sum, item) => sum + item.amount, 0));
  const taxRate = Number(input.taxRate ?? 8.9);
  const tax = money(subtotal * taxRate / 100);

  return {
    packId: "transport-ops",
    label: "Transport operations pack",
    pickupAddress: pickup,
    dropoffAddress: dropoff,
    distanceMiles,
    volumeCubicFeet,
    loadPlan: loadPlan.data,
    route: route.data,
    fuel: fuel.data,
    moveEstimate: move.data,
    lineItems,
    subtotal,
    taxRate,
    tax,
    total: money(subtotal + tax),
    notes: "Starter pack combining load plan, route optimization stub, and fuel cost."
  };
}
