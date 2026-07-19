import { Router } from "express";
import { startAIWorkflow, continueAIWorkflow, chatWithAssistant } from "../ai/aiOrchestrator.js";
import { appConfig } from "../config/appConfig.js";
import { evaluateCostGate } from "../services/costQuote.js";

const router = Router();
router.get("/ai/status", (_req, res) => res.json({
  enabled: appConfig.ai.enabled,
  model: appConfig.ai.model,
  provider: "openai",
  chatbot: "/api/v1/ai/assistant",
  costQuote: "/api/v1/cost/quote"
}));
router.post("/ai/assistant", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.quoteOnly === true || body.requireCostQuote === true || body.maxCostUsd != null) {
      const gate = evaluateCostGate("ai.assistant", body, body);
      if (!gate.ok) return res.status(gate.statusCode).json(gate.body);
    }
    res.json(await chatWithAssistant(body));
  } catch (e) {
    next(e);
  }
});
router.post("/ai/start", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.quoteOnly === true || body.requireCostQuote === true || body.maxCostUsd != null) {
      const gate = evaluateCostGate("ai.start", body, body);
      if (!gate.ok) return res.status(gate.statusCode).json(gate.body);
    }
    res.status(201).json(await startAIWorkflow(body));
  } catch (e) {
    next(e);
  }
});
router.post("/ai/chat", async (req, res, next) => {
  try {
    res.json(await continueAIWorkflow(req.body || {}));
  } catch (e) {
    next(e);
  }
});
export default router;
