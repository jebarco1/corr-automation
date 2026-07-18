/** Local category catalog — no API call required to render the home page. */
export const categories = [
  {
    category: "landscape",
    label: "Landscape",
    description: "Lawn care, grounds maintenance, mowing, mulch, and outdoor service estimates.",
    apis: ["mowable-area", "labor", "landscaping-estimate"],
    prompts: [
      "Mowing quote for 121 Cascade Way, Coppell, TX 75019",
      "Spring cleanup and mulch at 123 Peachtree St, Atlanta, GA 30303",
      "Commercial grounds maintenance quote for an Atlanta office"
    ],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com", phone: "404-555-0199" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true, example: "123 Main St, Atlanta, GA 30303" },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "serviceType", question: "Which landscape service is needed?", type: "select", options: ["mowing", "cleanup", "mulch", "fertilization", "full maintenance"], required: true },
      { key: "crewSize", question: "How many crew members should be used?", type: "number", required: true },
      { key: "estimatedHours", question: "How many work hours are expected?", type: "number", required: true, api: "labor" },
      { key: "hourlyRate", question: "What hourly labor rate should be applied?", type: "currency", required: true, api: "landscaping-estimate" }
    ]
  },
  {
    category: "hvac",
    label: "HVAC & Mechanical",
    description: "Diagnostics, load estimates, replacements, and maintenance plans.",
    apis: ["hvac-load-estimate", "hvac-fault-detection", "hvac-replacement-estimate"],
    prompts: [
      "The upstairs AC runs but does not cool",
      "Replace a 3-ton rooftop unit on a small office",
      "Annual commercial HVAC maintenance plan"
    ],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "systemType", question: "Which system needs service?", type: "select", options: ["split system", "heat pump", "rooftop unit", "boiler", "chiller", "air handler", "other"], required: true },
      { key: "serviceType", question: "What HVAC service is requested?", type: "select", options: ["diagnostic", "repair", "maintenance", "replacement", "installation"], required: true, api: "hvac-fault-detection" },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "hourlyRate", question: "What hourly labor rate should be applied?", type: "currency", required: true },
      { key: "materialCost", question: "What is the estimated equipment and material cost?", type: "currency", required: true, api: "hvac-replacement-estimate" }
    ]
  },
  {
    category: "cleaning",
    label: "Janitorial & Cleaning",
    description: "Recurring janitorial, deep cleans, move-in/out, and specialty cleaning.",
    apis: ["cleaning-property-profile", "cleaning-service-estimate"],
    prompts: ["Weekly office janitorial for 12,000 sqft", "Move-out deep clean for a 3-bedroom apartment"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "serviceType", question: "Which cleaning service is needed?", type: "select", options: ["recurring janitorial", "deep clean", "move-in/out", "post-construction", "carpet", "floor care", "windows"], required: true },
      { key: "frequency", question: "How often should service occur?", type: "select", options: ["one-time", "daily", "weekly", "biweekly", "monthly"], required: true },
      { key: "crewSize", question: "How many cleaners should be assigned?", type: "number", required: true },
      { key: "estimatedHours", question: "How many hours per visit are expected?", type: "number", required: true },
      { key: "hourlyRate", question: "What hourly rate should be used?", type: "currency", required: true, api: "cleaning-service-estimate" }
    ]
  },
  {
    category: "pest-control",
    label: "Pest Control",
    description: "Inspections, treatments, termite bonds, and recurring pest service.",
    apis: ["pest-property-profile", "pest-risk-assessment", "pest-treatment-estimate"],
    prompts: ["Termite inspection and treatment for a ranch home", "Monthly commercial kitchen pest service"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "pestType", question: "Which pest is involved?", type: "select", options: ["general insects", "termites", "rodents", "bed bugs", "mosquitoes", "wildlife", "other"], required: true, api: "pest-risk-assessment" },
      { key: "serviceType", question: "Which treatment plan is requested?", type: "select", options: ["inspection", "one-time treatment", "recurring service", "termite bond", "exclusion"], required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "materialCost", question: "What is the estimated treatment material cost?", type: "currency", required: true, api: "pest-treatment-estimate" }
    ]
  },
  {
    category: "pool",
    label: "Pool Service",
    description: "Chemistry, equipment checks, openings/closings, and recurring pool care.",
    apis: ["pool-water-chemistry", "pool-service-estimate"],
    prompts: ["Weekly pool service with chemical balancing", "Pool opening and equipment inspection"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "poolGallons", question: "What is the estimated pool volume in gallons?", type: "number", required: true, api: "pool-water-chemistry" },
      { key: "serviceType", question: "Which pool service is needed?", type: "select", options: ["weekly service", "opening", "closing", "equipment repair", "cleaning", "chemical balancing"], required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "materialCost", question: "What chemical and parts cost is expected?", type: "currency", required: true, api: "pool-service-estimate" }
    ]
  },
  {
    category: "painting",
    label: "Painting",
    description: "Interior/exterior painting, cabinets, and materials planning.",
    apis: ["paint-surface-area", "paint-interior-estimate"],
    prompts: ["Interior repaint for a 2,000 sqft home", "Exterior trim and siding refresh"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "serviceType", question: "Which painting service is needed?", type: "select", options: ["interior", "exterior", "cabinets", "touch-up", "commercial coating"], required: true },
      { key: "coats", question: "How many coats are required?", type: "number", required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "materialCost", question: "What is the estimated paint and materials cost?", type: "currency", required: true, api: "paint-interior-estimate" }
    ]
  },
  {
    category: "roofing",
    label: "Roofing",
    description: "Inspections, repairs, replacements, and storm assessments.",
    apis: ["roof-area-estimate", "roof-replacement-estimate"],
    prompts: ["Asphalt shingle replacement after storm damage", "Roof leak repair inspection"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "serviceType", question: "Which roofing service is needed?", type: "select", options: ["inspection", "repair", "replacement", "storm damage", "maintenance"], required: true },
      { key: "roofMaterial", question: "What roofing material is involved?", type: "select", options: ["asphalt shingle", "metal", "tile", "flat membrane", "wood shake", "other"], required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "materialCost", question: "What is the estimated roofing material cost?", type: "currency", required: true, api: "roof-replacement-estimate" }
    ]
  },
  {
    category: "plumbing",
    label: "Plumbing",
    description: "Leak/drain diagnostics, water heaters, and emergency dispatch.",
    apis: ["plumbing-leak-diagnostic", "plumbing-repair-estimate"],
    prompts: ["Emergency water heater replacement", "Kitchen drain clog diagnostic"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "serviceType", question: "Which plumbing service is needed?", type: "select", options: ["leak repair", "drain clearing", "water heater", "fixture installation", "repiping", "sewer", "backflow"], required: true, api: "plumbing-leak-diagnostic" },
      { key: "urgency", question: "How urgent is the request?", type: "select", options: ["routine", "same day", "emergency"], required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "hourlyRate", question: "What hourly labor rate should be applied?", type: "currency", required: true },
      { key: "materialCost", question: "What parts and materials cost is expected?", type: "currency", required: true, api: "plumbing-repair-estimate" }
    ]
  },
  {
    category: "electrical",
    label: "Electrical",
    description: "Panel work, EV chargers, generators, and safety inspections.",
    apis: ["electrical-circuit-diagnostic", "electrical-service-upgrade"],
    prompts: ["Install a Level 2 EV charger", "Panel upgrade from 100A to 200A"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "serviceType", question: "Which electrical service is needed?", type: "select", options: ["diagnostic", "panel upgrade", "EV charger", "generator", "lighting", "rewire", "safety inspection"], required: true, api: "electrical-circuit-diagnostic" },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "hourlyRate", question: "What hourly labor rate should be applied?", type: "currency", required: true },
      { key: "materialCost", question: "What equipment and materials cost is expected?", type: "currency", required: true, api: "electrical-service-upgrade" }
    ]
  },
  {
    category: "general-contract",
    label: "General Contracting",
    description: "Remodels, build-outs, scopes, and project estimates.",
    apis: ["gc-project-estimate"],
    prompts: ["Kitchen remodel for a 200 sqft space", "Office tenant build-out quote"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "projectType", question: "What type of project is planned?", type: "select", options: ["remodel", "addition", "repair", "build-out", "new construction", "restoration"], required: true },
      { key: "estimatedHours", question: "How many total labor hours are expected?", type: "number", required: true },
      { key: "materialCost", question: "What material cost is expected?", type: "currency", required: true },
      { key: "markupMultiplier", question: "What pricing multiplier should be applied?", type: "number", required: true, example: 1.35, api: "gc-project-estimate" }
    ]
  },
  {
    category: "surveillance",
    label: "Surveillance",
    description: "Camera layouts, storage planning, and installation estimates.",
    apis: ["surveillance-install-estimate"],
    prompts: ["8-camera home security install with 30-day retention", "Retail store surveillance upgrade"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "cameraCount", question: "How many cameras are required?", type: "number", required: true },
      { key: "retentionDays", question: "How many days should video be retained?", type: "number", required: true },
      { key: "serviceType", question: "Which surveillance service is requested?", type: "select", options: ["new installation", "upgrade", "repair", "site assessment", "maintenance"], required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "materialCost", question: "What equipment and materials cost is expected?", type: "currency", required: true, api: "surveillance-install-estimate" }
    ]
  },
  {
    category: "trash-removal",
    label: "Trash Removal",
    description: "Junk hauling, dumpsters, disposal matching, and cleanouts.",
    apis: ["trash-haul-estimate"],
    prompts: ["Whole-home junk removal cleanout", "20-yard dumpster for renovation debris"],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "volumeCubicYards", question: "What is the estimated debris volume in cubic yards?", type: "number", required: true },
      { key: "materialType", question: "What material will be removed?", type: "select", options: ["household debris", "construction debris", "yard waste", "appliances", "furniture", "mixed waste"], required: true },
      { key: "serviceType", question: "Which removal service is needed?", type: "select", options: ["single haul", "dumpster rental", "recurring pickup", "property cleanout"], required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true },
      { key: "disposalCost", question: "What disposal or tipping fee is expected?", type: "currency", required: true, api: "trash-haul-estimate" }
    ]
  },
  {
    category: "transportation",
    label: "Transportation",
    description: "Local moves, delivery, load planning, routing, and dispatch.",
    apis: ["transport-property-profile", "transport-load-plan", "transport-local-move-estimate", "transport-delivery-estimate"],
    prompts: [
      "Local 2-bedroom move across town",
      "Same-day delivery for 12 stops",
      "Materials haul for a construction site"
    ],
    questions: [
      { key: "customer", question: "Who is the customer?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the primary service address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "pickupAddress", question: "What is the pickup address?", type: "string", required: true, api: "transport-property-profile" },
      { key: "dropoffAddress", question: "What is the dropoff or destination address?", type: "string", required: true },
      { key: "serviceType", question: "Which transportation service is needed?", type: "select", options: ["local move", "long haul", "same-day delivery", "scheduled delivery", "light freight", "materials haul"], required: true },
      { key: "distanceMiles", question: "What is the estimated trip distance in miles?", type: "number", required: true },
      { key: "volumeCubicFeet", question: "What is the estimated load volume in cubic feet?", type: "number", required: true, api: "transport-load-plan" },
      { key: "crewSize", question: "How many crew members should be used?", type: "number", required: true },
      { key: "estimatedHours", question: "How many labor hours are expected?", type: "number", required: true, api: "transport-local-move-estimate" }
    ]
  },
  {
    category: "healthcare",
    label: "Nursing & Doctors",
    description: "Home health visits, physician calls, care plans, and clinical staffing.",
    apis: ["healthcare-patient-profile", "healthcare-risk-assessment", "healthcare-nursing-visit-estimate", "healthcare-physician-visit-estimate", "healthcare-care-plan"],
    prompts: [
      "Home nursing visit for post-acute follow-up",
      "Physician house call for high-acuity patient",
      "Private duty RN shift coverage"
    ],
    questions: [
      { key: "customer", question: "Who is the patient or responsible party?", type: "object", required: true, example: { name: "Taylor Smith", email: "taylor@example.com" } },
      { key: "serviceAddress", question: "What is the care address?", type: "string", required: true },
      { key: "propertyType", question: "What type of property is this?", type: "select", options: ["residential", "commercial", "hoa", "multi-family", "industrial"], required: true },
      { key: "careSetting", question: "Where will care be delivered?", type: "select", options: ["home", "assisted living", "clinic", "facility", "telehealth hybrid"], required: true, api: "healthcare-patient-profile" },
      { key: "serviceType", question: "Which clinical service is needed?", type: "select", options: ["nursing visit", "physician visit", "private duty shift", "post-acute follow-up", "chronic care management", "urgent home visit"], required: true },
      { key: "acuityLevel", question: "What is the patient acuity level?", type: "select", options: ["low", "moderate", "high", "critical"], required: true, api: "healthcare-risk-assessment" },
      { key: "role", question: "Which clinician role should be assigned?", type: "select", options: ["RN", "LPN", "NP", "physician", "caregiver with RN oversight"], required: true },
      { key: "visitMinutes", question: "How many minutes should the visit or shift block cover?", type: "number", required: true },
      { key: "estimatedHours", question: "How many billable clinical hours are expected?", type: "number", required: true, api: "healthcare-nursing-visit-estimate" }
    ]
  }
];

export function getCategory(category) {
  return categories.find(item => item.category === category) || null;
}
