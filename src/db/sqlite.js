/**
 * Compatibility shim — vendor data is stored in a pure JSON file DB.
 * No node:sqlite / better-sqlite3 required.
 */
export {
  getDb,
  getStore,
  makeId,
  nowIso,
  parseJson,
  rowToVendor
} from "./store.js";
