const csv = value => String(value || "").split(",").map(v => v.trim()).filter(Boolean);

export const appConfig = Object.freeze({
  clientApiKeys: csv(process.env.CORR_CLIENT_API_KEYS),
  ai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    enabled: Boolean(process.env.OPENAI_API_KEY)
  }
});
