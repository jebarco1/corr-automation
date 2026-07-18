import { Router } from "express";
import { startAIWorkflow, continueAIWorkflow, chatWithAssistant } from "../ai/aiOrchestrator.js";
import { appConfig } from "../config/appConfig.js";

const router = Router();
router.get("/ai/status", (_req, res) => res.json({
  enabled: appConfig.ai.enabled,
  model: appConfig.ai.model,
  provider: "openai",
  chatbot: "/api/v1/ai/assistant"
}));
router.post("/ai/assistant", async (req, res, next) => {
  try {
    res.json(await chatWithAssistant(req.body || {}));
  } catch (e) {
    next(e);
  }
});
router.post("/ai/start", async (req, res, next) => {
  try {
    res.status(201).json(await startAIWorkflow(req.body || {}));
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
