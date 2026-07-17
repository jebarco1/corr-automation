import { Router } from "express";
import { z } from "zod";
import { getNearbyParcelAddresses, getParcelAcreageByAddress } from "../services/regrid.js";
import { runAutomation } from "../services/automationEngine.js";

const router = Router();
const objectSchema = z.object({}).passthrough();
const acreageSchema = z.object({ address: z.string().trim().min(8).max(250) });
const nearbySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMiles: z.coerce.number().positive().max(Number(process.env.NEARBY_MAX_RADIUS_MILES || 25)).default(Number(process.env.NEARBY_DEFAULT_RADIUS_MILES || 0.5)),
  limit: z.coerce.number().int().min(1).max(1000).default(Number(process.env.NEARBY_DEFAULT_LIMIT || 100))
});

const execute = type => (req, res, next) => {
  try {
    const parsed = objectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Request body must be a JSON object", details: parsed.error.flatten() });
    return res.json(runAutomation(type, parsed.data));
  } catch (error) { next(error); }
};

// Shared live parcel integrations
router.post("/landscape/properties/acreage", async (req,res,next)=>{ try { const parsed=acreageSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"A valid street address is required",details:parsed.error.flatten()}); res.json(await getParcelAcreageByAddress(parsed.data.address)); } catch(e){next(e);} });
router.get("/landscape/properties/nearby", async (req,res,next)=>{ try { const parsed=nearbySchema.safeParse(req.query); if(!parsed.success)return res.status(400).json({error:"Valid coordinates are required",details:parsed.error.flatten()}); res.json(await getNearbyParcelAddresses(parsed.data)); } catch(e){next(e);} });
router.post("/landscape/properties/nearby", async (req,res,next)=>{ try { const parsed=nearbySchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"Valid coordinates are required",details:parsed.error.flatten()}); res.json(await getNearbyParcelAddresses(parsed.data)); } catch(e){next(e);} });

const landscape = {
  "/landscape/properties/search":"property-search", "/landscape/properties/mowable-area":"mowable-area",
  "/landscape/properties/irrigation-zones":"irrigation-zones", "/landscape/properties/tree-count":"tree-count",
  "/landscape/properties/fence-length":"fence-length", "/landscape/properties/driveway-area":"driveway-area",
  "/landscape/properties/parking-lot":"parking-lot", "/landscape/properties/intelligence":"property-intelligence",
  "/landscape/estimates/service":"landscaping-estimate", "/landscape/estimates/materials":"materials",
  "/landscape/estimates/labor":"labor", "/landscape/estimates/equipment":"equipment",
  "/landscape/scheduling/route-optimize":"route-optimize", "/landscape/scheduling/rain-delay":"rain-delay",
  "/landscape/scheduling/crew-balance":"crew-balance", "/landscape/scheduling/emergency-job":"emergency-insert",
  "/landscape/ai/job-photo-quality":"photo-quality", "/landscape/ai/estimate-from-photos":"estimate-from-photos",
  "/landscape/ai/damage-detection":"damage-detection", "/landscape/ai/weed-detection":"weed-detection",
  "/landscape/ai/turf-health":"turf-health"
};

const hvac = {
  "/hvac/property-profile":"hvac-property-profile", "/hvac/load-estimate":"hvac-load-estimate",
  "/hvac/roof-equipment-detection":"hvac-roof-equipment", "/hvac/equipment/inventory":"hvac-equipment-inventory",
  "/hvac/mechanical-room-scan":"mechanical-room-scan", "/hvac/equipment/health-score":"equipment-health-score",
  "/hvac/equipment/remaining-life":"equipment-remaining-life", "/hvac/equipment/replacement-cost":"equipment-replacement-cost",
  "/hvac/estimates/replacement":"hvac-replacement-estimate", "/hvac/estimates/maintenance-plan":"hvac-maintenance-plan",
  "/hvac/indoor-air-quality":"hvac-air-quality", "/hvac/diagnostics/fault-detection":"hvac-fault-detection",
  "/hvac/diagnostics/thermostat-analysis":"thermostat-analysis", "/hvac/diagnostics/refrigerant-leak":"refrigerant-leak",
  "/hvac/diagnostics/compressor-health":"compressor-health", "/hvac/diagnostics/airflow":"airflow-analysis",
  "/hvac/dispatch/emergency":"hvac-emergency-dispatch", "/hvac/dispatch/skill-match":"technician-skill-match",
  "/hvac/inventory/truck":"truck-inventory", "/hvac/parts/nearby":"parts-nearby",
  "/hvac/parts/cross-reference":"parts-cross-reference", "/hvac/warranty/lookup":"warranty-lookup",
  "/hvac/buildings/equipment-map":"equipment-map", "/hvac/buildings/preventive-calendar":"preventive-calendar",
  "/hvac/buildings/energy-consumption":"energy-consumption", "/hvac/inspections/chiller":"chiller-inspection",
  "/hvac/inspections/boiler":"boiler-inspection", "/hvac/inspections/cooling-tower":"cooling-tower-inspection",
  "/hvac/inspections/pump":"pump-health", "/hvac/inspections/ahu":"ahu-inspection",
  "/hvac/inspections/rtu":"rtu-inspection", "/hvac/inspections/vav":"vav-inspection",
  "/hvac/ai/rooftop-photo":"rooftop-photo-analysis", "/hvac/ai/electrical-cabinet":"electrical-cabinet-analysis",
  "/hvac/predictive-maintenance":"hvac-predictive-maintenance", "/hvac/buildings/digital-twin":"building-digital-twin"
};

