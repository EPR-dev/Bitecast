// Single-shot build: fetch Fiesta Island OSM data and emit demo GeoJSON files.
import { writeFileSync } from "node:fs";

const OUT_DIR = "C:/Users/thesn/OneDrive/Documents/onwater-river-planner/data";
const URL_OVERPASS_PRIMARY = "https://overpass.kumi.systems/api/interpreter";
const URL_OVERPASS_FALLBACK = "https://overpass-api.de/api/interpreter";

// 1) Island relation, its members, plus key amenities inside the island bbox
//    and Ski Beach slipway (just outside the OSM polygon's west edge).
const BB = "32.7665,-117.2300,32.7905,-117.2100";
const queryRelation = `
[out:json][timeout:90];
relation(6172133);
(._;>;);
out geom tags;
`;
const queryAmenities = `
[out:json][timeout:60];
(
  way["amenity"="parking"](${BB});
  node["amenity"="parking"](${BB});
  way["amenity"="toilets"](${BB});
  node["amenity"="toilets"](${BB});
  node["amenity"="drinking_water"](${BB});
  node["amenity"="bbq"](${BB});
  node["leisure"="firepit"](${BB});
  node["tourism"="camp_site"](${BB});
  way["leisure"="park"](${BB});
  way["leisure"="dog_park"](${BB});
  node(48978905);
  way["highway"]["name"~"Fiesta Island",i](${BB});
);
out geom tags;
`;

async function overpassOnce(url, q) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "fiesta-island-demo/0.1 (offline build script)",
      Accept: "application/json",
    },
    body: "data=" + encodeURIComponent(q),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + ": " + (await r.text()).slice(0, 200));
  const json = await r.json();
  return json;
}

async function overpass(q, label) {
  const tries = [URL_OVERPASS_PRIMARY, URL_OVERPASS_FALLBACK, URL_OVERPASS_PRIMARY];
  let lastErr = null;
  for (let i = 0; i < tries.length; i++) {
    const url = tries[i];
    try {
      const json = await overpassOnce(url, q);
      const n = (json.elements || []).length;
      console.log(`[${label}] ${url} -> ${n} elements`);
      if (n > 0) return json;
      lastErr = new Error("empty response");
    } catch (e) {
      console.error(`[${label}] ${url} failed:`, e.message);
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000 + 1000 * i));
  }
  throw lastErr || new Error("overpass exhausted");
}

const relData = await overpass(queryRelation, "relation");
await new Promise((r) => setTimeout(r, 1500));
const amData = await overpass(queryAmenities, "amenity");
const relWayIds = new Set(
  (relData.elements || []).filter((e) => e.type === "way").map((e) => e.id),
);
const els = (relData.elements || []).concat(amData.elements || []);
console.log(
  "got",
  els.length,
  "elements (relation:",
  (relData.elements || []).length,
  "amenity:",
  (amData.elements || []).length,
  ")",
);

const wayById = new Map();
const nodeById = new Map();
for (const e of els) {
  if (e.type === "way") wayById.set(e.id, e);
  if (e.type === "node") nodeById.set(e.id, e);
}
const byKey = new Map();
for (const e of els) byKey.set(e.type + "/" + e.id, e);

function wayCoords(w) {
  if (w.geometry && w.geometry.length) return w.geometry.map((p) => [p.lon, p.lat]);
  if (w.nodes)
    return w.nodes.map((id) => nodeById.get(id)).filter(Boolean).map((n) => [n.lon, n.lat]);
  return [];
}

