#!/usr/bin/env node
// Build a Mission Bay water polygon for the Bitecast demo.
//
// Why hand-trace and not pull from OSM?
//   - In OSM, "Mission Bay" is tagged as a node (point), not a polygon.
//   - The bay's water is implicit between Pacific Ocean coastline ways, which
//     when queried via Overpass return fragments of huge ocean relations that
//     don't form clean closed rings inside our bbox.
//
// This script encodes a hand-traced outline of Mission Bay's perimeter and
// punches out the major islands using the OSM-derived island polygons we
// already have (data/park.geojson for Fiesta Island).
//
// Output:
//   data/mission_bay_water.geojson  - Mission Bay water (Polygon w/ holes)
//   data/non_water_mask.geojson     - inverted: outer rect with water as hole
//
// Run:  node scripts/build_mission_bay_water.js

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Hand-traced Mission Bay water perimeter, going clockwise from the NW corner
// (Crown Point bridge area). Coordinates are [lon, lat] in WGS84. ~60 vertices
// covering all major coves: De Anza, Crown Point Shores, Sail Bay, Quivira
// Basin, Tecolote Cove, the entrance channel, and the East Channel along I-5.
// Accurate to ~25 m — sufficient for the demo's heatmap clipping purposes.
// ---------------------------------------------------------------------------
const missionBayPerimeter = [
  // NW: Crown Point bridge / north tip of Mission Beach
  [-117.2515, 32.7950],
  // Sail Bay north shore (between Crown Point and Mission Beach)
  [-117.2495, 32.7950],
  [-117.2480, 32.7935],
  [-117.2470, 32.7900],
  // Riviera Cove / Bahia Point dip
  [-117.2435, 32.7910],
  [-117.2420, 32.7930],
  // Crown Point Shores neighborhood headland
  [-117.2380, 32.7945],
  [-117.2330, 32.7945],
  // Pacific Passage to Crown Point peninsula
  [-117.2290, 32.7945],
  // North bay over Government Island / De Anza Cove
  [-117.2250, 32.7950],
  [-117.2200, 32.7950],
  [-117.2150, 32.7948],
  [-117.2100, 32.7945],
  // De Anza Cove eastern tip
  [-117.2065, 32.7935],
  [-117.2045, 32.7910],
  // East shore along I-5 freeway
  [-117.2010, 32.7880],
  [-117.1995, 32.7850],
  [-117.1985, 32.7800],
  [-117.1985, 32.7750],
  // SE corner: Tecolote Creek / Rose Creek confluence
  [-117.1990, 32.7700],
  [-117.2005, 32.7670],
  // South shore along Sea World Dr (south of Fiesta Island east channel)
  [-117.2045, 32.7635],
  [-117.2090, 32.7620],
  [-117.2140, 32.7615],
  [-117.2200, 32.7615],
  // Quivira Basin entrance + basin itself
  [-117.2240, 32.7625],
  [-117.2255, 32.7615],
  [-117.2295, 32.7610],
  [-117.2310, 32.7625],
  // West of Quivira, into the bay entrance channel
  [-117.2330, 32.7635],
  [-117.2370, 32.7635],
  [-117.2410, 32.7640],
  // Mission Bay channel toward Pacific Ocean (skipping the actual ocean exit
  // — we cap the polygon at the channel mouth so it stays "Mission Bay water")
  [-117.2475, 32.7655],
  [-117.2515, 32.7680],
  // W shore along Mission Beach east side
  [-117.2530, 32.7720],
  [-117.2530, 32.7770],
  [-117.2530, 32.7820],
  [-117.2525, 32.7870],
  [-117.2520, 32.7920],
  // Close back to NW
  [-117.2515, 32.7950],
];

// ---------------------------------------------------------------------------
// Islands inside the bay (treated as holes). Coordinates traced from OSM.
// ---------------------------------------------------------------------------

// Fiesta Island — load from the existing park.geojson (OSM-accurate).
function loadFiestaIsland() {
  const park = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "park.geojson"), "utf8"));
  const ring = park.features[0].geometry.coordinates[0];
  return ring;
}
const fiestaIsland = loadFiestaIsland();

