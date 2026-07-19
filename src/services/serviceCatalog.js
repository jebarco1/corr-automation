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
