import "dotenv/config";
import { huntLeadsForAllCategories, listPilotCities } from "../src/services/leadHunt.js";

const pilots = listPilotCities().map(city => city.label);
console.log("Hunting leads for pilot cities:", pilots.join(", "));

const result = await huntLeadsForAllCategories({
  queryLimit: Number(process.env.LEAD_QUERY_LIMIT || 2),
  perCityLimit: Number(process.env.LEAD_PER_CITY_LIMIT || 4)
});

console.log(JSON.stringify(result, null, 2));
