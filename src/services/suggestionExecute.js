import { promoteAutopilotSimToCrm, quoteSendJobForLead } from "./crmPromote.js";
import {
  addLeadNote,
  assignLead,
  getLead,
  listLeads,
  updateLead
} from "./vendorLeads.js";
import { getJob, listJobs, updateJob } from "./vendorJobs.js";
import { suggestAmountForLead } from "./vendorPricebook.js";
import { runVendorAutopilot } from "./vendorAutopilot.js";
import { listQuotes, sendQuote } from "./vendorQuotes.js";

function findCrmLead(vendorId, hint = {}) {
  if (hint.crmLeadId) {
    const lead = getLead(vendorId, hint.crmLeadId);
    if (lead) return lead;
  }
  if (hint.leadId || hint.simLeadId) {
    const external = hint.leadId || hint.simLeadId;
    const listed = listLeads(vendorId, { limit: 200 });
    const byExternal = listed.leads.find(lead => lead.externalLeadId === external);
    if (byExternal) return byExternal;
    const byId = listed.leads.find(lead => lead.id === external);
    if (byId) return byId;
  }
  if (hint.name) {
    const listed = listLeads(vendorId, { limit: 200 });
    const byName = listed.leads.find(lead =>
      String(lead.name || "").toLowerCase() === String(hint.name).toLowerCase()
    );
    if (byName) return byName;
  }
  return null;
}

async function ensureSimPromoted(vendorId, input = {}) {
  const leads = Array.isArray(input.leads) ? input.leads : [];
  if (!leads.length) return { imported: 0, leads: [] };
  return promoteAutopilotSimToCrm(vendorId, {
    category: input.category,
    leads
  });
}

async function executeFollowUp(vendorId, suggestion, context = {}) {
  const lead = findCrmLead(vendorId, {
    crmLeadId: suggestion.crmLeadId,
    leadId: suggestion.leadId || suggestion.simLeadId,
    name: suggestion.leadName || context.leadName
  });
  if (!lead) {
    const error = new Error("No matching CRM lead — promote sim leads first or pass leads[]");
    error.statusCode = 404;
    throw error;
  }

  const assignee = suggestion.assignee || context.assignee || "alex";
  const assigned = assignLead(vendorId, lead.id, assignee);
  const noteText = suggestion.note
    || suggestion.copyText
    || `Autopilot ROI action (${suggestion.id}): follow-up started for ${lead.name}.`;
  const noted = addLeadNote(vendorId, lead.id, {
    text: noteText,
    author: "autopilot-roi"
  });
  const status = suggestion.targetStatus || "contacted";
  const updated = updateLead(vendorId, lead.id, { status });

  return {
    action: "follow-up",
    lead: updated || noted || assigned,
    assignee,
    note: noteText,
    status
  };
}

async function executeCloseQuotes(vendorId, suggestion, context = {}) {
  let lead = findCrmLead(vendorId, {
    crmLeadId: suggestion.crmLeadId,
    leadId: suggestion.leadId || suggestion.simLeadId,
    name: suggestion.leadName || context.leadName
  });

  // Prefer an existing draft quote if present
  if (!lead && suggestion.leadId) {
    const listed = listLeads(vendorId, { limit: 100, status: "quoted" });
    lead = listed.leads[0] || null;
  }
  if (!lead) {
    const listed = listLeads(vendorId, { limit: 100 });
    lead = listed.leads.find(item => item.status === "quoted" || item.quoteId)
      || listed.leads.find(item => item.status === "contact-ready")
      || listed.leads[0]
      || null;
  }
  if (!lead) {
    const error = new Error("No CRM lead available to quote");
    error.statusCode = 404;
    throw error;
  }

  const priced = suggestAmountForLead(vendorId, lead, {
    category: context.category || lead.category
  });
  const amount = Number(suggestion.amount || context.amount || priced.amount);

  if (lead.quoteId) {
    const quotes = listQuotes(vendorId, { limit: 50 });
    const existing = quotes.quotes.find(quote => quote.id === lead.quoteId);
    if (existing && existing.status === "draft") {
      const sent = await sendQuote(vendorId, existing.id, { sms: false });
      return {
        action: "close-quote",
        lead,
        quote: sent.quote,
        link: sent.link,
        amount: sent.quote.amount,
        pricebook: { amount: priced.amount, version: priced.pricebookVersion }
      };
    }
  }

  const result = await quoteSendJobForLead(vendorId, lead, {
    amount,
    send: suggestion.send !== false,
    accept: suggestion.accept === true,
    serviceName: suggestion.serviceName,
    notes: `Autopilot ROI close-quotes · pricebook $${priced.amount}`
  });

  return {
    action: "close-quote",
    lead: result.lead,
    quote: result.quote,
    job: result.job,
    link: result.link,
    amount: result.quote?.amount,
    pricebook: { amount: priced.amount, version: priced.pricebookVersion }
  };
}

