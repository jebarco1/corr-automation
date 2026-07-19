import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supportedCategories } from "../ai/toolCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const serviceCatalogDir = path.join(__dirname, "../../data/service-catalog");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function listServiceCatalogs() {
  const indexPath = path.join(serviceCatalogDir, "index.json");
  if (fs.existsSync(indexPath)) {
    return readJson(indexPath);
  }
  const categories = supportedCategories
    .filter(category => fs.existsSync(path.join(serviceCatalogDir, `${category}.json`)))
    .map(category => {
      const catalog = getServiceCatalog(category);
      return {
        category,
        label: catalog.label,
        file: `data/service-catalog/${category}.json`,
        serviceCount: catalog.services.length,
        defaultServiceId: catalog.defaultServiceId,
        endpoint: `/api/v1/${category}/services`
      };
    });
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    directory: "data/service-catalog",
    categories
  };
}

export function getServiceCatalog(category) {
  const filePath = path.join(serviceCatalogDir, `${category}.json`);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Service catalog not found for category: ${category}`);
    error.statusCode = 404;
    throw error;
  }
  return readJson(filePath);
}

export function listServices(category) {
  const catalog = getServiceCatalog(category);
  return {
    category: catalog.category,
    label: catalog.label,
    description: catalog.description,
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    defaultServiceId: catalog.defaultServiceId,
    count: catalog.services.length,
    services: catalog.services,
    file: `data/service-catalog/${category}.json`
  };
}

export function getServiceById(category, serviceId) {
  const catalog = getServiceCatalog(category);
  const service = catalog.services.find(item => item.id === serviceId || item.name === serviceId);
  if (!service) {
    const error = new Error(`Service not found: ${serviceId}`);
    error.statusCode = 404;
    throw error;
  }
  return { category, service };
}

/** Match freeform text to the best catalog service for a category. */
export function matchServiceFromText(category, message = "") {
  const catalog = getServiceCatalog(category);
  const text = ` ${String(message || "").toLowerCase()} `;
  let best = null;
  let bestScore = 0;

  for (const service of catalog.services) {
    if (service.active === false) continue;
    const needles = [service.id, service.name, ...(service.aliases || [])]
      .map(value => String(value || "").toLowerCase().replace(/[_-]/g, " ").trim())
      .filter(Boolean);

    let score = 0;
    for (const needle of needles) {
      if (!needle) continue;
      if (text.includes(` ${needle} `) || text.includes(needle)) {
        score += needle.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = service;
    }
  }

  if (!best) {
    best = catalog.services.find(item => item.id === catalog.defaultServiceId) || catalog.services[0];
  }
  return best || null;
}

export function serviceTypeLabel(service) {
  if (!service) return null;
  // Prefer human name for quote answers; keep id available for catalogs.
  return service.name;
}

function catalogPath(category) {
  return path.join(serviceCatalogDir, `${category}.json`);
}

function indexPath() {
  return path.join(serviceCatalogDir, "index.json");
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function refreshIndexCount(category, serviceCount) {
  const file = indexPath();
  if (!fs.existsSync(file)) return;
  const index = readJson(file);
  const entry = (index.categories || []).find(item => item.category === category);
  if (!entry) return;
  entry.serviceCount = serviceCount;
  index.updatedAt = new Date().toISOString();
  writeJson(file, index);
}

export function slugifyServiceId(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Create or replace a service entry in the category catalog JSON. */
export function upsertCatalogService(category, serviceInput = {}) {
  const catalog = getServiceCatalog(category);
  const name = String(serviceInput.name || "").trim();
  if (!name) {
    const error = new Error("service.name is required");
    error.statusCode = 400;
    throw error;
  }

  let id = slugifyServiceId(serviceInput.id || name);
  if (!id) {
    const error = new Error("Could not derive a service id");
    error.statusCode = 400;
    throw error;
  }

  const existingIndex = catalog.services.findIndex(item => item.id === id);
  if (existingIndex < 0 && catalog.services.some(item => item.id === id)) {
    id = `${id}-${catalog.services.length + 1}`;
  }

  const template = existingIndex >= 0 ? catalog.services[existingIndex] : (catalog.services[0] || {});
  const nextService = {
    ...template,
    id,
    name,
    description: String(serviceInput.description ?? template.description ?? "").trim(),
    aliases: Array.isArray(serviceInput.aliases)
      ? serviceInput.aliases.map(String)
      : (template.aliases || []),
    billingUnit: serviceInput.billingUnit || template.billingUnit || "job",
    typicalFrequency: Array.isArray(serviceInput.typicalFrequency)
      ? serviceInput.typicalFrequency
      : (template.typicalFrequency || ["one-time"]),
    propertyTypes: Array.isArray(serviceInput.propertyTypes)
      ? serviceInput.propertyTypes
      : (template.propertyTypes || ["residential", "commercial", "hoa", "multi-family", "industrial"]),
    defaultHours: Number.isFinite(Number(serviceInput.defaultHours))
      ? Number(serviceInput.defaultHours)
      : (template.defaultHours ?? 2),
    relatedApis: Array.isArray(serviceInput.relatedApis)
      ? serviceInput.relatedApis.map(String)
      : (template.relatedApis || []),
    active: serviceInput.active !== false,
    quoteKey: String(serviceInput.quoteKey || name).toLowerCase(),
    inGuidedWorkflow: serviceInput.inGuidedWorkflow !== false
  };

  if (serviceInput.requiresShipping != null) {
    nextService.requiresShipping = !!serviceInput.requiresShipping;
  }

  if (existingIndex >= 0) catalog.services[existingIndex] = nextService;
  else catalog.services.push(nextService);

  catalog.updatedAt = new Date().toISOString();
  catalog.version = Number(catalog.version || 1) + (existingIndex >= 0 ? 0 : 0);
  writeJson(catalogPath(category), catalog);
  refreshIndexCount(category, catalog.services.length);
  return { category, created: existingIndex < 0, service: nextService, count: catalog.services.length };
}

/** Patch fields on an existing catalog service. */
export function patchCatalogService(category, serviceId, patch = {}) {
  const catalog = getServiceCatalog(category);
  const index = catalog.services.findIndex(item => item.id === serviceId || item.name === serviceId);
  if (index < 0) {
    const error = new Error(`Service not found: ${serviceId}`);
    error.statusCode = 404;
    throw error;
  }

  const current = catalog.services[index];
  const next = {
    ...current,
    ...patch,
    id: current.id,
    name: patch.name != null ? String(patch.name).trim() : current.name,
    description: patch.description != null ? String(patch.description).trim() : current.description
  };
  if (Array.isArray(patch.aliases)) next.aliases = patch.aliases.map(String);
  if (Array.isArray(patch.relatedApis)) next.relatedApis = patch.relatedApis.map(String);
  if (patch.defaultHours != null) next.defaultHours = Number(patch.defaultHours);
  if (patch.quoteKey != null) next.quoteKey = String(patch.quoteKey).toLowerCase();
  if (patch.inGuidedWorkflow != null) next.inGuidedWorkflow = !!patch.inGuidedWorkflow;
  if (patch.active != null) next.active = !!patch.active;
  if (patch.requiresShipping != null) next.requiresShipping = !!patch.requiresShipping;

  catalog.services[index] = next;
  catalog.updatedAt = new Date().toISOString();
  writeJson(catalogPath(category), catalog);
  refreshIndexCount(category, catalog.services.length);
  return { category, service: next, count: catalog.services.length };
}
