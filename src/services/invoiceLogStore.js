import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { assertCategory } from "./pricingStandards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const invoiceLogsDir = path.join(__dirname, "../../data/invoice-logs");

function categoryDir(category) {
  return path.join(invoiceLogsDir, category);
}

function indexPath(category) {
  return path.join(categoryDir(category), "index.json");
}

function ensureCategoryDir(category) {
  assertCategory(category);
  fs.mkdirSync(categoryDir(category), { recursive: true });
  if (!fs.existsSync(indexPath(category))) {
    fs.writeFileSync(indexPath(category), `${JSON.stringify({ category, logs: [] }, null, 2)}\n`, "utf8");
  }
}

function readIndex(category) {
  ensureCategoryDir(category);
  return JSON.parse(fs.readFileSync(indexPath(category), "utf8"));
}

function writeIndex(category, index) {
  ensureCategoryDir(category);
  fs.writeFileSync(indexPath(category), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function normalizeInvoiceEntry(category, entry = {}) {
  const invoice = entry.invoice || entry;
  const area = String(entry.area || invoice.serviceArea || invoice.area || invoice.serviceAddress || "Unknown").trim();
  const total = Number(invoice.total ?? entry.total ?? 0);
  const lineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : (Array.isArray(entry.lineItems) ? entry.lineItems : []);
  return {
    logId: `invlog_${crypto.randomUUID()}`,
    category,
    uploadedAt: new Date().toISOString(),
    area,
    serviceType: entry.serviceType || invoice.serviceType || invoice.categoryLabel || null,
    currency: invoice.currency || entry.currency || "USD",
    total: Number.isFinite(total) ? total : 0,
    subtotal: Number(invoice.subtotal ?? entry.subtotal ?? total) || 0,
    laborHours: Number(entry.laborHours ?? invoice.laborHours ?? invoice.estimatedHours ?? 0) || 0,
    hourlyRate: Number(entry.hourlyRate ?? invoice.hourlyRate ?? 0) || 0,
    crewSize: Number(entry.crewSize ?? invoice.crewSize ?? 0) || 0,
    lineItems,
    invoice: {
      invoiceNumber: invoice.invoiceNumber || entry.invoiceNumber || null,
      customer: invoice.customer || entry.customer || null,
      serviceAddress: invoice.serviceAddress || entry.serviceAddress || null,
      serviceDate: invoice.serviceDate || entry.serviceDate || null,
      notes: invoice.notes || entry.notes || null,
      ...invoice
    },
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    source: entry.source || "upload"
  };
}

export function uploadInvoiceLogs(category, body = {}) {
  assertCategory(category);
  const entries = Array.isArray(body.invoices) ? body.invoices : (body.invoice || body.total || body.lineItems ? [body] : []);
  if (!entries.length) {
    const error = new Error("Provide invoice or invoices[] to upload an invoice log");
    error.statusCode = 400;
    throw error;
  }
  const index = readIndex(category);
  const created = entries.map(entry => {
    const normalized = normalizeInvoiceEntry(category, entry);
    const file = path.join(categoryDir(category), `${normalized.logId}.json`);
    fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    index.logs.unshift({
      logId: normalized.logId,
      uploadedAt: normalized.uploadedAt,
      area: normalized.area,
      total: normalized.total,
      serviceType: normalized.serviceType,
      file: `data/invoice-logs/${category}/${normalized.logId}.json`
    });
    return normalized;
  });
  index.updatedAt = new Date().toISOString();
  writeIndex(category, index);
  return {
    category,
    uploaded: created.length,
    logs: created,
    indexCount: index.logs.length
  };
}

export function listInvoiceLogs(category, options = {}) {
  assertCategory(category);
  const index = readIndex(category);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 500);
  const area = options.area ? String(options.area) : null;
  let logs = index.logs || [];
  if (area) logs = logs.filter(item => String(item.area).toLowerCase() === area.toLowerCase());
  return {
    category,
    count: logs.length,
    logs: logs.slice(0, limit)
  };
}

export function loadInvoiceLogDetails(category, limit = 100) {
  const listing = listInvoiceLogs(category, { limit });
  return listing.logs.map(item => {
    const file = path.join(categoryDir(category), `${item.logId}.json`);
    if (!fs.existsSync(file)) return item;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  });
}

export function aggregateInvoiceLogsByArea(category, limit = 250) {
  const details = loadInvoiceLogDetails(category, limit);
  const byArea = {};
  for (const log of details) {
    const key = log.area || "Unknown";
    if (!byArea[key]) {
      byArea[key] = {
        area: key,
        invoiceCount: 0,
        totals: [],
        hourlyRates: [],
        laborHours: [],
        serviceTypes: {}
      };
    }
    const bucket = byArea[key];
    bucket.invoiceCount += 1;
    if (Number(log.total) > 0) bucket.totals.push(Number(log.total));
    if (Number(log.hourlyRate) > 0) bucket.hourlyRates.push(Number(log.hourlyRate));
    if (Number(log.laborHours) > 0) bucket.laborHours.push(Number(log.laborHours));
    const serviceType = log.serviceType || "unspecified";
    bucket.serviceTypes[serviceType] = (bucket.serviceTypes[serviceType] || 0) + 1;
  }

  const areas = Object.values(byArea).map(bucket => {
    const avg = values => values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2)) : null;
    return {
      area: bucket.area,
      invoiceCount: bucket.invoiceCount,
      averageTotal: avg(bucket.totals),
      medianTotal: bucket.totals.length ? Number([...bucket.totals].sort((a, b) => a - b)[Math.floor(bucket.totals.length / 2)].toFixed(2)) : null,
      averageHourlyRate: avg(bucket.hourlyRates),
      averageLaborHours: avg(bucket.laborHours),
      serviceTypes: bucket.serviceTypes
    };
  });

  return { category, invoiceCount: details.length, areas };
}
