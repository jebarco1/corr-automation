import axios from "axios";
import area from "@turf/area";

const SQ_METERS_PER_ACRE = 4046.8564224;
const SQ_FEET_PER_ACRE = 43560;
const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_MILES = 3958.7613;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function firstDefined(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], object);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function calculateGeometryArea(feature) {
  if (!feature?.geometry) return null;
  try {
    const squareMeters = area(feature);
    return {
      squareMeters,
      squareFeet: squareMeters * 10.7639104167,
      acres: squareMeters / SQ_METERS_PER_ACRE
    };
  } catch {
    return null;
  }
}

function calculateReportedArea(properties) {
  const acres = normalizeNumber(firstDefined(properties, [
    "acres", "acreage", "ll_gisacre", "gisacre", "gis_acres"
  ]));

  if (acres !== null && acres > 0) {
    return { acres, squareFeet: acres * SQ_FEET_PER_ACRE, source: "provider_reported_acres" };
  }

  const squareFeet = normalizeNumber(firstDefined(properties, [
    "ll_gissqft", "gis_sqft", "lot_sqft", "lotsqft", "land_sqft"
  ]));

  if (squareFeet !== null && squareFeet > 0) {
    return { acres: squareFeet / SQ_FEET_PER_ACRE, squareFeet, source: "provider_reported_square_feet" };
  }

  return null;
}

function buildAddress(properties, fallback = null) {
  return firstDefined(properties, [
    "address", "situs_address", "site_address", "full_address", "formatted_address"
  ]) || fallback;
}

function getParcelId(properties) {
  return firstDefined(properties, ["ll_uuid", "parcelnumb", "parcel_id", "apn"]);
}

function featureCenter(feature) {
  const geometry = feature?.geometry;
  const coords = geometry?.coordinates;
  if (!geometry || !coords) return null;

  if (geometry.type === "Point") return { longitude: coords[0], latitude: coords[1] };

  const flattened = [];
  const walk = value => {
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      flattened.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(walk);
  };
  walk(coords);
  if (!flattened.length) return null;

  const sum = flattened.reduce((acc, [lon, lat]) => ({ lon: acc.lon + lon, lat: acc.lat + lat }), { lon: 0, lat: 0 });
  return { longitude: sum.lon / flattened.length, latitude: sum.lat / flattened.length };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRadians = degrees => degrees * Math.PI / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

function getFeatures(responseData) {
  if (Array.isArray(responseData?.parcels?.features)) return responseData.parcels.features;
  if (Array.isArray(responseData?.features)) return responseData.features;
  return [];
}

async function regridGet(endpoint, params) {
  const token = process.env.REGRID_API_TOKEN;
  const baseUrl = process.env.REGRID_BASE_URL || "https://app.regrid.com";

  if (!token) {
    const error = new Error("REGRID_API_TOKEN is not configured.");
    error.statusCode = 500;
    throw error;
  }

  let response;
  try {
    response = await axios.get(`${baseUrl}${endpoint}`, {
      params: { ...params, token },
      timeout: 20000,
      validateStatus: status => status >= 200 && status < 500
    });
  } catch (providerError) {
    const error = new Error("The parcel-data provider could not be reached.");
    error.statusCode = 502;
    error.providerDetails = providerError.message;
    throw error;
  }

  if (response.status === 401 || response.status === 403) {
    const error = new Error("The parcel-data API token is invalid or lacks access.");
    error.statusCode = 502;
    throw error;
  }
  if (response.status === 429) {
    const error = new Error("The parcel-data API rate limit was reached.");
    error.statusCode = 429;
    throw error;
  }
  if (response.status >= 400) {
    const error = new Error("The parcel-data provider rejected the request.");
    error.statusCode = 502;
    error.providerDetails = response.data;
    throw error;
  }
  return response.data;
}

export async function getParcelAcreageByAddress(address) {
  const data = await regridGet("/api/v2/parcels/address", { query: address, limit: 5 });
  const features = getFeatures(data);

  if (features.length === 0) {
    const error = new Error("No parcel was found for that address.");
    error.statusCode = 404;
    throw error;
  }

  const feature = features[0];
  const properties = feature.properties || {};
  const reported = calculateReportedArea(properties);
  const calculated = calculateGeometryArea(feature);
  const selected = reported || (calculated ? {
    acres: calculated.acres,
    squareFeet: calculated.squareFeet,
    source: "calculated_from_parcel_geometry"
  } : null);

  if (!selected) {
    const error = new Error("The parcel was found, but acreage and usable boundary geometry were unavailable.");
    error.statusCode = 422;
    throw error;
  }

  return {
    requestedAddress: address,
    matchedAddress: buildAddress(properties, address),
    parcelId: getParcelId(properties),
    acreage: round(selected.acres, 3),
    squareFeet: Math.round(selected.squareFeet),
    measurementSource: selected.source,
    confidence: reported ? "provider-reported" : "geometry-calculated",
    boundary: feature.geometry,
    provider: "Regrid",
    warnings: [
      "Parcel acreage is not always the same as serviceable acreage.",
      "Confirm the boundary before using this value for a binding estimate."
    ]
  };
}

export async function getNearbyParcelAddresses({ latitude, longitude, radiusMiles, limit }) {
  const radiusMeters = Math.round(radiusMiles * METERS_PER_MILE);
  const data = await regridGet("/api/v2/parcels/point", {
    lat: latitude,
    lon: longitude,
    radius: radiusMeters,
    limit,
    return_geometry: true,
    return_count: true
  });

  const seen = new Set();
  const parcels = getFeatures(data)
    .map(feature => {
      const properties = feature.properties || {};
      const address = buildAddress(properties);
      const center = featureCenter(feature);
      const reported = calculateReportedArea(properties);
      const calculated = calculateGeometryArea(feature);
      const areaValue = reported || (calculated ? {
        acres: calculated.acres,
        squareFeet: calculated.squareFeet,
        source: "calculated_from_parcel_geometry"
      } : null);

      return {
        parcelId: getParcelId(properties),
        address,
        latitude: center?.latitude ?? null,
        longitude: center?.longitude ?? null,
        distanceMiles: center
          ? round(haversineMiles(latitude, longitude, center.latitude, center.longitude), 3)
          : null,
        acreage: areaValue ? round(areaValue.acres, 3) : null,
        squareFeet: areaValue ? Math.round(areaValue.squareFeet) : null,
        measurementSource: areaValue?.source ?? null,
        boundary: feature.geometry ?? null
      };
    })
    .filter(parcel => {
      const key = parcel.parcelId || parcel.address;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.distanceMiles ?? Number.MAX_VALUE) - (b.distanceMiles ?? Number.MAX_VALUE));

  return {
    center: { latitude, longitude },
    radiusMiles,
    radiusMeters,
    resultCount: parcels.length,
    providerCount: data?.count ?? null,
    parcels,
    provider: "Regrid",
    warnings: [
      "Results represent parcel records intersecting the search radius, not a complete mailing-address directory.",
      "Some parcels may have missing or nonstandard situs addresses."
    ]
  };
}