const cleaning = {
  "/cleaning/property-profile":"cleaning-property-profile", "/cleaning/estimates/service":"cleaning-service-estimate",
  "/cleaning/estimates/square-foot":"cleaning-square-foot-estimate", "/cleaning/estimates/deep-clean":"deep-clean-estimate",
  "/cleaning/estimates/move-in-out":"move-clean-estimate", "/cleaning/estimates/post-construction":"post-construction-estimate",
  "/cleaning/estimates/carpet":"carpet-cleaning-estimate", "/cleaning/estimates/floor-care":"floor-care-estimate",
  "/cleaning/estimates/window":"window-cleaning-estimate", "/cleaning/estimates/pressure-washing":"pressure-washing-estimate",
  "/cleaning/inspections/checklist":"cleaning-inspection", "/cleaning/inspections/photo-quality":"cleaning-photo-quality",
  "/cleaning/quality/score":"cleaning-quality-score", "/cleaning/quality/rework-risk":"cleaning-rework-risk",
  "/cleaning/scheduling/crew-recommendation":"cleaning-crew-recommendation", "/cleaning/scheduling/route-optimize":"cleaning-route-optimize",
  "/cleaning/scheduling/recurring-plan":"cleaning-recurring-plan", "/cleaning/scheduling/emergency":"cleaning-emergency-dispatch",
  "/cleaning/labor/time-estimate":"cleaning-time-estimate", "/cleaning/labor/workload":"cleaning-workload",
  "/cleaning/supplies/requirements":"cleaning-supply-requirements", "/cleaning/supplies/inventory":"cleaning-supply-inventory",
  "/cleaning/supplies/reorder":"cleaning-supply-reorder", "/cleaning/safety/chemical-compatibility":"chemical-compatibility",
  "/cleaning/safety/sds-lookup":"sds-lookup", "/cleaning/contracts/pricing":"cleaning-contract-pricing",
  "/cleaning/contracts/profitability":"cleaning-contract-profitability", "/cleaning/customers/next-service":"cleaning-next-service",
  "/cleaning/customers/churn-risk":"cleaning-churn-risk", "/cleaning/compliance/log":"cleaning-compliance-log"
};


const pestControl = {
  "/pest-control/property-profile":"pest-property-profile", "/pest-control/inspections/risk-assessment":"pest-risk-assessment",
  "/pest-control/inspections/termite":"termite-inspection", "/pest-control/inspections/rodent":"rodent-inspection",
  "/pest-control/estimates/treatment":"pest-treatment-estimate", "/pest-control/estimates/termite-bond":"termite-bond-estimate",
  "/pest-control/treatments/plan":"pest-treatment-plan", "/pest-control/treatments/chemical-calculator":"pest-chemical-calculator",
  "/pest-control/scheduling/recurring":"pest-recurring-schedule", "/pest-control/scheduling/emergency":"pest-emergency-dispatch",
  "/pest-control/compliance/application-log":"pesticide-application-log", "/pest-control/compliance/reentry-window":"pesticide-reentry-window",
  "/pest-control/monitoring/device-status":"pest-device-status", "/pest-control/ai/photo-identification":"pest-photo-identification"
};

const poolService = {
  "/pool/property-profile":"pool-property-profile", "/pool/water/chemistry":"pool-water-chemistry",
  "/pool/water/dosing-calculator":"pool-dosing-calculator", "/pool/water/volume-estimate":"pool-volume-estimate",
  "/pool/inspections/equipment":"pool-equipment-inspection", "/pool/inspections/safety":"pool-safety-inspection",
  "/pool/estimates/recurring-service":"pool-service-estimate", "/pool/estimates/repair":"pool-repair-estimate",
  "/pool/maintenance/plan":"pool-maintenance-plan", "/pool/maintenance/filter-cleaning":"pool-filter-cleaning",
  "/pool/diagnostics/leak-risk":"pool-leak-risk", "/pool/diagnostics/pump-health":"pool-pump-health",
  "/pool/inventory/chemicals":"pool-chemical-inventory", "/pool/scheduling/route-optimize":"pool-route-optimize"
};

