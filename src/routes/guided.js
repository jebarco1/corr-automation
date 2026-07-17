import { Router } from "express";
import { requireClientApiKey } from "../middleware/clientApiKey.js";
import { answerGuidedWorkflow, createInvoiceFromSession, getGuidedWorkflow, listGuidedCategories, runGuidedStep, startGuidedWorkflow, createInstantQuote } from "../services/guidedWorkflow.js";

const router=Router();
const categories=["landscape","hvac","cleaning","pest-control","pool","painting","roofing","plumbing","electrical","general-contract","surveillance","trash-removal","transportation"];
router.post("/guided/quote",requireClientApiKey,(req,res,next)=>{try{const {category,...input}=req.body||{}; if(!category){const e=new Error("category is required");e.statusCode=400;throw e;} res.status(201).json(createInstantQuote(category,input));}catch(e){next(e);}});
router.get("/guided/categories",(_req,res)=>res.json({categories:listGuidedCategories()}));
for(const category of categories){
  router.post(`/${category}/quote`,requireClientApiKey,(req,res,next)=>{try{res.status(201).json(createInstantQuote(category,req.body||{}));}catch(e){next(e);}});
  router.post(`/${category}/start`,requireClientApiKey,(req,res,next)=>{try{res.status(201).json(startGuidedWorkflow(category,req.body||{}));}catch(e){next(e);}});
  router.get(`/${category}/sessions/:sessionId`,requireClientApiKey,(req,res,next)=>{try{res.json(getGuidedWorkflow(req.params.sessionId));}catch(e){next(e);}});
  router.post(`/${category}/sessions/:sessionId/answer`,requireClientApiKey,(req,res,next)=>{try{res.json(answerGuidedWorkflow(req.params.sessionId,req.body||{}));}catch(e){next(e);}});
  router.post(`/${category}/sessions/:sessionId/run-api`,requireClientApiKey,(req,res,next)=>{try{res.json(runGuidedStep(req.params.sessionId,req.body||{}));}catch(e){next(e);}});
  router.post(`/${category}/sessions/:sessionId/invoice`,requireClientApiKey,(req,res,next)=>{try{res.status(201).json(createInvoiceFromSession(req.params.sessionId,req.body||{}));}catch(e){next(e);}});
}
export default router;