// --- Stitch the island relation's outer ways into one ring ---
function stitchToRings(lineArrays) {
  const EPS = 1e-7;
  const same = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  const remaining = lineArrays.map((c) => c.slice()).filter((c) => c.length >= 2);
  const rings = [];
  while (remaining.length) {
    let current = remaining.shift();
    let extended = true;
    while (extended) {
      extended = false;
      if (same(current[0], current[current.length - 1])) break;
      for (let i = 0; i < remaining.length; i++) {
        const next = remaining[i];
        if (same(current[current.length - 1], next[0])) {
          current = current.concat(next.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (same(current[current.length - 1], next[next.length - 1])) {
          current = current.concat(next.slice().reverse().slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (same(current[0], next[next.length - 1])) {
          current = next.slice().concat(current.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
        if (same(current[0], next[0])) {
          current = next.slice().reverse().concat(current.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }
    if (!same(current[0], current[current.length - 1])) current.push(current[0].slice());
    rings.push(current);
  }
  return rings;
}
function ringArea(coords) {
  let a = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    a += (coords[j][0] + coords[i][0]) * (coords[i][1] - coords[j][1]);
  }
  return Math.abs(a) / 2;
}
function bbox(coords) {
  let mnL = 1e9, mxL = -1e9, mnG = 1e9, mxG = -1e9;
  for (const c of coords) {
    if (c[1] < mnL) mnL = c[1];
    if (c[1] > mxL) mxL = c[1];
    if (c[0] < mnG) mnG = c[0];
    if (c[0] > mxG) mxG = c[0];
  }
  return { minLat: mnL, maxLat: mxL, minLon: mnG, maxLon: mxG };
}
function centroidOf(e) {
  if (e.type === "node") return [e.lon, e.lat];
  const c = wayCoords(e);
  if (!c.length) return null;
  const b = bbox(c);
  return [(b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2];
}

const islandRel = byKey.get("relation/6172133");
if (!islandRel) {
  console.error("Fiesta Island relation 6172133 missing");
  process.exit(1);
}
// Overpass `(._;>;); out geom;` returns the relation without member roles
// and the member ways inline. Fiesta Island is a simple island with no inner
// holes, so we treat every way pulled by the relation query as an outer line.
const outerLines = [];
const innerLines = [];
for (const id of relWayIds) {
  const w = wayById.get(id);
  if (!w) continue;
  const coords = wayCoords(w);
  if (coords.length < 2) continue;
  outerLines.push(coords);
}
const outerRings = stitchToRings(outerLines).sort((a, b) => ringArea(b) - ringArea(a));
const innerRings = stitchToRings(innerLines);
console.log(
  "relation way count:",
  relWayIds.size,
  "stitched into outer ring of",
  outerRings[0] ? outerRings[0].length : 0,
  "points",
);
const mainOuter = outerRings[0];
if (!mainOuter) {
  console.error("could not stitch outer ring");
  process.exit(1);
}
const ib = bbox(mainOuter);
console.log("island bbox:", ib);

// === shore.geojson ===
writeFileSync(
  OUT_DIR + "/shore.geojson",
  JSON.stringify(
    {
      type: "FeatureCollection",
      name: "Fiesta Island shoreline (OSM)",
      features: [
        {
          type: "Feature",
          properties: {
            name: "Fiesta Island shoreline",
            source: "OpenStreetMap relation 6172133",
            license: "ODbL",
          },
          geometry: { type: "LineString", coordinates: mainOuter },
        },
      ],
    },
    null,
    2,
  ),
);

// === park.geojson ===
writeFileSync(
  OUT_DIR + "/park.geojson",
  JSON.stringify(
    {
      type: "FeatureCollection",
      name: "Fiesta Island park (OSM)",
      features: [
        {
          type: "Feature",
          properties: {
            name: "Fiesta Island Park",
            land_class: "public",
            source: "OpenStreetMap relation 6172133",
            license: "ODbL",
          },
          geometry: { type: "Polygon", coordinates: [mainOuter].concat(innerRings) },
        },
      ],
    },
    null,
    2,
  ),
);

// === access.geojson ===
function pip(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
// Some OSM amenities sit slightly outside the relation's traced polygon
// (the perimeter and the amenities were edited independently — the northeast
// tip is a known offset). Treat anything inside the island bbox + ~150 m
// buffer as "on island" too.
const BUF = 0.0015;
function onIsland(lon, lat) {
  if (pip(lon, lat, mainOuter)) return true;
  return (
    lat >= ib.minLat - BUF &&
    lat <= ib.maxLat + BUF &&
    lon >= ib.minLon - BUF &&
    lon <= ib.maxLon + BUF
  );
}
const access = [];
function addAccess(props, lon, lat) {
  access.push({
    type: "Feature",
    properties: props,
    geometry: { type: "Point", coordinates: [lon, lat] },
  });
}

// Ski Beach slipway (special-cased; sits just west of OSM polygon edge but is the canonical Fiesta Island boat ramp).
const skiBeach = nodeById.get(48978905);
if (skiBeach) {
  addAccess(
    {
      name: "Ski Beach Boat Launch",
      type: "Boat Launch",
      activity: "boat",
      public_access: true,
      low_tide_ok: true,
      source: "OSM node 48978905",
      notes: "Concrete ramp on Ski Beach—main trailer launch for Fiesta Island.",
    },
    skiBeach.lon,
    skiBeach.lat,
  );
}

// Parking lots inside the island.
const parkingCentroids = [];
for (const e of els) {
  if (e.type !== "way") continue;
  if (!(e.tags && e.tags.amenity === "parking")) continue;
  if (e.tags.access === "private") continue;
  const c = centroidOf(e);
  if (!c || !onIsland(c[0], c[1])) continue;
  parkingCentroids.push({ id: e.id, lon: c[0], lat: c[1], tags: e.tags });
}
// Sort by latitude so the northernmost is last; assign a position label.
parkingCentroids.sort((a, b) => a.lat - b.lat);
function classifyParking(_p, idx, total) {
  const f = total <= 1 ? 0.5 : idx / (total - 1);
  if (f < 0.25)
    return { label: "South Shore", note: "South-east parking — closer to the dog beach end of the island." };
  if (f < 0.6)
    return { label: "East Shore Mid", note: "Mid east-shore parking near restrooms and the loop road." };
  if (f < 0.85)
    return { label: "East Shore North", note: "North-mid parking with picnic and water-edge access." };
  return { label: "North End", note: "North-tip parking — quieter end of the island." };
}
parkingCentroids.forEach((p, i) => {
  const c = classifyParking(p, i, parkingCentroids.length);
  addAccess(
    {
      name: p.tags.name ? p.tags.name + " parking" : c.label + " parking",
      type: "Parking",
      activity: "general",
      public_access: true,
      low_tide_ok: true,
      source: "OSM way " + p.id,
      notes: c.note,
    },
    p.lon,
    p.lat,
  );
});

// Dog Park entry (centroid of the dog park polygon, used as the dogs-activity entry).
const dogPark = wayById.get(1452635946);
if (dogPark) {
  const c = centroidOf(dogPark);
  if (c) {
    addAccess(
      {
        name: "Fiesta Island Dog Park entry",
        type: "Walk-in Gate",
        activity: "dogs",
        public_access: true,
        low_tide_ok: true,
        source: "OSM way 1452635946 (centroid)",
        notes: "Off-leash dog area entry—park along the loop road.",
      },
      c[0],
      c[1],
    );
  }
}

// Loop trailhead (easternmost point of Fiesta Island Road).
let loopStart = null;
for (const e of els) {
  if (e.type !== "way") continue;
  if (!(e.tags && e.tags.highway && /fiesta island/i.test(e.tags.name || ""))) continue;
  for (const pt of wayCoords(e)) {
    if (!loopStart || pt[0] > loopStart[0]) loopStart = pt;
  }
}
if (loopStart) {
  addAccess(
    {
      name: "Fiesta Island Rd entrance",
      type: "Trailhead",
      activity: "bike",
      public_access: true,
      low_tide_ok: true,
      source: "OSM Fiesta Island Road",
      notes: "Causeway entrance—flat ~4 mi shared-lane loop around the perimeter.",
    },
    loopStart[0],
    loopStart[1],
  );
}

// Paddle launch: southwest edge of island (sandy, sheltered; we anchor it to the polygon).
const swEdge = [ib.minLon + 0.0008, ib.minLat + 0.003];
addAccess(
  {
    name: "South-west paddle launch (informal)",
    type: "Paddle Launch",
    activity: "paddle",
    public_access: true,
    low_tide_ok: true,
    source: "approx. anchored to OSM island SW edge",
    notes: "Sandy edge of the no-wake cove—typical kayak / SUP launch.",
  },
  swEdge[0],
  swEdge[1],
);

writeFileSync(
  OUT_DIR + "/access.geojson",
  JSON.stringify(
    { type: "FeatureCollection", name: "Fiesta Island entries (OSM)", features: access },
    null,
    2,
  ),
);

// === pois.geojson ===
const pois = [];
for (const e of els) {
  const t = e.tags || {};
  let kind = null;
  if (t.amenity === "toilets") kind = { type: "Restroom", name: "Restroom" };
  else if (t.amenity === "drinking_water") kind = { type: "Water", name: "Drinking water" };
  else if (t.amenity === "bbq") kind = { type: "BBQ", name: "BBQ" };
  else if (t.leisure === "firepit") kind = { type: "Fire Ring", name: "Fire ring" };
  else if (t.tourism === "camp_site") kind = { type: "Camp", name: t.name || "Campground" };
  if (!kind) continue;
  const c = centroidOf(e);
  if (!c || !onIsland(c[0], c[1])) continue;
  pois.push({
    type: "Feature",
    properties: {
      name: kind.name,
      type: kind.type,
      source: "OSM " + e.type + " " + e.id,
      ...(t.fee ? { fee: t.fee } : {}),
    },
    geometry: { type: "Point", coordinates: c },
  });
}
writeFileSync(
  OUT_DIR + "/pois.geojson",
  JSON.stringify(
    { type: "FeatureCollection", name: "Fiesta Island facilities (OSM)", features: pois },
    null,
    2,
  ),
);

// === zones.geojson ===
const zones = [];
if (dogPark) {
  const c = wayCoords(dogPark);
  if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push(c[0]);
  zones.push({
    type: "Feature",
    properties: {
      name: dogPark.tags.name || "Off-leash dog area",
      activity: "dogs",
      source: "OSM way 1452635946",
      notes: "Off-leash dog area (verify hours on posted signage).",
    },
    geometry: { type: "Polygon", coordinates: [c] },
  });
}
// Approx water overlays anchored to the OSM island bounds.
zones.push({
  type: "Feature",
  properties: {
    name: "Ski / boating corridor (approx.)",
    activity: "boat",
    notes: "Posted ski course on the east water—observe direction & right-of-way.",
  },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [ib.maxLon, ib.maxLat - 0.002],
      [ib.maxLon + 0.012, ib.maxLat - 0.002],
      [ib.maxLon + 0.012, ib.minLat + 0.004],
      [ib.maxLon, ib.minLat + 0.004],
      [ib.maxLon, ib.maxLat - 0.002],
    ]],
  },
});
zones.push({
  type: "Feature",
  properties: {
    name: "No-wake cove (approx.)",
    activity: "no-wake",
    notes: "West cove — slow-speed; good for SUPs and kayaks.",
  },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [ib.minLon - 0.011, ib.maxLat - 0.001],
      [ib.minLon, ib.maxLat - 0.001],
      [ib.minLon, ib.minLat + 0.001],
      [ib.minLon - 0.011, ib.minLat + 0.001],
      [ib.minLon - 0.011, ib.maxLat - 0.001],
    ]],
  },
});
writeFileSync(
  OUT_DIR + "/zones.geojson",
  JSON.stringify(
    { type: "FeatureCollection", name: "Fiesta Island activity zones", features: zones },
    null,
    2,
  ),
);

// === hazards.geojson — anchored to OSM bounds so they sit in the right water ===
const hazards = [
  {
    type: "Feature",
    properties: {
      name: "Shallow flat (low tide)",
      kind: "Shallow",
      notes: "Exposes mud and seagrass at low tide—keep boats well clear.",
    },
    geometry: {
      type: "Point",
      coordinates: [ib.minLon - 0.004, (ib.minLat + ib.maxLat) / 2 - 0.002],
    },
  },
  {
    type: "Feature",
    properties: {
      name: "Submerged rocks (reported)",
      kind: "Caution",
      notes: "Avoid hugging this stretch of bank.",
    },
    geometry: { type: "Point", coordinates: [ib.minLon + 0.001, ib.maxLat - 0.001] },
  },
  {
    type: "Feature",
    properties: {
      name: "Active ski course",
      kind: "Watercraft",
      notes: "Posted ski course; paddlers stay inside the no-wake markers.",
    },
    geometry: { type: "Point", coordinates: [ib.maxLon + 0.004, (ib.minLat + ib.maxLat) / 2] },
  },
];
writeFileSync(
  OUT_DIR + "/hazards.geojson",
  JSON.stringify(
    { type: "FeatureCollection", name: "Fiesta Island cautions", features: hazards },
    null,
    2,
  ),
);

console.log("access:", access.length, "pois:", pois.length, "zones:", zones.length);
console.log(
  "island bbox:",
  `[${ib.minLat.toFixed(5)}, ${ib.minLon.toFixed(5)}] .. [${ib.maxLat.toFixed(5)}, ${ib.maxLon.toFixed(5)}]`,
);
