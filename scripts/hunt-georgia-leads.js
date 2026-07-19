import "dotenv/config";
import { huntB2bLeads, huntResidentialLeads, listPilotCities } from "../src/services/leadHunt.js";

const pilots = listPilotCities().map(city => city.label);
const segment = String(process.env.LEAD_SEGMENT || "both").toLowerCase();
const options = {
  queryLimit: Number(process.env.LEAD_QUERY_LIMIT || 2),
  perCityLimit: Number(process.env.LEAD_PER_CITY_LIMIT || 4)
};

console.log("Pilot cities:", pilots.join(", "));
console.log("Segment:", segment);

const output = {};
if (segment === "b2b" || segment === "both") {
  output.b2b = await huntB2bLeads(options);
  console.log("B2B totalLeads:", output.b2b.totalLeads);
}
if (segment === "residential" || segment === "both" || segment === "resi") {
  output.residential = await huntResidentialLeads(options);
  console.log("Residential totalLeads:", output.residential.totalLeads);
}

console.log(JSON.stringify(output, null, 2));