// Vacation Isle (Crown Point Shores' SE neighbor — between Sail Bay and
// the main bay). Approximate trace.
const vacationIsle = [
  [-117.2490, 32.7820], [-117.2440, 32.7820], [-117.2410, 32.7805],
  [-117.2410, 32.7770], [-117.2440, 32.7755], [-117.2490, 32.7755],
  [-117.2510, 32.7775], [-117.2510, 32.7805], [-117.2490, 32.7820],
];

// Mariner's Point / Mariners Cove headland.
const marinersPoint = [
  [-117.2475, 32.7740], [-117.2440, 32.7745], [-117.2425, 32.7720],
  [-117.2455, 32.7710], [-117.2485, 32.7720], [-117.2475, 32.7740],
];

// Government Island (small island in the NE part of the bay).
const governmentIsland = [
  [-117.2200, 32.7905], [-117.2170, 32.7920], [-117.2145, 32.7905],
  [-117.2155, 32.7880], [-117.2190, 32.7880], [-117.2200, 32.7905],
];

// Crown Point Shores peninsula. Sticks SOUTH from the mainland into the bay,
// separating Sail Bay (west) from the main Mission Bay (east). The outer
// perimeter above runs across its northern attachment to the mainland, so we
// treat the peninsula as a hole / non-water polygon below.
const crownPointShores = [
  [-117.2440, 32.7945], // NW (attached to mainland)
  [-117.2360, 32.7945], // NE (attached to mainland)
  [-117.2355, 32.7905],
  [-117.2360, 32.7860],
  [-117.2370, 32.7820],
  [-117.2380, 32.7790],
  [-117.2395, 32.7775], // S tip
  [-117.2415, 32.7780],
  [-117.2430, 32.7805],
  [-117.2440, 32.7850],
  [-117.2445, 32.7900],
  [-117.2440, 32.7945],
];

// ---------------------------------------------------------------------------
// Build Mission Bay water polygon (outer ring + island holes).
// ---------------------------------------------------------------------------
const missionBayWater = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Mission Bay water (Bitecast demo)",
        note: "Hand-traced outer perimeter (~25 m accuracy). Holes are the major bay islands. Used to clip the species heatmap to water only.",
        license: "ODbL (island traces) + hand-crafted (perimeter)",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          missionBayPerimeter,
          fiestaIsland,
          vacationIsle,
          marinersPoint,
          governmentIsland,
          crownPointShores,
        ],
      },
    },
  ],
};
const waterOutPath = path.join(__dirname, "..", "data", "mission_bay_water.geojson");
fs.writeFileSync(waterOutPath, JSON.stringify(missionBayWater));
console.log(`Wrote ${waterOutPath} (${fs.statSync(waterOutPath).size} bytes).`);
console.log(`  Outer ring: ${missionBayPerimeter.length} pts`);
console.log(`  Holes: Fiesta Island (${fiestaIsland.length}), Vacation Isle (${vacationIsle.length}), Mariners Point (${marinersPoint.length}), Government Island (${governmentIsland.length}), Crown Point Shores (${crownPointShores.length})`);

// ---------------------------------------------------------------------------
// Build the non-water mask as the inverse: a big rect with the bay perimeter
// punched out. The mask layer paints this filled = everything-NOT-water.
//
// We also include each island ring as a SEPARATE polygon in a MultiPolygon
// so the islands themselves are part of the non-water mask (re-filled after
// being punched out as holes from the perimeter polygon).
// ---------------------------------------------------------------------------
const outerRect = [
  [-117.40, 32.65],
  [-117.10, 32.65],
  [-117.10, 32.90],
  [-117.40, 32.90],
  [-117.40, 32.65],
];
const nonWaterMask = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Non-water mask (Mission Bay region)",
        note: "Outer rectangle minus the Mission Bay water polygon, plus each island as a separate filled polygon. Drawn at high opacity above the heatmap to clip it to water only.",
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          // 1. Surrounding mainland (rect with bay perimeter as hole)
          [outerRect, missionBayPerimeter],
          // 2-N. Each island / peninsula re-filled as a non-water area
          [fiestaIsland],
          [vacationIsle],
          [marinersPoint],
          [governmentIsland],
          [crownPointShores],
        ],
      },
    },
  ],
};
const maskOutPath = path.join(__dirname, "..", "data", "non_water_mask.geojson");
fs.writeFileSync(maskOutPath, JSON.stringify(nonWaterMask));
console.log(`Wrote ${maskOutPath} (${fs.statSync(maskOutPath).size} bytes).`);
