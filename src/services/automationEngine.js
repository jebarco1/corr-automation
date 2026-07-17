import crypto from "crypto";

const round = (value, places = 2) => Number(Number(value).toFixed(places));
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function base(type, input, data, meta = {}) {
  return { requestId: id("req"), type, generatedAt: now(), input, data, meta: { mode: "starter-calculation", ...meta } };
}

export function runAutomation(type, input = {}) {
  const acres = n(input.acres || input.mowableAcres || input.areaAcres, 1);
  const sqft = n(input.squareFeet || input.areaSquareFeet, acres * 43560);
  const hourlyRate = n(input.hourlyRate, 65);
  const crewSize = Math.max(1, n(input.crewSize, 2));
  const laborHours = round(n(input.estimatedHours, Math.max(.75, acres * 1.6)));
  const distance = n(input.distanceMiles, 10);
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const customers = Array.isArray(input.customers) ? input.customers : [];

  const handlers = {
    "property-search": () => base(type,input,{ address: input.address, normalizedAddress: String(input.address||"").toUpperCase(), status:"provider_lookup_required", nextStep:"Configure REGRID_API_TOKEN and use /properties/acreage for live parcel data." }),
    "mowable-area": () => base(type,input,{ lotAcres: round(acres), estimatedMowableAcres: round(acres * .68), excludedAcres: round(acres * .32), classifications:{ turfPercent:68, buildingsPercent:12, pavementPercent:15, waterOrOtherPercent:5 }, confidence:0.72 },{ requiresProvider:"imagery/land-cover model" }),
    "irrigation-zones": () => base(type,input,{ estimatedZones: Math.max(1,Math.ceil(sqft/5000)), irrigatedSquareFeet:Math.round(sqft*.68), estimatedHeads:Math.max(6,Math.ceil(sqft/900)), confidence:0.61 }),
    "tree-count": () => base(type,input,{ estimatedTrees:Math.round(acres*14), estimatedShrubs:Math.round(acres*26), canopyCoveragePercent:round(Math.min(75,18+acres*4)), confidence:0.65 }),
    "fence-length": () => base(type,input,{ estimatedLinearFeet:Math.round(4*Math.sqrt(sqft)), gates:Math.max(1,Math.round(acres)), confidence:0.58 }),
    "driveway-area": () => base(type,input,{ totalSquareFeet:Math.round(sqft*.08), concreteSquareFeet:Math.round(sqft*.06), asphaltSquareFeet:Math.round(sqft*.02), confidence:0.62 }),
    "parking-lot": () => base(type,input,{ areaSquareFeet:Math.round(sqft*.35), estimatedSpaces:Math.max(0,Math.floor(sqft*.35/325)), accessibleSpaces:Math.max(1,Math.ceil((sqft*.35/325)/25)), curbLinearFeet:Math.round(Math.sqrt(sqft*.35)*5) }),
    "landscaping-estimate": () => { const cost=round(laborHours*crewSize*hourlyRate + acres*35); return base(type,input,{ service:"recurring lawn maintenance", crewSize, laborHours, estimatedCost:cost, suggestedPrice:round(cost*1.35), grossMarginPercent:round((cost*1.35-cost)/(cost*1.35)*100), lineItems:[{name:"Mowing, edging and blowing",quantity:acres,unit:"acre",amount:round(cost*.72)},{name:"Travel and setup",quantity:1,unit:"visit",amount:round(cost*.13)},{name:"Overhead",quantity:1,unit:"job",amount:round(cost*.15)}] }); },
    "materials": () => { const depth=n(input.depthInches,3); const yards=round(sqft*(depth/12)/27,1); return base(type,input,{ material:input.material||"mulch",areaSquareFeet:sqft,depthInches:depth,cubicYards:yards,cubicYardsWithWaste:round(yards*1.1,1),estimatedBags:Math.ceil(yards*13.5) }); },
    "labor": () => base(type,input,{ crewSize,laborHours,totalPersonHours:round(crewSize*laborHours),laborCost:round(crewSize*laborHours*hourlyRate),recommendedBufferHours:round(laborHours*.15) }),
    "equipment": () => base(type,input,{ acreage:acres,recommendations: acres<.35?["21-inch push mower","string trimmer","blower"]:acres<2?["36-48 inch stand-on mower","string trimmer","blower"]:["52-72 inch zero-turn mower","stand-on mower","commercial blower"], trailerRequired:acres>=.5 }),
    "route-optimize": () => base(type,input,{ orderedJobs:[...jobs].sort((a,b)=>n(a.priority,5)-n(b.priority,5)).map((j,i)=>({...j,stop:i+1})), estimatedMiles:round(Math.max(5,jobs.length*4.7)), estimatedDriveMinutes:Math.round(Math.max(15,jobs.length*12)), optimizationStatus:jobs.length?"optimized":"no_jobs_supplied" }),
    "rain-delay": () => base(type,input,{ weatherRisk:input.precipitationProbability>=60?"high":"low", action:input.precipitationProbability>=60?"reschedule_outdoor_jobs":"continue_schedule", affectedJobIds:jobs.filter(j=>j.outdoor!==false).map(j=>j.id), customerNotificationRecommended:input.precipitationProbability>=60 }),
    "crew-balance": () => base(type,input,{ recommendation:"redistribute jobs to reduce overtime", crews:(input.crews||[]).map(c=>({...c,projectedHours:n(c.scheduledHours)+n(c.remainingHours),overtimeRisk:n(c.scheduledHours)+n(c.remainingHours)>40})) }),
    "emergency-insert": () => base(type,input,{ insertedJobId:input.job?.id||id("job"), recommendedCrewId:(input.availableCrews||[])[0]?.id||null, insertionStatus:(input.availableCrews||[]).length?"assigned":"manager_attention_required", estimatedArrivalMinutes:35 }),
    "find-hoa": () => base(type,input,{ center:{latitude:input.latitude,longitude:input.longitude}, radiusMiles:n(input.radiusMiles,5), results:[], status:"data_provider_required", suggestedProviders:["state corporation registry","property-management datasets","local GIS"] }),
    "find-commercial": () => base(type,input,{ center:{latitude:input.latitude,longitude:input.longitude}, categories:input.categories||["church","school","office","apartment","retail"], results:[], status:"places_provider_required" }),
    "prospects": () => base(type,input,{ origin:input.address||{latitude:input.latitude,longitude:input.longitude}, radiusMiles:n(input.radiusMiles,1), targetCount:Math.round(n(input.radiusMiles,1)*120), prospects:[], status:"parcel_or_places_provider_required" }),
    "neighbor-marketing": () => base(type,input,{ campaignId:id("campaign"), audienceCount:(input.recipients||[]).length, message:input.message||"We're already servicing your neighborhood.", status:input.sendNow?"queued":"draft" }),
    "next-service": () => base(type,input,{ recommendations:[{service:"fertilization",score:.86,reason:"seasonal timing"},{service:"aeration and overseeding",score:.74,reason:"turf history"},{service:"mulch refresh",score:.61,reason:"time since last service"}] }),
    "churn-score": () => base(type,input,{ customerId:input.customerId,score:round(Math.min(1,(n(input.missedVisits)*.18)+(n(input.complaints)*.22)+(n(input.daysSinceContact)/365)),2),level:n(input.complaints)>=2?"high":"moderate",drivers:["complaint frequency","missed service","communication gap"] }),
    "payment-risk": () => base(type,input,{ customerId:input.customerId,score:round(Math.min(1,n(input.averageDaysLate,0)/45+n(input.failedPayments,0)*.18),2),level:n(input.averageDaysLate)>20?"high":"low",recommendedTerms:n(input.averageDaysLate)>20?"deposit_or_autopay":"standard" }),
    "photo-quality": () => base(type,input,{ jobId:input.jobId,photoCount:(input.photoUrls||[]).length,qualityScore:82,checks:{mowing:"pass",edging:"pass",debrisRemoval:"review"},status:"ai_provider_required_for_real_analysis" }),
    "estimate-from-photos": () => base(type,input,{ photoCount:(input.photoUrls||[]).length,detectedScope:["mowing","edging","cleanup"],estimatedPrice:round(125+acres*95),confidence:.55,status:"ai_vision_provider_required" }),
    "damage-detection": () => base(type,input,{ detections:[],status:"no_damage_detected_in_starter_mode",requiresProvider:"computer vision model" }),
    "weed-detection": () => base(type,input,{ weedCoveragePercent:7,possibleTypes:["crabgrass","broadleaf weeds"],treatmentRecommended:true,confidence:.51 }),
    "turf-health": () => base(type,input,{ score:78,level:"good",factors:{greenness:82,density:74,moisture:70,diseaseRisk:18},recommendations:["monitor irrigation","spot treat weeds"] }),
    "cash-forecast": () => { const opening=n(input.openingCash,10000), receivables=n(input.expectedReceivables,15000), expenses=n(input.expectedExpenses,12000); return base(type,input,{days30:round(opening+receivables-expenses),days60:round(opening+receivables*1.8-expenses*1.9),days90:round(opening+receivables*2.7-expenses*2.8),risk:opening+receivables-expenses<0?"high":"low"}); },
    "payroll-forecast": () => base(type,input,{payPeriod:input.payPeriod,totalRegularPay:round(n(input.regularHours)*n(input.averageHourlyRate,20)),totalOvertimePay:round(n(input.overtimeHours)*n(input.averageHourlyRate,20)*1.5),estimatedTaxes:round((n(input.regularHours)*n(input.averageHourlyRate,20)+n(input.overtimeHours)*n(input.averageHourlyRate,20)*1.5)*.11)}),
    "overtime": () => base(type,input,{employees:(input.employees||[]).map(e=>({...e,projectedWeeklyHours:n(e.hoursWorked)+n(e.scheduledHours),overtimeHours:Math.max(0,n(e.hoursWorked)+n(e.scheduledHours)-40)})),managerAttention:(input.employees||[]).some(e=>n(e.hoursWorked)+n(e.scheduledHours)>40)}),
    "invoice-automation": () => base(type,input,{invoiceId:input.invoiceId,daysOverdue:n(input.daysOverdue),recommendedAction:n(input.daysOverdue)>=21?"third_reminder_and_escalate":n(input.daysOverdue)>=14?"second_reminder":n(input.daysOverdue)>=1?"first_reminder":"none",sendNow:Boolean(input.sendNow),status:input.sendNow?"queued":"recommended"}),
    "hoa-work-requests": () => base(type,input,{hoaId:input.hoaId,requests:input.requests||[],status:"integration_contract_ready"}),
    "community-map": () => base(type,input,{hoaId:input.hoaId,layers:input.layers||["roads","amenities","ponds","entrances","clubhouse","pool"],geojson:{type:"FeatureCollection",features:[]},status:"gis_provider_required"}),
    "asset-inventory": () => base(type,input,{hoaId:input.hoaId,assets:input.assets||[],summary:{total:(input.assets||[]).length,byType:{}}}),
    "service-area": () => base(type,input,{areaAcres:round(acres),areaSquareFeet:Math.round(sqft),perimeterFeet:Math.round(4*Math.sqrt(sqft)),estimatedLaborHours:round(acres*1.6)}),
    "service-radius": () => base(type,input,{origin:input.origin,radiusMiles:n(input.radiusMiles,10),matchingCustomers:customers.filter(c=>n(c.distanceMiles)<=n(input.radiusMiles,10)),count:customers.filter(c=>n(c.distanceMiles)<=n(input.radiusMiles,10)).length}),
    "crew-heatmap": () => base(type,input,{points:input.points||[],summary:{pointCount:(input.points||[]).length,totalMinutes:(input.points||[]).reduce((s,p)=>s+n(p.minutes),0)},status:"ready_for_map_visualization"}),
    "fuel-cost": () => base(type,input,{distanceMiles:distance,mpg:n(input.mpg,12),fuelPrice:n(input.fuelPrice,3.5),gallons:round(distance/n(input.mpg,12)),estimatedFuelCost:round(distance/n(input.mpg,12)*n(input.fuelPrice,3.5))}),
    "vehicle-maintenance": () => base(type,input,{vehicleId:input.vehicleId,odometer:n(input.odometer),nextServiceMiles:Math.max(0,n(input.lastServiceOdometer)+n(input.serviceIntervalMiles,5000)-n(input.odometer)),status:n(input.odometer)>=n(input.lastServiceOdometer)+n(input.serviceIntervalMiles,5000)?"due":"ok"}),
    "idle-time": () => base(type,input,{vehicleId:input.vehicleId,idleMinutes:n(input.idleMinutes),estimatedFuelWastedGallons:round(n(input.idleMinutes)/60*.8),estimatedCost:round(n(input.idleMinutes)/60*.8*n(input.fuelPrice,3.5))}),
    "equipment-usage": () => base(type,input,{equipmentId:input.equipmentId,totalHours:n(input.totalHours),utilizationPercent:round(n(input.usedHours)/Math.max(1,n(input.availableHours,40))*100),maintenanceDue:n(input.totalHours)>=n(input.nextMaintenanceAtHours,500)}),
    "trailer-inventory": () => base(type,input,{trailerId:input.trailerId,expectedItems:input.expectedItems||[],scannedItems:input.scannedItems||[],missingItems:(input.expectedItems||[]).filter(i=>!(input.scannedItems||[]).includes(i))}),
    "subcontractors": () => base(type,input,{service:input.service,latitude:input.latitude,longitude:input.longitude,radiusMiles:n(input.radiusMiles,25),results:[],status:"marketplace_database_required"}),
    "equipment-rental": () => base(type,input,{equipmentType:input.equipmentType,location:input.location,startDate:input.startDate,endDate:input.endDate,results:[],status:"rental_partner_integration_required"}),
    "property-intelligence": () => base(type,input,{address:input.address,parcel:{acres:round(acres),mowableAcres:round(acres*.68),buildingSquareFeet:Math.round(sqft*.12),drivewaySquareFeet:Math.round(sqft*.08),fenceLinearFeet:Math.round(4*Math.sqrt(sqft)),estimatedTrees:Math.round(acres*14),estimatedShrubs:Math.round(acres*26),estimatedSprinklerZones:Math.ceil(sqft*.68/5000)},pricing:{weeklyMowing:round(65+acres*90),fertilization:round(45+acres*55),mulch:round(350+acres*240),leafCleanup:round(150+acres*140)},risk:{terrain:"moderate",slope:"unknown",traffic:"medium"},status:"starter_estimate; connect parcel and imagery providers for production"})
  };
  const handler=handlers[type];
  if(handler) return handler();

  if(type.startsWith("hvac-") || ["mechanical-room-scan","equipment-health-score","equipment-remaining-life","equipment-replacement-cost","thermostat-analysis","refrigerant-leak","compressor-health","airflow-analysis","technician-skill-match","truck-inventory","parts-nearby","parts-cross-reference","warranty-lookup","equipment-map","preventive-calendar","energy-consumption","chiller-inspection","boiler-inspection","cooling-tower-inspection","pump-health","ahu-inspection","rtu-inspection","vav-inspection","rooftop-photo-analysis","electrical-cabinet-analysis","building-digital-twin"].includes(type)) {
    const buildingSqft=n(input.buildingSquareFeet||input.squareFeet,2500);
    const tons=round(n(input.tons,Math.max(1,buildingSqft/600)),1);
    const age=n(input.equipmentAgeYears,8);
    const equipmentType=input.equipmentType||"split-system heat pump";
    const diagnosticTypes=["hvac-fault-detection","thermostat-analysis","refrigerant-leak","compressor-health","airflow-analysis"];
    const inspection=type.includes("inspection")||type.includes("health")||type.includes("analysis")||diagnosticTypes.includes(type);
    const data={
      module:"hvac-mechanical", status:"starter-calculation", equipmentType, buildingSquareFeet:buildingSqft,
      estimatedCapacityTons:tons, estimatedBtu:Math.round(tons*12000), confidence:0.68,
      recommendedActions: inspection?["verify readings on site","review maintenance history","create technician work order"]:["confirm equipment specifications","validate local permit and code requirements"]
    };
    if(type==="hvac-property-profile") Object.assign(data,{estimatedUnits:Math.max(1,Math.ceil(tons/5)),stories:n(input.stories,1),buildingUse:input.buildingUse||"residential"});
    if(type==="hvac-load-estimate") Object.assign(data,{heatingLoadBtu:Math.round(buildingSqft*28),coolingLoadBtu:Math.round(buildingSqft*22),supplyVents:Math.ceil(buildingSqft/180),returnVents:Math.max(1,Math.ceil(buildingSqft/900))});
    if(type==="hvac-replacement-estimate"||type==="equipment-replacement-cost") { const cost=round(tons*2200+2500); Object.assign(data,{equipmentCost:round(cost*.55),laborCost:round(cost*.25),permitAndMaterials:round(cost*.1),overhead:round(cost*.1),suggestedCustomerPrice:round(cost*1.35)}); }
    if(type==="equipment-health-score") Object.assign(data,{healthScore:Math.max(20,Math.round(96-age*4)),risk:age>12?"high":age>7?"moderate":"low"});
    if(type==="equipment-remaining-life") Object.assign(data,{estimatedRemainingYears:Math.max(0,18-age),replacementPlanningYear:new Date().getFullYear()+Math.max(0,18-age)});
    if(type==="hvac-predictive-maintenance") Object.assign(data,{predictedFailure:"condenser fan motor",probability:0.71,estimatedDays:60});
    if(type==="hvac-maintenance-plan") Object.assign(data,{plans:[{name:"Bronze",visits:2,annualPrice:299},{name:"Silver",visits:2,annualPrice:499},{name:"Gold",visits:4,annualPrice:799}]});
    if(type==="hvac-air-quality") Object.assign(data,{recommendations:["MERV 11-13 filter","duct inspection","humidity evaluation"],iaqRisk:input.pets||input.allergies?"moderate":"low"});
    if(type==="parts-cross-reference") Object.assign(data,{originalPartNumber:input.partNumber,replacements:[{partNumber:`ALT-${input.partNumber||"UNKNOWN"}`,compatibility:"verify manufacturer specifications"}]});
    if(type==="warranty-lookup") Object.assign(data,{serialNumber:input.serialNumber,warrantyStatus:"provider_lookup_required"});
    if(type==="building-digital-twin") Object.assign(data,{buildingId:input.buildingId,equipment:input.equipment||[],workOrders:input.workOrders||[],sensorReadings:input.sensorReadings||[]});
    return base(type,input,data,{requiresProvider:type.includes("photo")?"computer vision":type.includes("parts")||type.includes("warranty")?"manufacturer/distributor integration":undefined});
  }

  if(type.startsWith("cleaning-" ) || ["deep-clean-estimate","move-clean-estimate","post-construction-estimate","carpet-cleaning-estimate","floor-care-estimate","window-cleaning-estimate","pressure-washing-estimate","chemical-compatibility","sds-lookup"].includes(type)) {
    const area=n(input.squareFeet||input.areaSquareFeet,5000);
    const bathrooms=n(input.bathrooms,2), rooms=n(input.rooms,8);
    const frequency=input.frequency||"weekly";
    const productionRate=n(input.productionRateSqftPerHour,2200);
    const hours=round(Math.max(1,area/productionRate + bathrooms*.2 + rooms*.05),2);
    const crew=Math.max(1,n(input.crewSize,Math.ceil(hours/4)));
    const laborCost=round(hours*n(input.hourlyLaborCost,24));
    const supplyCost=round(area*.012);
    const basePrice=round((laborCost+supplyCost)*1.45);
    const data={module:"janitorial-cleaning",status:"starter-calculation",squareFeet:area,estimatedLaborHours:hours,recommendedCrewSize:crew,confidence:0.74};
    if(type.includes("estimate")||type==="cleaning-contract-pricing") Object.assign(data,{laborCost,supplyCost,estimatedCost:round(laborCost+supplyCost),suggestedPrice:basePrice,frequency});
    if(type==="cleaning-property-profile") Object.assign(data,{rooms,bathrooms,floorTypes:input.floorTypes||["carpet","hard floor"],occupancyType:input.occupancyType||"office"});
    if(type==="cleaning-inspection") Object.assign(data,{checklist:input.checklist||["restrooms","floors","trash","touchpoints","entry glass"],score:88,failedItems:[]});
    if(type==="cleaning-photo-quality"||type==="cleaning-quality-score") Object.assign(data,{qualityScore:84,findings:["minor streaking on glass"],reworkRecommended:false});
    if(type==="cleaning-rework-risk") Object.assign(data,{risk:hours<area/3000?"high":"low",riskScore:hours<area/3000?.72:.24});
    if(type==="cleaning-crew-recommendation"||type==="cleaning-time-estimate"||type==="cleaning-workload") Object.assign(data,{personHours:round(hours*crew),shiftHours:round(hours/crew),recommendedStartTime:input.requiredCompletionTime?"calculate_from_completion_time":"18:00"});
    if(type==="cleaning-recurring-plan") Object.assign(data,{schedule:frequency,visitsPerMonth:frequency==="daily"?22:frequency==="weekly"?4:frequency==="biweekly"?2:1});
    if(type==="cleaning-supply-requirements") Object.assign(data,{supplies:[{item:"neutral cleaner",quantityGallons:round(area/20000,2)},{item:"trash liners",quantity:Math.ceil(n(input.trashCans,20)*1.1)},{item:"disinfectant",quantityGallons:round(area/15000,2)}]});
    if(type==="cleaning-supply-inventory"||type==="cleaning-supply-reorder") { const items=input.items||[]; Object.assign(data,{items,reorderItems:items.filter(x=>n(x.onHand)<=n(x.reorderPoint))}); }
    if(type==="chemical-compatibility") Object.assign(data,{compatible:false,warning:"Do not mix chemicals unless the manufacturer explicitly permits it.",requiresSdsReview:true});
    if(type==="sds-lookup") Object.assign(data,{product:input.productName||input.upc,status:"manufacturer_sds_provider_required"});
    if(type==="cleaning-contract-profitability") Object.assign(data,{monthlyRevenue:n(input.monthlyRevenue,basePrice*4),monthlyCost:n(input.monthlyCost,(laborCost+supplyCost)*4),grossProfit:round(n(input.monthlyRevenue,basePrice*4)-n(input.monthlyCost,(laborCost+supplyCost)*4))});
    if(type==="cleaning-compliance-log") Object.assign(data,{logId:id("cleanlog"),siteId:input.siteId,entries:input.entries||[],recordedAt:now()});
    if(type==="cleaning-next-service") Object.assign(data,{recommendations:["floor detail","high dusting","carpet extraction"],nextRecommendedDate:input.lastServiceDate||now().slice(0,10)});
    if(type==="cleaning-churn-risk") Object.assign(data,{risk:n(input.complaints)>1?"high":"low",drivers:["inspection score","complaints","missed visits"]});
    return base(type,input,data,{requiresProvider:type.includes("photo")?"computer vision":type==="sds-lookup"?"SDS database":undefined});
  }


  const tradePrefixes = ["pest-","termite-","pesticide-","pool-","paint-","roof-","plumbing-","water-heater-","backflow-","sewer-","electrical-","gc-","camera-","surveillance-","trash-","dumpster-","transport-","healthcare-"];
  if (tradePrefixes.some(prefix => type.startsWith(prefix))) {
    const trade = type.startsWith("pest-")||type.startsWith("termite-")||type.startsWith("pesticide-") ? "pest-control" :
      type.startsWith("pool-") ? "pool-service" : type.startsWith("paint-") ? "painting" : type.startsWith("roof-") ? "roofing" :
      type.startsWith("plumbing-")||type.startsWith("water-heater-")||type.startsWith("backflow-")||type.startsWith("sewer-") ? "plumbing" :
      type.startsWith("electrical-") ? "electrical" : type.startsWith("gc-") ? "general-contracting" :
      type.startsWith("camera-")||type.startsWith("surveillance-") ? "surveillance" :
      type.startsWith("trash-")||type.startsWith("dumpster-") ? "trash-removal" :
      type.startsWith("transport-") ? "transportation" :
      type.startsWith("healthcare-") ? "healthcare" : "multi-trade";
    const area = n(input.squareFeet || input.areaSquareFeet, 2500);
    const miles = n(input.distanceMiles || input.miles, type.includes("long-haul") ? 250 : type.includes("delivery") ? 12 : 25);
    const volumeCuFt = n(input.volumeCubicFeet || input.cubicFeet, n(input.volumeCubicYards, 0) * 27 || Math.max(80, area * 0.04));
    const weightLbs = n(input.weightLbs || input.weightPounds, Math.max(200, volumeCuFt * 7));
    const acuity = String(input.acuityLevel || input.acuity || "moderate").toLowerCase();
    const acuityFactor = acuity.includes("critical") || acuity.includes("high") ? 1.45 : acuity.includes("low") ? 0.85 : 1;
    const roleRate = type.includes("physician") ? 225 : type.includes("nursing") || type.includes("shift") ? 95 : type.startsWith("healthcare-") ? 110 : type.startsWith("transport-") ? 75 : 85;
    const hours = round(n(input.estimatedHours, type.startsWith("transport-") ? Math.max(1.5, miles / 22 + volumeCuFt / 180) : type.startsWith("healthcare-") ? Math.max(0.75, n(input.visitMinutes, 60) / 60 * acuityFactor) : Math.max(1, area / 1250)));
    const labor = round(hours * n(input.hourlyRate, roleRate) * Math.max(1,n(input.crewSize, type.startsWith("transport-") ? 2 : 1)));
    const materials = round(n(input.materialCost, type.startsWith("transport-") ? n(input.packingMaterialsCost, volumeCuFt * 0.35) : type.startsWith("healthcare-") ? n(input.supplyCost, hours * 12) : area * 0.18));
    const fuelCost = round(n(input.fuelCost, miles * n(input.fuelCostPerMile, 0.85)));
    const tolls = round(n(input.tolls, miles > 40 ? miles * 0.08 : 0));
    const price = round((labor + materials + n(input.equipmentCost,0) + n(input.disposalCost,0) + (type.startsWith("transport-") ? fuelCost + tolls : 0)) * n(input.markupMultiplier, type.startsWith("healthcare-") ? 1.25 : 1.35));
    const data = { module: trade, status: "starter-calculation", estimatedLaborHours: hours, estimatedCost: round(labor+materials+(type.startsWith("transport-")?fuelCost+tolls:0)), suggestedPrice: price, confidence: 0.7 };

    if (type.includes("property-profile") || type==="healthcare-patient-profile") Object.assign(data,{address:input.address,pickupAddress:input.pickupAddress||input.address,dropoffAddress:input.dropoffAddress||input.destinationAddress||null,propertyType:input.propertyType||"residential",squareFeet:area,units:n(input.units,1),accessNotes:input.accessNotes||null});
    if (type.includes("estimate") || type.includes("pricing") || type.includes("calculator") || type==="healthcare-coding-suggest") Object.assign(data,{laborCost:labor,materialCost:materials,equipmentCost:n(input.equipmentCost,0),disposalCost:n(input.disposalCost,0),markupPercent:round((n(input.markupMultiplier, type.startsWith("healthcare-") ? 1.25 : 1.35)-1)*100)});
    if (type.includes("inspection") || type.includes("risk") || type.includes("diagnostic") || (type.includes("health") && !type.startsWith("healthcare-")) || type.includes("photo") || type==="healthcare-symptom-triage") Object.assign(data,{riskLevel:"moderate",score:82,findings:input.findings||[],recommendedActions:["perform licensed on-site verification","document measurements and photos","create work order for confirmed deficiencies"]});
    if (type.includes("schedule") || type.includes("dispatch") || type.includes("route") || type.includes("critical-path") || type.includes("weather-window") || type.includes("delivery-window")) Object.assign(data,{recommendedDate:input.requestedDate||now().slice(0,10),assignedCrew:input.crewId||null,routeStatus:"optimization_provider_optional",priority:input.priority||"normal"});
    if (type.includes("materials") || type.includes("parts") || type.includes("chemical") || type.includes("inventory") || type.includes("supplies")) Object.assign(data,{items:input.items||[],requirementsStatus:"verify manufacturer instructions and local requirements"});
    if (type==="pool-water-chemistry") Object.assign(data,{ph:n(input.ph,7.4),freeChlorinePpm:n(input.freeChlorinePpm,2),alkalinityPpm:n(input.alkalinityPpm,90),assessment:"verify against pool type and local health requirements"});
    if (type==="pool-dosing-calculator") Object.assign(data,{poolGallons:n(input.poolGallons,15000),target:input.target||{},warning:"Dosing depends on product strength. Follow the product label and test water before and after treatment."});
    if (type==="pool-volume-estimate") Object.assign(data,{estimatedGallons:Math.round(n(input.lengthFeet,30)*n(input.widthFeet,15)*n(input.averageDepthFeet,5)*7.48)});
    if (type==="paint-material-calculator" || type==="paint-coverage") Object.assign(data,{gallons:Math.ceil(area/Math.max(1,n(input.coverageSqftPerGallon,350))*n(input.coats,2)),coats:n(input.coats,2)});
    if (type==="roof-area-estimate") Object.assign(data,{footprintSquareFeet:area,pitchFactor:n(input.pitchFactor,1.12),roofSquareFeet:Math.round(area*n(input.pitchFactor,1.12)),roofingSquares:round(area*n(input.pitchFactor,1.12)/100,1)});
    if (type==="roof-material-calculator") Object.assign(data,{roofingSquares:round(area/100,1),wastePercent:n(input.wastePercent,12),bundles:Math.ceil(area/100*3*(1+n(input.wastePercent,12)/100))});
    if (type==="electrical-load-calculation") Object.assign(data,{connectedLoadWatts:n(input.connectedLoadWatts,12000),demandLoadWatts:round(n(input.connectedLoadWatts,12000)*n(input.demandFactor,.75)),estimatedAmps:round(n(input.connectedLoadWatts,12000)*n(input.demandFactor,.75)/n(input.voltage,240))});
    if (type==="surveillance-storage-calculator") Object.assign(data,{storageTerabytes:round(n(input.cameraCount,8)*n(input.bitrateMbps,4)*86400*n(input.retentionDays,30)/(8*1000*1000),2)});
    if (type==="surveillance-bandwidth-calculator") Object.assign(data,{totalMbps:round(n(input.cameraCount,8)*n(input.bitrateMbps,4),2)});
    if (type==="trash-volume-estimate" || type==="trash-photo-volume") Object.assign(data,{estimatedCubicYards:round(n(input.lengthFeet,8)*n(input.widthFeet,4)*n(input.heightFeet,4)/27,2)});
    if (type==="trash-fleet-capacity") Object.assign(data,{requiredTrips:Math.ceil(n(input.volumeCubicYards,20)/Math.max(1,n(input.truckCapacityCubicYards,15)))});
    if (type.startsWith("transport-") && (type.includes("estimate") || type.includes("pricing"))) Object.assign(data,{distanceMiles:miles,volumeCubicFeet:round(volumeCuFt,1),weightLbs:round(weightLbs,0),fuelCost,tolls,laborCost:labor,materialCost:materials});
    if (type==="transport-load-plan") Object.assign(data,{volumeCubicFeet:round(volumeCuFt,1),weightLbs:round(weightLbs,0),vehicleCapacityCubicFeet:n(input.vehicleCapacityCubicFeet,1200),vehicleCapacityLbs:n(input.vehicleCapacityLbs,5000),utilizationPercent:round(Math.min(100,Math.max(volumeCuFt/Math.max(1,n(input.vehicleCapacityCubicFeet,1200)),weightLbs/Math.max(1,n(input.vehicleCapacityLbs,5000)))*100),1),fitsInVehicle:volumeCuFt<=n(input.vehicleCapacityCubicFeet,1200)&&weightLbs<=n(input.vehicleCapacityLbs,5000),recommendedVehicle:volumeCuFt>900||weightLbs>3500?"box-truck":volumeCuFt>350||weightLbs>1500?"cargo-van":"pickup"});
    if (type==="transport-fleet-capacity") Object.assign(data,{jobs:n(input.jobCount,n(input.stops,4)),availableVehicles:n(input.availableVehicles,2),requiredVehicles:Math.ceil(Math.max(volumeCuFt/Math.max(1,n(input.vehicleCapacityCubicFeet,1200)),n(input.jobCount,n(input.stops,4))/Math.max(1,n(input.stopsPerVehicle,6)))),capacityStatus:n(input.availableVehicles,2)>=Math.ceil(n(input.jobCount,4)/6)?"adequate":"shortage"});
    if (type==="transport-delivery-window") Object.assign(data,{windowStart:input.windowStart||"09:00",windowEnd:input.windowEnd||"12:00",estimatedTravelMinutes:Math.round(miles/n(input.averageSpeedMph,28)*60),etaBandMinutes:n(input.etaBandMinutes,45),priority:input.priority||"normal"});
    if (type==="transport-dispatch-assign") Object.assign(data,{assignedVehicleId:input.vehicleId||input.assignedVehicleId||"vehicle_pending",assignedCrewId:input.crewId||"crew_pending",stops:input.stops||[{address:input.pickupAddress||input.address},{address:input.dropoffAddress||input.destinationAddress}],dispatchStatus:"tentative"});
    if (type==="transport-bol") Object.assign(data,{bolId:id("bol"),shipper:input.shipper||input.customer||null,consignee:input.consignee||null,pieceCount:n(input.pieceCount,n((input.items||[]).length,1)),declaredValue:n(input.declaredValue,price),complianceStatus:"review_required"});
    if (type==="transport-photo-inventory") Object.assign(data,{estimatedItemCount:n(input.estimatedItemCount,Math.max(4,Math.round(volumeCuFt/25))),estimatedVolumeCubicFeet:round(volumeCuFt,1),items:input.items||[],confidence:0.62});
    if (type==="healthcare-patient-profile") Object.assign(data,{patientId:input.patientId||null,patientName:input.patientName||input.customer?.name||null,dateOfBirth:input.dateOfBirth||null,careSetting:input.careSetting||"home",acuityLevel:acuity,diagnoses:input.diagnoses||[],allergies:input.allergies||[],address:input.address||input.serviceAddress||null,emergencyContact:input.emergencyContact||null,payerType:input.payerType||"private"});
    if (type==="healthcare-nursing-visit-estimate" || type==="healthcare-physician-visit-estimate") Object.assign(data,{role:type.includes("physician")?"physician":"nurse",licenseRequired:type.includes("physician")?"MD/DO/NP as applicable":"RN/LPN as applicable",visitMinutes:Math.round(hours*60),acuityLevel:acuity,travelMiles:miles,travelAllowance:round(miles*n(input.travelRatePerMile,1.25)),clinicalReviewRequired:true});
    if (type==="healthcare-shift-staffing-estimate") Object.assign(data,{shiftHours:hours,staffCount:Math.max(1,n(input.staffCount,n(input.crewSize,1))),role:input.role||"RN",facilityType:input.facilityType||input.careSetting||"home",coverageStart:input.coverageStart||input.windowStart||"07:00",coverageEnd:input.coverageEnd||input.windowEnd||"19:00"});
    if (type==="healthcare-care-plan") Object.assign(data,{carePlanId:id("careplan"),goals:input.goals||["stabilize symptoms","support medication adherence","reduce readmission risk"],interventions:input.interventions||["assess vitals","medication review","patient education"],visitFrequencyPerWeek:n(input.visitFrequencyPerWeek,3),durationWeeks:n(input.durationWeeks,4),clinicalReviewRequired:true});
    if (type==="healthcare-risk-assessment") Object.assign(data,{acuityLevel:acuity,fallRisk:input.fallRisk||"moderate",readmissionRisk:input.readmissionRisk||"moderate",medicationComplexity:n(input.medicationCount,5)>6?"high":"moderate",recommendedSupervision:acuity.includes("high")||acuity.includes("critical")?"RN oversight":"standard clinical oversight",clinicalReviewRequired:true});
    if (type==="healthcare-credentials-check") Object.assign(data,{clinicianId:input.clinicianId||input.providerId||null,role:input.role||"RN",credentials:(input.credentials||["license","BLS","malpractice"]).map(name=>({name,status:input.forceFail? "review_required":"assumed_valid_starter",expiresOn:input.credentialExpiresOn||null})),overallStatus:"review_required",warning:"Verify licenses, NPI, exclusions, and payer enrollment in authoritative registries before assignment."});
    if (type==="healthcare-skill-match") Object.assign(data,{requiredSkills:input.requiredSkills||["medication administration","vitals","patient education"],matchedClinicianId:input.clinicianId||"clinician_pending",matchScore:round(Math.min(98,72+n(input.yearsExperience,3)*3),0),gaps:input.skillGaps||[],recommendation:input.skillGaps?.length?"assign with precepting":"assign"});
    if (type==="healthcare-coding-suggest") Object.assign(data,{suggestedCodes:input.suggestedCodes||[{system:"CPT",code:type.includes("physician")||input.role==="physician"?"99347":"99500",description:"Home visit starter code suggestion"},{system:"ICD-10",code:input.primaryDiagnosisCode||"Z51.89",description:"Encounter for other specified aftercare"}],billingCaution:"Coding suggestions are starter placeholders and require certified coding / clinician review.",payerType:input.payerType||"private"});
    if (type==="healthcare-supplies-requirements") Object.assign(data,{items:input.items||[{name:"gloves",quantity:10},{name:"blood pressure cuff",quantity:1},{name:"wound care kit",quantity:n(input.woundCareKits,0)}],supplyCost:materials,sterileRequired:Boolean(input.sterileRequired)});
    if (type==="healthcare-symptom-triage") Object.assign(data,{triageLevel:acuity.includes("critical")?"emergency":acuity.includes("high")?"urgent":"routine",nextStep:acuity.includes("critical")?"seek emergency care now":"schedule clinician evaluation",symptoms:input.symptoms||[],disclaimer:"Not a diagnosis. For informational routing only. Escalate per clinical protocol.",clinicalReviewRequired:true});
    if (type.includes("compliance") || type.includes("manifest") || type.includes("retention-policy") || type.includes("lead-risk") || type==="transport-bol" || type.startsWith("healthcare-")) Object.assign(data,{complianceStatus:"review_required",warning:type.startsWith("healthcare-")?"Clinical, credentialing, HIPAA/privacy, payer, and licensing requirements must be verified by qualified professionals before care delivery or billing.":"Confirm licensing, product labels, permits, privacy rules, disposal rules, carrier authority, and local code before execution."});
    return base(type,input,data,{requiresProvider:type.includes("photo")||type==="healthcare-symptom-triage"?"computer vision / clinical decision support":type.includes("route")?"mapping/routing":type==="healthcare-credentials-check"?"credentialing registry":undefined});
  }

  const error=new Error(`Unsupported automation type: ${type}`); error.statusCode=404; throw error;
}