async function executeConfirmJob(vendorId, suggestion) {
  const jobs = listJobs(vendorId, { limit: 50 });
  let job = suggestion.jobId
    ? getJob(vendorId, suggestion.jobId)
    : jobs.jobs.find(item => item.status === "scheduled") || jobs.jobs[0];

  if (!job) {
    const error = new Error("No job found to confirm");
    error.statusCode = 404;
    throw error;
  }

  const updated = updateJob(vendorId, job.id, {
    status: suggestion.targetStatus || job.status || "scheduled",
    notes: `Confirmed via Autopilot ROI dashboard at ${new Date().toISOString()}`
  });

  if (job.leadId) {
    addLeadNote(vendorId, job.leadId, {
      text: `Job ${job.id} confirmed — arrival window locked.`,
      author: "autopilot-roi"
    });
  }

  return { action: "confirm-job", job: updated };
}

async function executeImportCrm(vendorId, suggestion, context = {}) {
  const leads = Array.isArray(suggestion.leads)
    ? suggestion.leads
    : (Array.isArray(context.leads) ? context.leads : []);
  if (!leads.length) {
    const error = new Error("leads[] required to import into CRM");
    error.statusCode = 400;
    throw error;
  }
  const imported = await ensureSimPromoted(vendorId, {
    category: context.category || suggestion.category,
    leads
  });
  return {
    action: "import-crm",
    imported: imported.imported,
    leadIds: (imported.leads || []).map(lead => lead.id)
  };
}

async function executeExpand(vendorId, suggestion, context = {}) {
  const result = await runVendorAutopilot(vendorId, {
    category: context.category || suggestion.category || "landscape",
    segment: suggestion.segment || "b2b",
    limit: Number(suggestion.limit || 4),
    quoteLimit: Number(suggestion.quoteLimit || 2),
    send: true,
    skipCostGate: suggestion.skipCostGate !== false,
    cities: suggestion.cities || ["Atlanta", "Savannah", "Augusta"]
  });
  return { action: "expand-cities", autopilot: result };
}

async function executeCopyScript(vendorId, suggestion, context = {}) {
  const lead = findCrmLead(vendorId, {
    crmLeadId: suggestion.crmLeadId,
    leadId: suggestion.leadId || suggestion.simLeadId,
    name: suggestion.leadName
  });
  const script = suggestion.copyText || suggestion.note || "Outreach script from Autopilot ROI.";
  if (lead) {
    addLeadNote(vendorId, lead.id, {
      text: `Script: ${script}`,
      author: "autopilot-roi"
    });
  }
  return {
    action: "copy-script",
    script,
    leadId: lead?.id || null,
    copied: true
  };
}

/**
 * Execute a ranked Autopilot ROI suggestion against the live tenant CRM.
 * Body: { suggestion, category, leads?, assignee?, amount? }
 */
export async function executeAutopilotSuggestion(vendorId, input = {}) {
  const suggestion = input.suggestion || input;
  if (!suggestion?.id && !suggestion?.crmAction) {
    const error = new Error("suggestion with id or crmAction is required");
    error.statusCode = 400;
    throw error;
  }

  const crmAction = suggestion.crmAction || suggestion.id;
  const context = {
    category: input.category || suggestion.category,
    leads: input.leads || suggestion.leads,
    assignee: input.assignee || suggestion.assignee,
    amount: input.amount,
    leadName: suggestion.leadName
  };

  // Lead-scoped actions promote the current sim batch first (deduped by external id)
  let promoted = null;
  const needsPromote = ["follow-nurture", "start-outreach", "close-quotes", "import-crm", "confirm-jobs", "copy-script"]
    .includes(crmAction);
  if (needsPromote && Array.isArray(context.leads) && context.leads.length && crmAction !== "import-crm") {
    promoted = await ensureSimPromoted(vendorId, context);
  }

  let result;
  switch (crmAction) {
    case "follow-nurture":
    case "start-outreach":
      result = await executeFollowUp(vendorId, suggestion, context);
      break;
    case "close-quotes":
      result = await executeCloseQuotes(vendorId, suggestion, context);
      break;
    case "confirm-jobs":
      result = await executeConfirmJob(vendorId, suggestion);
      break;
    case "import-crm":
      result = await executeImportCrm(vendorId, suggestion, context);
      break;
    case "expand-cities":
      result = await executeExpand(vendorId, suggestion, context);
      break;
    case "copy-script":
      result = await executeCopyScript(vendorId, suggestion, context);
      break;
    default: {
      const error = new Error(`Unsupported CRM action: ${crmAction}`);
      error.statusCode = 400;
      throw error;
    }
  }

  const pipeline = listLeads(vendorId, { limit: 50 });
  return {
    status: "executed",
    crmAction,
    suggestionId: suggestion.id || crmAction,
    promoted: promoted ? { imported: promoted.imported } : null,
    result,
    crmSnapshot: { leadCount: pipeline.count },
    message: `Executed ${crmAction} in Vendor Ops CRM.`
  };
}
