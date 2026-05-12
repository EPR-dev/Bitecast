// One-shot audit: for every named point on the map, compute
//   - distance (meters) to the nearest shore vertex
//   - whether the point sits inside the island polygon (= ON LAND)
// and flag anything that looks misplaced.
//
// Run:  node scripts/_audit_points.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const LAT_DEG_M = 111000;
const LON_DEG_M = 111000 * Math.cos((32.778 * Math.PI) / 180);

function distMeters(lon1, lat1, lon2, lat2) {
  return Math.hypot((lon1 - lon2) * LON_DEG_M, (lat1 - lat2) * LAT_DEG_M);
}

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

function distToRing(lon, lat, ring) {
  let best = Infinity;
  for (const v of ring) {
    const d = distMeters(lon, lat, v[0], v[1]);
    if (d < best) best = d;
  }
  return best;
}

const shore = JSON.parse(readFileSync(resolve(ROOT, "data/shore.geojson"), "utf8"));
const sf = shore.features[0];
let ring;
if (sf.geometry.type === "Polygon") ring = sf.geometry.coordinates[0];
else { ring = sf.geometry.coordinates.slice(); const f = ring[0], l = ring[ring.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f); }

function audit(file) {
  const fc = JSON.parse(readFileSync(resolve(ROOT, "data/" + file), "utf8"));
  console.log("\n=== " + file + " (" + fc.features.length + " features) ===");
  console.log("  name".padEnd(40), "type".padEnd(14), "inside?".padEnd(8), "dist-to-shore".padStart(14), "  verdict");
  for (const f of fc.features) {
    const p = f.properties || {};
    const name = (p.name || p.id || "(unnamed)").slice(0, 38);
    const type = (p.type || p.activity || p.kind || "").slice(0, 12);
    const c = f.geometry.type === "Point" ? f.geometry.coordinates : f.geometry.coordinates[0][0];
    const inside = pointInRing(c[0], c[1], ring);
    const dist = distToRing(c[0], c[1], ring);
    let verdict;
    if (inside) {
      // Inside the island is OK for parking/POI; flag only if VERY deep inside (>200m from shore).
      verdict = dist > 200 ? "DEEP INTERIOR (suspicious)" : "on island OK";
    } else {
      // Outside the island. Up to ~50 m off shore is plausibly a road/lot edge. Over 100 m is in the water.
      if (dist < 50) verdict = "near shore OK";
      else if (dist < 100) verdict = "edge-of-shore — verify";
      else if (dist < 250) verdict = "WATER (~" + Math.round(dist) + "m off)";
      else verdict = "FAR IN WATER (" + Math.round(dist) + "m off)";
    }
    console.log("  " + name.padEnd(40), type.padEnd(14), (inside ? "yes" : "no").padEnd(8), (Math.round(dist) + " m").padStart(14), "  " + verdict);
  }
}

audit("access.geojson");
audit("hazards.geojson");
audit("pois.geojson");
audit("eelgrass.geojson");
