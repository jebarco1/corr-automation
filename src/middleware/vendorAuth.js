import { resolveVendorFromApiKey } from "../services/vendors.js";

/**
 * Requires a vendor API key (vcorr_...) via X-API-Key or Authorization Bearer.
 * Sets req.vendor and req.vendorKeyId.
 */
export function requireVendorApiKey(req, res, next) {
  const supplied = req.get("x-api-key") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied || !String(supplied).startsWith("vcorr_")) {
    return res.status(401).json({
      error: "Vendor API key required",
      code: "VENDOR_AUTH_REQUIRED",
      hint: "Create a vendor with POST /api/v1/vendors, then send X-API-Key: vcorr_..."
    });
  }
  const resolved = resolveVendorFromApiKey(supplied);
  if (!resolved) {
    return res.status(401).json({
      error: "Invalid or revoked vendor API key",
      code: "VENDOR_AUTH_INVALID"
    });
  }
  req.vendor = resolved.vendor;
  req.vendorKeyId = resolved.keyId;
  next();
}
