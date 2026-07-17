export const supportedCategories = [
  "landscape", "hvac", "cleaning", "pest-control", "pool", "painting",
  "roofing", "plumbing", "electrical", "general-contract", "surveillance", "trash-removal"
];

export const categoryApiTools = {
  landscape: ["mowable-area", "labor", "landscaping-estimate"],
  hvac: ["hvac-load-estimate", "hvac-fault-detection", "hvac-replacement-estimate"],
  cleaning: ["cleaning-property-profile", "cleaning-service-estimate"],
  "pest-control": ["pest-property-profile", "pest-risk-assessment", "pest-treatment-estimate"],
  pool: ["pool-water-chemistry", "pool-service-estimate"],
  painting: ["paint-surface-area", "paint-interior-estimate"],
  roofing: ["roof-area-estimate", "roof-replacement-estimate"],
  plumbing: ["plumbing-leak-diagnostic", "plumbing-repair-estimate"],
  electrical: ["electrical-circuit-diagnostic", "electrical-service-upgrade"],
  "general-contract": ["gc-project-estimate"],
  surveillance: ["surveillance-install-estimate"],
  "trash-removal": ["trash-haul-estimate"]
};
