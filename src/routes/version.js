import { Router } from "express";
import { currentApiVersion, getVersionPayload, listApiVersions } from "../config/apiVersion.js";

const router = Router();

router.get("/version", (_req, res) => {
  res.json(getVersionPayload(currentApiVersion));
});

router.get("/versions", (_req, res) => {
  res.json(listApiVersions());
});

export default router;
