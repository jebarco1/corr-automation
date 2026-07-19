import { createLead, importHuntLeads } from "./vendorLeads.js";
import { createQuote, sendQuote, acceptQuote } from "./vendorQuotes.js";
import { getGuidedWorkflow } from "./guidedWorkflow.js";
import { ensureDemoVendor } from "./vendors.js";

function customerFromAnswers(answers = {}) {
  const raw = answers.customer;
  if (raw && typeof raw === "object") {
    return {
      name: raw.name || "Customer",
      email: raw.email || null,
      phone: raw.phone || null
    };
  }
  if (typeof raw === "string" && raw.trim()) {
    return { name: raw.trim(), email: null, phone: null };
  }
  return { name: "Customer", email: null, phone: null };
}

function mapInvoiceLineItems(invoice) {
  return (invoice?.lineItems || []).map(item => ({
    description: item.description || "Service",
    quantity: item.quantity,
    unit: item.unit,
    amountCents: Math.round(Number(item.amount || 0) * 100)
  }));
}

/** Promote a completed guided session invoice into Vendor Ops lead + draft quote. */
export function promoteGuidedSessionToCrm(vendorId, input = {}) {
  const sessionId = input.sessionId;
  if (!sessionId) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }
  const workflow = getGuidedWorkflow(sessionId);
  const invoice = input.invoice || workflow.invoice;
  if (!invoice) {
    const error = new Error("Guided session has no invoice yet — generate one first");
    error.statusCode = 400;
    throw error;
  }

  const customer = customerFromAnswers(workflow.answers || {});
  const address = workflow.answers?.serviceAddress
    || workflow.answers?.pickupAddress
    || invoice.serviceAddress
    || null;

  const lead = createLead(vendorId, {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address,
    category: workflow.category,
    segment: "residential",
    customerType: workflow.answers?.propertyType || "homeowner",
    score: 80,
    status: (customer.email || customer.phone || address) ? "contact-ready" : "new",
    source: "guided-session",
    payload: {
      sessionId,
      invoiceId: invoice.invoiceId,
      serviceType: workflow.answers?.serviceType,
      categoryLabel: workflow.categoryLabel
    }
  });

  const quote = createQuote(vendorId, {
    leadId: lead.id,
    category: workflow.category,
    customerName: customer.name,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    serviceAddress: address,
    serviceName: workflow.answers?.serviceType || workflow.categoryLabel || "Service",
    amount: invoice.total,
    lineItems: mapInvoiceLineItems(invoice),
    notes: `Promoted from guided session ${sessionId}`
  });

  return { lead, quote, sessionId, invoiceId: invoice.invoiceId };
}

/** Import Autopilot simulation leads into Vendor Ops CRM. */
export function promoteAutopilotSimToCrm(vendorId, input = {}) {
  const category = input.category || "landscape";
  const leads = Array.isArray(input.leads) ? input.leads : [];
  if (!leads.length) {
    const error = new Error("leads[] is required");
    error.statusCode = 400;
    throw error;
  }

  const mapped = leads.map(lead => ({
    leadId: lead.id || lead.leadId,
    segment: lead.segment || "residential",
    category: lead.category || category,
    name: lead.name,
    phone: lead.phone || null,
    email: lead.email || null,
    address: lead.address || null,
    city: lead.city || null,
    state: lead.state || "GA",
    customerType: lead.customerType || lead.type || null,
    score: lead.score || 70,
    source: "autopilot-sim",
    suggestedService: lead.service ? { serviceName: lead.service } : undefined,
    status: lead.stage || undefined
  }));

  const imported = importHuntLeads(vendorId, mapped, { category, segment: input.segment });
  return {
    category,
    imported: imported.count,
    leads: imported.leads,
    source: "autopilot-sim"
  };
}

/** Resolve vendor id from explicit id or demo bootstrap. */
export function resolveVendorContext(input = {}) {
  if (input.vendorId) return { vendorId: input.vendorId, demo: false };
  const demo = ensureDemoVendor();
  return { vendorId: demo.vendor.id, demo: true, apiKey: demo.apiKey, vendor: demo.vendor };
}

/** Optional: create quote, send, and accept→job for a lead in one call (demo autopilot step). */
export async function quoteSendJobForLead(vendorId, lead, options = {}) {
  const amount = Number(options.amount || lead.payload?.quoteAmount || lead.score * 12 || 285);
  const quote = createQuote(vendorId, {
    leadId: lead.id,
    category: lead.category,
    customerName: lead.name,
    customerEmail: lead.email,
    customerPhone: lead.phone,
    serviceAddress: lead.address,
    serviceName: options.serviceName
      || lead.payload?.suggestedService?.serviceName
      || lead.payload?.service
      || "Service visit",
    amount,
    notes: options.notes || "Created by real autopilot pipeline"
  });

  let sent = null;
  let accepted = null;
  if (options.send !== false) {
    sent = await sendQuote(vendorId, quote.id, { sms: false });
  }
  if (options.accept) {
    accepted = await acceptQuote(vendorId, quote.id, {});
  }
  return {
    lead,
    quote: accepted?.quote || sent?.quote || quote,
    job: accepted?.job || null,
    link: sent?.link || quote.publicPath
  };
}