const painting = {
  "/painting/property-profile":"paint-property-profile", "/painting/measurements/surface-area":"paint-surface-area",
  "/painting/estimates/interior":"paint-interior-estimate", "/painting/estimates/exterior":"paint-exterior-estimate",
  "/painting/estimates/cabinet":"paint-cabinet-estimate", "/painting/materials/calculator":"paint-material-calculator",
  "/painting/colors/coverage":"paint-coverage", "/painting/inspections/surface":"paint-surface-inspection",
  "/painting/quality/photo-review":"paint-photo-quality", "/painting/scheduling/crew":"paint-crew-plan",
  "/painting/change-orders/estimate":"paint-change-order", "/painting/compliance/lead-risk":"paint-lead-risk"
};

const roofing = {
  "/roofing/property-profile":"roof-property-profile", "/roofing/measurements/roof-area":"roof-area-estimate",
  "/roofing/measurements/pitch":"roof-pitch-estimate", "/roofing/inspections/damage":"roof-damage-inspection",
  "/roofing/inspections/storm":"roof-storm-inspection", "/roofing/estimates/replacement":"roof-replacement-estimate",
  "/roofing/estimates/repair":"roof-repair-estimate", "/roofing/materials/calculator":"roof-material-calculator",
  "/roofing/warranty/lookup":"roof-warranty-lookup", "/roofing/scheduling/weather-window":"roof-weather-window",
  "/roofing/ai/photo-analysis":"roof-photo-analysis", "/roofing/claims/package":"roof-claim-package"
};

const plumbing = {
  "/plumbing/property-profile":"plumbing-property-profile", "/plumbing/diagnostics/leak":"plumbing-leak-diagnostic",
  "/plumbing/diagnostics/drain":"plumbing-drain-diagnostic", "/plumbing/diagnostics/water-heater":"water-heater-diagnostic",
  "/plumbing/estimates/repair":"plumbing-repair-estimate", "/plumbing/estimates/repiping":"plumbing-repipe-estimate",
  "/plumbing/estimates/water-heater":"water-heater-estimate", "/plumbing/dispatch/emergency":"plumbing-emergency-dispatch",
  "/plumbing/parts/requirements":"plumbing-parts-requirements", "/plumbing/inspections/backflow":"backflow-inspection",
  "/plumbing/inspections/sewer-camera":"sewer-camera-analysis", "/plumbing/water/usage-anomaly":"water-usage-anomaly"
};

const electrical = {
  "/electrical/property-profile":"electrical-property-profile", "/electrical/load/calculation":"electrical-load-calculation",
  "/electrical/panel/capacity":"electrical-panel-capacity", "/electrical/diagnostics/circuit":"electrical-circuit-diagnostic",
  "/electrical/inspections/safety":"electrical-safety-inspection", "/electrical/estimates/service-upgrade":"electrical-service-upgrade",
  "/electrical/estimates/ev-charger":"electrical-ev-charger", "/electrical/estimates/generator":"electrical-generator-estimate",
  "/electrical/estimates/lighting":"electrical-lighting-estimate", "/electrical/dispatch/emergency":"electrical-emergency-dispatch",
  "/electrical/materials/requirements":"electrical-materials", "/electrical/ai/panel-photo":"electrical-panel-photo"
};

const generalContracting = {
  "/general-contract/property-profile":"gc-property-profile", "/general-contract/estimates/project":"gc-project-estimate",
  "/general-contract/estimates/remodel":"gc-remodel-estimate", "/general-contract/bids/comparison":"gc-bid-comparison",
  "/general-contract/scope/generator":"gc-scope-generator", "/general-contract/change-orders/estimate":"gc-change-order",
  "/general-contract/scheduling/critical-path":"gc-critical-path", "/general-contract/scheduling/subcontractors":"gc-subcontractor-plan",
  "/general-contract/budget/forecast":"gc-budget-forecast", "/general-contract/progress/photo-review":"gc-progress-photo",
  "/general-contract/inspections/checklist":"gc-inspection-checklist", "/general-contract/closeout/package":"gc-closeout-package"
};

const surveillance = {
  "/surveillance/property-profile":"surveillance-property-profile", "/surveillance/design/camera-layout":"camera-layout-design",
  "/surveillance/design/storage":"surveillance-storage-calculator", "/surveillance/design/bandwidth":"surveillance-bandwidth-calculator",
  "/surveillance/estimates/installation":"surveillance-install-estimate", "/surveillance/inspections/site":"surveillance-site-inspection",
  "/surveillance/devices/health":"surveillance-device-health", "/surveillance/alerts/risk-score":"surveillance-alert-risk",
  "/surveillance/maintenance/plan":"surveillance-maintenance-plan", "/surveillance/privacy/retention-policy":"surveillance-retention-policy",
  "/surveillance/zones/blind-spots":"surveillance-blind-spots", "/surveillance/incidents/export-package":"surveillance-incident-export"
};

