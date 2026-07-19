const csv = value => String(value || "").split(",").map(v => v.trim()).filter(Boolean);

export const appConfig = Object.freeze({
  clientApiKeys: csv(process.env.CORR_CLIENT_API_KEYS),
  ai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    enabled: Boolean(process.env.OPENAI_API_KEY)
  },
  origami: {
    apiKey: process.env.ORIGAMI_API_KEY || "",
    baseURL: process.env.ORIGAMI_BASE_URL || "https://origami.chat/api/v2",
    projectId: process.env.ORIGAMI_PROJECT_ID || "",
    model: process.env.ORIGAMI_MODEL || "",
    enabled: Boolean(process.env.ORIGAMI_API_KEY),
    pollMs: Number(process.env.ORIGAMI_POLL_MS || 15000),
    maxWaitMs: Number(process.env.ORIGAMI_MAX_WAIT_MS || 360000),
    requestTimeoutMs: Number(process.env.ORIGAMI_REQUEST_TIMEOUT_MS || 30000)
  },
  cost: {
    requireConfirmation: String(process.env.COST_REQUIRE_CONFIRMATION || "").toLowerCase() === "true",
    quoteTtlSeconds: Number(process.env.COST_QUOTE_TTL_SECONDS || 1800),
    defaultMaxUsd: process.env.COST_DEFAULT_MAX_USD
      ? Number(process.env.COST_DEFAULT_MAX_USD)
      : null
  }
});
