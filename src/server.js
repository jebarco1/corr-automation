import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import automationRouter from "./routes/automation.js";
import guidedRouter from "./routes/guided.js";
import aiRouter from "./routes/ai.js";
import versionRouter from "./routes/version.js";
import pricingInsightsRouter from "./routes/pricingInsights.js";
import salesExpansionRouter from "./routes/salesExpansion.js";
import costQuoteRouter from "./routes/costQuote.js";
import vendorRouter from "./routes/vendor.js";
import publicBookingRouter from "./routes/publicBooking.js";
import { requireClientApiKey } from "./middleware/clientApiKey.js";
import { apiVersionHeaders } from "./middleware/apiVersionHeaders.js";
import { currentApiVersion, getVersionPayload } from "./config/apiVersion.js";
import { ensureAllPricingStandards } from "./services/pricingStandards.js";
import { ensureDemoVendor } from "./services/vendors.js";
import { getStore } from "./db/store.js";

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const openapi = YAML.load(join(__dirname, "../openapi.yaml"));
openapi.info = {
  ...openapi.info,
  version: currentApiVersion.semver,
  "x-api-class": currentApiVersion.class,
  "x-api-codename": currentApiVersion.codename,
  "x-api-version-name": currentApiVersion.name
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(apiVersionHeaders);

app.get("/health", (_req, res) => res.json({
  status: "ok",
  project: "ha-corr-automation",
  version: currentApiVersion.semver,
  apiClass: currentApiVersion.class,
  codename: currentApiVersion.codename,
  versionName: currentApiVersion.name,
  apiPath: currentApiVersion.apiPath,
  docs: "/docs"
}));
app.get("/version", (_req, res) => res.json(getVersionPayload(currentApiVersion)));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, {
  explorer: true,
  customSiteTitle: `HA-Corr API — ${currentApiVersion.name}`
}));
app.get("/openapi.yaml", (_req, res) => res.sendFile(join(__dirname, "../openapi.yaml")));
ensureAllPricingStandards();
getStore();
const demoVendor = ensureDemoVendor();
if (demoVendor.created && demoVendor.apiKey) {
  console.log(`Demo vendor ready: slug=${demoVendor.vendor.slug} apiKey=${demoVendor.apiKey}`);
}

app.use("/api/v1", versionRouter);
// UI workflow uses server-side OPENAI_API_KEY; no client API key required for AI/guided quoting.
app.use("/api/v1", aiRouter);
app.use("/api/v1", guidedRouter);
app.use("/api/v1", pricingInsightsRouter);
app.use("/api/v1", costQuoteRouter);
app.use("/api/v1", salesExpansionRouter);
app.use("/api/v1", vendorRouter);
app.use("/api/v1", publicBookingRouter);
app.use("/api/v1", requireClientApiKey, automationRouter);
const clientDist = join(__dirname, "../client/dist");
app.use(express.static(clientDist));
app.get(["/", "/app", "/app/*", "/book", "/book/*"], (_req, res, next) => {
  const indexPath = join(clientDist, "index.html");
  res.sendFile(indexPath, error => error ? next() : undefined);
});
app.use((req, res) => res.status(404).json({ error: "Endpoint not found", method: req.method, path: req.path, docs: "/docs" }));
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(Number(error.statusCode) || 500).json({ error: error.message || "Internal server error" });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`HA-Corr Automation ${currentApiVersion.name} listening on http://localhost:${port}; Swagger: http://localhost:${port}/docs`));
