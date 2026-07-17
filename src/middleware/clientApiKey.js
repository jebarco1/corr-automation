import crypto from "crypto";
import { appConfig } from "../config/appConfig.js";

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * When CORR_CLIENT_API_KEYS is unset, routes stay open for the local UI.
 * When keys are configured, X-API-Key / Bearer is required for protected routes.
 */
export function requireClientApiKey(req, res, next) {
  if (!appConfig.clientApiKeys.length) return next();

  const supplied = req.get("x-api-key") || req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied || !appConfig.clientApiKeys.some(key => safeEqual(key, supplied))) {
    return res.status(401).json({ error: "A valid X-API-Key header is required." });
  }
  next();
}
