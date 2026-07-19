import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const overridesPath = path.join(__dirname, "../../data/service-docs/overrides.json");

function emptyOverrides() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    formulas: {},
    inputOverrides: {}
  };
}

export function readOverrides() {
  if (!fs.existsSync(overridesPath)) return emptyOverrides();
  try {
    const data = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
    return {
      version: data.version || 1,
      updatedAt: data.updatedAt || new Date().toISOString(),
      formulas: data.formulas || {},
      inputOverrides: data.inputOverrides || {}
    };
  } catch {
    return emptyOverrides();
  }
}

function writeOverrides(data) {
  const dir = path.dirname(overridesPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next = {
    version: data.version || 1,
    updatedAt: new Date().toISOString(),
    formulas: data.formulas || {},
    inputOverrides: data.inputOverrides || {}
  };
  fs.writeFileSync(overridesPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function formulaOverrideKey(category, serviceId) {
  return `${category}:${serviceId}`;
}

export function getFormulaOverride(category, serviceId, quoteKey) {
  const overrides = readOverrides().formulas || {};
  const byId = overrides[formulaOverrideKey(category, serviceId)];
  if (byId) return byId;
  if (quoteKey) {
    const slug = String(quoteKey).trim().toLowerCase().replace(/\s+/g, "-");
    return overrides[`${category}:${slug}`] || null;
  }
  return null;
}

export function setFormulaOverride(category, serviceId, calculation = {}) {
  const data = readOverrides();
  const key = formulaOverrideKey(category, serviceId);
  data.formulas[key] = {
    formula: String(calculation.formula || "").trim(),
    summary: String(calculation.summary || "").trim(),
    notes: Array.isArray(calculation.notes) ? calculation.notes.map(String) : []
  };
  writeOverrides(data);
  return data.formulas[key];
}

export function getInputOverride(category, serviceId) {
  return readOverrides().inputOverrides?.[formulaOverrideKey(category, serviceId)] || null;
}

export function setInputOverride(category, serviceId, override = {}) {
  const data = readOverrides();
  const key = formulaOverrideKey(category, serviceId);
  const prev = data.inputOverrides[key] || {};
  data.inputOverrides[key] = {
    add: Array.isArray(override.add) ? override.add : (prev.add || []),
    remove: Array.isArray(override.remove) ? override.remove : (prev.remove || []),
    patch: typeof override.patch === "object" && override.patch ? override.patch : (prev.patch || {})
  };
  writeOverrides(data);
  return data.inputOverrides[key];
}

export function mergeInputOverride(category, serviceId, mutation = {}) {
  const prev = getInputOverride(category, serviceId) || { add: [], remove: [], patch: {} };
  const add = [...(prev.add || [])];
  for (const item of mutation.add || []) {
    const idx = add.findIndex(entry => entry.key === item.key);
    if (idx >= 0) add[idx] = { ...add[idx], ...item };
    else add.push(item);
  }
  const remove = Array.from(new Set([...(prev.remove || []), ...(mutation.remove || [])]));
  const patch = { ...(prev.patch || {}), ...(mutation.patch || {}) };
  return setInputOverride(category, serviceId, { add, remove, patch });
}