const trashRemoval = {
  "/trash-removal/property-profile":"trash-property-profile", "/trash-removal/estimates/haul":"trash-haul-estimate",
  "/trash-removal/estimates/dumpster":"dumpster-estimate", "/trash-removal/volume/estimate":"trash-volume-estimate",
  "/trash-removal/material/classification":"trash-material-classification", "/trash-removal/scheduling/route-optimize":"trash-route-optimize",
  "/trash-removal/scheduling/pickup":"trash-pickup-schedule", "/trash-removal/fleet/capacity":"trash-fleet-capacity",
  "/trash-removal/disposal/site-match":"trash-disposal-site", "/trash-removal/compliance/manifest":"trash-waste-manifest",
  "/trash-removal/ai/photo-volume":"trash-photo-volume", "/trash-removal/contracts/pricing":"trash-contract-pricing"
};

const transportation = {
  "/transportation/property-profile":"transport-property-profile",
  "/transportation/estimates/local-move":"transport-local-move-estimate",
  "/transportation/estimates/long-haul":"transport-long-haul-estimate",
  "/transportation/estimates/delivery":"transport-delivery-estimate",
  "/transportation/load/plan":"transport-load-plan",
  "/transportation/scheduling/route-optimize":"transport-route-optimize",
  "/transportation/scheduling/window":"transport-delivery-window",
  "/transportation/fleet/capacity":"transport-fleet-capacity",
  "/transportation/dispatch/assign":"transport-dispatch-assign",
  "/transportation/compliance/bol":"transport-bol",
  "/transportation/ai/photo-inventory":"transport-photo-inventory",
  "/transportation/contracts/pricing":"transport-contract-pricing"
};

const healthcare = {
  "/healthcare/patient-profile":"healthcare-patient-profile",
  "/healthcare/estimates/nursing-visit":"healthcare-nursing-visit-estimate",
  "/healthcare/estimates/physician-visit":"healthcare-physician-visit-estimate",
  "/healthcare/estimates/shift-staffing":"healthcare-shift-staffing-estimate",
  "/healthcare/care-plan/generate":"healthcare-care-plan",
  "/healthcare/clinical/risk-assessment":"healthcare-risk-assessment",
  "/healthcare/scheduling/visit-optimize":"healthcare-visit-route-optimize",
  "/healthcare/scheduling/shift":"healthcare-shift-schedule",
  "/healthcare/staffing/credentials-check":"healthcare-credentials-check",
  "/healthcare/staffing/skill-match":"healthcare-skill-match",
  "/healthcare/dispatch/emergency":"healthcare-emergency-dispatch",
  "/healthcare/compliance/documentation":"healthcare-documentation-compliance",
  "/healthcare/billing/coding-suggest":"healthcare-coding-suggest",
  "/healthcare/supplies/requirements":"healthcare-supplies-requirements",
  "/healthcare/ai/symptom-triage":"healthcare-symptom-triage",
  "/healthcare/contracts/pricing":"healthcare-contract-pricing"
};

for (const [path,type] of Object.entries({...landscape,...hvac,...cleaning,...pestControl,...poolService,...painting,...roofing,...plumbing,...electrical,...generalContracting,...surveillance,...trashRemoval,...transportation,...healthcare})) router.post(path, execute(type));

// Shared cross-industry APIs
const shared = {
  "/business/cash-forecast":"cash-forecast", "/business/payroll-forecast":"payroll-forecast",
  "/business/overtime-prediction":"overtime", "/business/invoice-automation":"invoice-automation",
  "/sales/hoa-nearby":"find-hoa", "/sales/commercial-nearby":"find-commercial", "/sales/prospects":"prospects",
  "/customers/payment-risk":"payment-risk", "/mapping/service-area":"service-area", "/mapping/service-radius":"service-radius",
  "/fleet/fuel-cost":"fuel-cost", "/fleet/vehicle-maintenance":"vehicle-maintenance", "/marketplace/subcontractors":"subcontractors"
};
for (const [path,type] of Object.entries(shared)) router.post(path, execute(type));

// Deprecated aliases from v2
router.post("/properties/acreage", async (req,res,next)=>{ try { const parsed=acreageSchema.safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"A valid street address is required"}); res.set("Deprecation","true"); res.json(await getParcelAcreageByAddress(parsed.data.address)); } catch(e){next(e);} });
for (const [oldPath,newType] of Object.entries({"/properties/mowable-area":"mowable-area","/estimates/landscaping":"landscaping-estimate","/estimates/materials":"materials","/estimates/labor":"labor","/estimates/equipment":"equipment"})) router.post(oldPath, execute(newType));

export default router;
