import { currentApiVersion } from "../config/apiVersion.js";

export function apiVersionHeaders(_req, res, next) {
  res.setHeader("X-API-Class", currentApiVersion.class);
  res.setHeader("X-API-Codename", currentApiVersion.codename);
  res.setHeader("X-API-Version-Name", currentApiVersion.name);
  res.setHeader("X-API-Semver", currentApiVersion.semver);
  res.setHeader("X-API-Path-Version", currentApiVersion.apiPath);
  next();
}
