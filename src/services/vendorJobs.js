import { getDb, makeId, nowIso } from "../db/sqlite.js";
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
  const row = getDb().prepare("SELECT * FROM jobs WHERE vendor_id = ? AND id = ?").get(vendorId, jobId);
  return mapJob(row);
}

export function listJobs(vendorId, options = {}) {
  const clauses = ["vendor_id = ?"];
  const params = [vendorId];
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  const rows = getDb().prepare(`
    SELECT * FROM jobs WHERE ${clauses.join(" AND ")}
    ORDER BY COALESCE(scheduled_start, created_at) ASC LIMIT ?
  `).all(...params, Math.min(Number(options.limit || 100), 500));
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
  getDb().prepare(`
    INSERT INTO jobs (
      id, vendor_id, quote_id, lead_id, category, title, service_address,
      scheduled_start, scheduled_end, assignee, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    vendorId,
    input.quoteId || null,
    input.leadId || null,
    input.category || null,
    input.title || input.serviceName,
    input.serviceAddress || null,
    start,
    end,
    input.assignee || "unassigned",
    JOB_STATUSES.includes(input.status) ? input.status : "scheduled",
    input.notes || null,
    now,
    now
  );
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
  const now = nowIso();
  getDb().prepare(`
    UPDATE jobs SET
      title = ?, service_address = ?, scheduled_start = ?, scheduled_end = ?,
      assignee = ?, status = ?, notes = ?, updated_at = ?
    WHERE vendor_id = ? AND id = ?
  `).run(
    next.title, next.serviceAddress, next.scheduledStart, next.scheduledEnd,
    next.assignee, next.status, next.notes, now, vendorId, jobId
  );
  return getJob(vendorId, jobId);
}
