// Bakes data/bathy_grid.geojson.
//
// Inputs:
//   - data/shore.geojson       (Fiesta Island shoreline; LineString or Polygon)
//   - data/eelgrass.geojson    (hand-drawn eelgrass polygons)
//   - DEPTH_CONTROL (hand-crafted depth soundings from Mission Bay chart 18772 reading)
//
// Output:
//   - data/bathy_grid.geojson  (FeatureCollection of Points with per-cell habitat features)
//
// Each cell has:
//   - depth_ft        : inverse-distance-weighted depth from control points
//   - dist_shore_m    : distance to nearest shore vertex (meters)
//   - dist_eelgrass_m : distance to nearest eelgrass polygon (0 = inside a bed)
//   - bottom_class    : "flat" | "ledge" | "channel"  (depth bins)
//
// Run with:  node scripts/bake_bathy_grid.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ----- Tunables ------------------------------------------------------------

// Grid extent (a comfortable window around Fiesta Island in Mission Bay).
const BBOX = { west: -117.2380, east: -117.2050, south: 32.7615, north: 32.7965 };
// Grid step in degrees. 0.00055 ~= 51 m N-S; ~52 m E-W at this latitude.
const STEP = 0.00055;
// Only include cells within this many meters of the shore — keeps the heat
// map focused on fishable water around the island.
const MAX_DIST_FROM_SHORE_M = 550;

// Hand-crafted depth control points (MLLW feet). These approximate the
// dredged channel + shallow flats pattern visible on NOAA chart 18772
// around Fiesta Island. They are demo-grade, not survey-grade.
const DEPTH_CONTROL = [
  // East channel between FI and mainland (Sea World side) — dredged
  { lon: -117.2068, lat: 32.7850, d: 14 },
  { lon: -117.2055, lat: 32.7800, d: 13 },
  { lon: -117.2068, lat: 32.7740, d: 11 },
  // North entrance area between FI and the bay opening — flushed by current
  { lon: -117.2200, lat: 32.7955, d: 13 },
  { lon: -117.2155, lat: 32.7945, d: 12 },
  { lon: -117.2245, lat: 32.7945, d: 11 },
  // Far NE (channel out to entrance)
  { lon: -117.2070, lat: 32.7920, d: 15 },
  // NW shelf — broad shallow
  { lon: -117.2280, lat: 32.7895, d: 6 },
  // West side — moderate depths
  { lon: -117.2340, lat: 32.7820, d: 7 },
  { lon: -117.2360, lat: 32.7780, d: 6 },
  { lon: -117.2335, lat: 32.7745, d: 5 },
  // SW protected cove — shallow, eelgrass-rich
  { lon: -117.2305, lat: 32.7705, d: 4 },
  // South flats — broad shallow sand
  { lon: -117.2220, lat: 32.7635, d: 3 },
  { lon: -117.2160, lat: 32.7625, d: 3 },
  { lon: -117.2105, lat: 32.7645, d: 4 },
  // SE drop-off (south flats fall into east channel)
  { lon: -117.2065, lat: 32.7690, d: 9 },
  // Shore-adjacent shallows on each side of FI
  { lon: -117.2120, lat: 32.7810, d: 4 },
  { lon: -117.2115, lat: 32.7770, d: 4 },
  { lon: -117.2125, lat: 32.7720, d: 3 },
  { lon: -117.2185, lat: 32.7680, d: 2 },
  { lon: -117.2240, lat: 32.7700, d: 3 },
  { lon: -117.2285, lat: 32.7750, d: 4 },
  { lon: -117.2275, lat: 32.7820, d: 4 },
  { lon: -117.2230, lat: 32.7880, d: 4 },
  { lon: -117.2180, lat: 32.7895, d: 4 },
];

// ----- Helpers -------------------------------------------------------------

// Approximate meters-per-degree at this latitude.
const LAT_DEG_M = 111000;
const LON_DEG_M = 111000 * Math.cos((32.778 * Math.PI) / 180);

function degDistMeters(lon1, lat1, lon2, lat2) {
  const dx = (lon1 - lon2) * LON_DEG_M;
  const dy = (lat1 - lat2) * LAT_DEG_M;
  return Math.hypot(dx, dy);
}

