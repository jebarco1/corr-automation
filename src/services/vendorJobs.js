import { getStore, makeId, nowIso } from "../db/store.js";
import { emitVendorEvent } from "./webhooks.js";
import { updateLead } from "./vendorLeads.js";

export const JOB_STATUSES = ["scheduled", "in_progress", "done", "cancelled"];

function mapJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    vendorId: row.vendor_id,
    quoteId: row.quote_id,
    leadId: row.lead_id,
    category: row.category,
    title: row.title,
    serviceAddress: row.service_address,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    assignee: row.assignee,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getJob(vendorId, jobId) {
  return mapJob(getStore().jobs.findOne({ vendor_id: vendorId, id: jobId }));
}

export function listJobs(vendorId, options = {}) {
  const query = { vendor_id: vendorId };
  if (options.status) query.status = options.status;
  const rows = getStore().jobs.find(query, {
    sort: [{ key: "scheduled_start", dir: "asc", coalesce: "created_at" }],
    limit: Math.min(Number(options.limit || 100), 500)
  });
  return { count: rows.length, jobs: rows.map(mapJob) };
}

export function createJob(vendorId, input = {}) {
  if (!input.title && !input.serviceName) {
    const error = new Error("title is required");
    error.statusCode = 400;
    throw error;
  }
  const id = makeId("job");
  const now = nowIso();
  const start = input.scheduledStart || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const end = input.scheduledEnd || new Date(new Date(start).getTime() + 2 * 3600 * 1000).toISOString();
  getStore().jobs.insert({
    id,
    vendor_id: vendorId,
    quote_id: input.quoteId || null,
    lead_id: input.leadId || null,
    category: input.category || null,
    title: input.title || input.serviceName,
    service_address: input.serviceAddress || null,
    scheduled_start: start,
    scheduled_end: end,
    assignee: input.assignee || "unassigned",
    status: JOB_STATUSES.includes(input.status) ? input.status : "scheduled",
    notes: input.notes || null,
    created_at: now,
    updated_at: now
  });
  const job = getJob(vendorId, id);
  if (job.leadId) updateLead(vendorId, job.leadId, { status: "scheduled" });
  emitVendorEvent(vendorId, "job.scheduled", { job }).catch(() => {});
  return job;
}

export async function createJobFromQuote(vendorId, quote, options = {}) {
  return createJob(vendorId, {
    quoteId: quote.id,
    leadId: quote.leadId,
    category: quote.category,
    title: options.title || quote.serviceName || "Service job",
    serviceAddress: quote.serviceAddress,
    scheduledStart: options.scheduledStart,
    scheduledEnd: options.scheduledEnd,
    assignee: options.assignee || "crew-1",
    notes: options.notes || `Auto-created from quote ${quote.id}`
  });
}

export function updateJob(vendorId, jobId, patch = {}) {
  const existing = getJob(vendorId, jobId);
  if (!existing) {
    const error = new Error("Job not found");
    error.statusCode = 404;
    throw error;
  }
  if (patch.status && !JOB_STATUSES.includes(patch.status)) {
    const error = new Error(`status must be one of: ${JOB_STATUSES.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  const next = { ...existing, ...patch };
  getStore().jobs.updateWhere({ vendor_id: vendorId, id: jobId }, {
    title: next.title,
    service_address: next.serviceAddress,
    scheduled_start: next.scheduledStart,
    scheduled_end: next.scheduledEnd,
    assignee: next.assignee,
    status: next.status,
    notes: next.notes,
    updated_at: nowIso()
  });
  return getJob(vendorId, jobId);
}
