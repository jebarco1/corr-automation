/**
 * HA-Corr API release classes.
 * Path versioning stays on /api/v1; Class + codename track product releases.
 */
export const API_PATH_VERSION = "v1";

export const apiVersions = Object.freeze([
  Object.freeze({
    class: "0.5",
    codename: "Coaxium",
    name: "Class 0.5 Coaxium",
    semver: "0.5.0",
    apiPath: "v1",
    status: "current",
    releasedAt: "2026-07-17",
    description: "Current HA-Corr Automation release with multi-trade starter calculations, guided workflows, AI orchestration, categories catalog, and transportation.",
    highlights: [
      "13 industry namespaces including transportation",
      "Guided start-to-invoice workflows",
      "AI-first authenticated workflow",
      "GET /categories catalog with descriptions",
      "Shared fleet, mapping, business, and sales APIs"
    ]
  })
]);

export const currentApiVersion = apiVersions.find(v => v.status === "current") || apiVersions[0];

export function getVersionPayload(version = currentApiVersion) {
  return {
    name: version.name,
    class: version.class,
    codename: version.codename,
    semver: version.semver,
    apiPath: version.apiPath,
    status: version.status,
    releasedAt: version.releasedAt,
    description: version.description,
    highlights: version.highlights,
    links: {
      health: "/health",
      docs: "/docs",
      openapi: "/openapi.yaml",
      version: `/api/${version.apiPath}/version`,
      versions: `/api/${version.apiPath}/versions`,
      categories: `/api/${version.apiPath}/categories`
    }
  };
}

export function listApiVersions() {
  return {
    current: currentApiVersion.name,
    apiPath: API_PATH_VERSION,
    count: apiVersions.length,
    versions: apiVersions.map(getVersionPayload)
  };
}