// Inverse-distance-weighted depth at (lon,lat). Power 2.5 gives a smoother
// transition between dredged channel and surrounding flats than power 1.
function depthAt(lon, lat) {
  let sumW = 0, sumD = 0;
  for (const c of DEPTH_CONTROL) {
    const dm = degDistMeters(lon, lat, c.lon, c.lat);
    if (dm < 1) return c.d;
    const w = 1 / Math.pow(dm, 2.5);
    sumW += w;
    sumD += w * c.d;
  }
  return sumD / sumW;
}

// Ray-casting point-in-polygon for a ring (array of [lon,lat]).
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Distance (meters) from a point to the nearest *vertex* of a ring. Vertices
// are dense enough on the OSM shore (320 of them) that vertex-distance is a
// fine approximation to true polyline distance for this resolution.
function distToRingVertices(lon, lat, ring) {
  let best = Infinity;
  for (const v of ring) {
    const dm = degDistMeters(lon, lat, v[0], v[1]);
    if (dm < best) best = dm;
  }
  return best;
}

function distToPolygons(lon, lat, polys) {
  let best = Infinity;
  for (const ring of polys) {
    if (pointInRing(lon, lat, ring)) return 0;
    for (const v of ring) {
      const dm = degDistMeters(lon, lat, v[0], v[1]);
      if (dm < best) best = dm;
    }
  }
  return best;
}

function classifyBottom(depth_ft) {
  if (depth_ft >= 10) return "channel";
  if (depth_ft >= 5) return "ledge";
  return "flat";
}

// ----- Main ---------------------------------------------------------------

const shore = JSON.parse(readFileSync(resolve(ROOT, "data/shore.geojson"), "utf8"));
const eelgrass = JSON.parse(readFileSync(resolve(ROOT, "data/eelgrass.geojson"), "utf8"));

// The OSM shore is a LineString (or Polygon). Treat the first feature's
// coordinates as a closed ring for PiP / proximity tests.
const shoreFeature = shore.features[0];
let shoreRing;
if (shoreFeature.geometry.type === "Polygon") {
  shoreRing = shoreFeature.geometry.coordinates[0];
} else if (shoreFeature.geometry.type === "LineString") {
  shoreRing = shoreFeature.geometry.coordinates.slice();
  const first = shoreRing[0], last = shoreRing[shoreRing.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) shoreRing.push(first);
}

const eelgrassRings = (eelgrass.features || []).map((f) => f.geometry.coordinates[0]);

const features = [];
let cellsTotal = 0, cellsInWater = 0, cellsNearShore = 0;

for (let lat = BBOX.south; lat <= BBOX.north + 1e-9; lat += STEP) {
  for (let lon = BBOX.west; lon <= BBOX.east + 1e-9; lon += STEP) {
    cellsTotal++;
    // Skip land (inside island).
    if (pointInRing(lon, lat, shoreRing)) continue;
    cellsInWater++;
    const dist_shore_m = distToRingVertices(lon, lat, shoreRing);
    if (dist_shore_m > MAX_DIST_FROM_SHORE_M) continue;
    cellsNearShore++;

    const depth_ft = +depthAt(lon, lat).toFixed(2);
    const dist_eelgrass_m = +distToPolygons(lon, lat, eelgrassRings).toFixed(0);

    features.push({
      type: "Feature",
      properties: {
        depth_ft,
        dist_shore_m: +dist_shore_m.toFixed(0),
        dist_eelgrass_m,
        bottom_class: classifyBottom(depth_ft),
      },
      geometry: { type: "Point", coordinates: [+lon.toFixed(5), +lat.toFixed(5)] },
    });
  }
}

const out = {
  type: "FeatureCollection",
  name: "Fiesta Island bathymetric grid (demo, IDW-interpolated)",
  metadata: {
    bbox: BBOX,
    step_deg: STEP,
    max_dist_from_shore_m: MAX_DIST_FROM_SHORE_M,
    control_points: DEPTH_CONTROL.length,
    cells_total: cellsTotal,
    cells_in_water: cellsInWater,
    cells_near_shore: cellsNearShore,
    cells_kept: features.length,
  },
  features,
};

writeFileSync(resolve(ROOT, "data/bathy_grid.geojson"), JSON.stringify(out));
console.log(
  "bake_bathy_grid: %d cells written. (water=%d, kept=%d)",
  features.length,
  cellsInWater,
  cellsNearShore
);
