import "dotenv/config";
import { ensureDemoVendor, createVendorKey } from "../src/services/vendors.js";
import { getDb } from "../src/db/sqlite.js";

getDb();
const demo = ensureDemoVendor();
let apiKey = demo.apiKey;
if (!apiKey) {
  const created = createVendorKey(demo.vendor.id, { label: `seed-${Date.now()}` });
  apiKey = created.apiKey;
}

console.log(JSON.stringify({
  vendor: demo.vendor,
  apiKey,
  booking: `/book/${demo.vendor.slug}`,
  me: "GET /api/v1/vendors/me"
}, null, 2));
