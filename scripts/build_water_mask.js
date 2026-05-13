#!/usr/bin/env node
// Build a non-water mask polygon from the bathy grid.
//
// The bathy grid is a set of regularly-spaced points inside Mission Bay's water
// area around Fiesta Island. This script:
//   1. Detects the grid spacing from the point cloud.
//   2. Builds a 2D occupancy grid: a cell is "water" iff a bathy point exists there.
//   3. Traces the perimeter of the occupied region as a closed polygon ring.
//   4. Emits a Polygon whose OUTER ring is a large rect around the demo view and
//      whose INNER ring (hole) is the water perimeter — i.e. fill this polygon
//      to paint everything-except-water.
//
// Output: data/non_water_mask.geojson
//
// Run from repo root:  node scripts/build_water_mask.js

const fs = require("fs");
const path = require("path");

const inPath = path.join(__dirname, "..", "data", "bathy_grid.geojson");
const outPath = path.join(__dirname, "..", "data", "non_water_mask.geojson");

const bathy = JSON.parse(fs.readFileSync(inPath, "utf8"));
const pts = bathy.features.map((f) => f.geometry.coordinates);
if (!pts.length) {
  console.error("No bathy points found.");
  process.exit(1);
}

// --- 1. Detect grid spacing -------------------------------------------------
// Use unique sorted lon/lat values and take the median spacing.
function uniqueSorted(arr) {
  const set = new Set(arr.map((v) => v.toFixed(6)));
  return [...set].map(Number).sort((a, b) => a - b);
}
const lonsU = uniqueSorted(pts.map((p) => p[0]));
const latsU = uniqueSorted(pts.map((p) => p[1]));
function medianDiff(sorted) {
  const diffs = [];
  for (let i = 1; i < sorted.length; i++) diffs.push(sorted[i] - sorted[i - 1]);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}
const dx = medianDiff(lonsU);
const dy = medianDiff(latsU);
const minLon = lonsU[0];
const minLat = latsU[0];
const maxLon = lonsU[lonsU.length - 1];
const maxLat = latsU[latsU.length - 1];
const cols = Math.round((maxLon - minLon) / dx) + 1;
const rows = Math.round((maxLat - minLat) / dy) + 1;
console.log(
  `Detected grid: ${cols}×${rows} cells, dx=${dx.toExponential(3)} dy=${dy.toExponential(3)}`,
);
console.log(`Bounding box: lon[${minLon}..${maxLon}] lat[${minLat}..${maxLat}]`);

// --- 2. Build occupancy grid ------------------------------------------------
const occ = Array.from({ length: rows }, () => new Uint8Array(cols));
for (const p of pts) {
  const c = Math.round((p[0] - minLon) / dx);
  const r = Math.round((p[1] - minLat) / dy);
  if (r >= 0 && r < rows && c >= 0 && c < cols) occ[r][c] = 1;
}
let occupied = 0;
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (occ[r][c]) occupied++;
console.log(`Occupied cells: ${occupied} / ${rows * cols}`);

// --- 3. Collect boundary edges ----------------------------------------------
// An edge is on the boundary if exactly one of the two cells it separates is
// occupied. We represent edges as integer-vertex pairs (corners of cells) on
// a doubled grid so we can hash them uniquely.
//
// Corner coords (lon, lat) for cell (c, r) corners:
//   (c-0.5, r-0.5), (c+0.5, r-0.5), (c+0.5, r+0.5), (c-0.5, r+0.5)
// We'll use integer indices: corner (ci, ri) where ci in [0..cols] and ri in [0..rows].
function cellOcc(c, r) {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return 0;
  return occ[r][c];
}
const edges = new Map(); // key "a|b" with a<b -> [a, b]
function addEdge(a, b) {
  const key = a < b ? a + "|" + b : b + "|" + a;
  if (edges.has(key)) edges.delete(key);
  else edges.set(key, [a, b]);
}
function vid(ci, ri) {
  return ri * (cols + 1) + ci;
}
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (!occ[r][c]) continue;
    // Bottom edge (between cell (c, r) and (c, r-1))
    if (!cellOcc(c, r - 1)) addEdge(vid(c, r), vid(c + 1, r));
    // Top edge (between cell (c, r) and (c, r+1))
    if (!cellOcc(c, r + 1)) addEdge(vid(c, r + 1), vid(c + 1, r + 1));
    // Left edge
    if (!cellOcc(c - 1, r)) addEdge(vid(c, r), vid(c, r + 1));
    // Right edge
    if (!cellOcc(c + 1, r)) addEdge(vid(c + 1, r), vid(c + 1, r + 1));
  }
}
console.log(`Boundary edges: ${edges.size}`);

// --- 4. Stitch edges into closed rings --------------------------------------
// Build adjacency: vertex -> list of connected vertices
const adj = new Map();
for (const [, [a, b]] of edges) {
  if (!adj.has(a)) adj.set(a, []);
  if (!adj.has(b)) adj.set(b, []);
  adj.get(a).push(b);
  adj.get(b).push(a);
}
const used = new Set();
const rings = [];
function vertexLonLat(v) {
  const ci = v % (cols + 1);
  const ri = Math.floor(v / (cols + 1));
  const lon = minLon + (ci - 0.5) * dx;
  const lat = minLat + (ri - 0.5) * dy;
  return [lon, lat];
}
function edgeKey(a, b) {
  return a < b ? a + "|" + b : b + "|" + a;
}
for (const start of adj.keys()) {
  if (used.has(start) && !hasUnusedEdge(start)) continue;
  let prev = -1;
  let cur = start;
  const ring = [cur];
  let safety = 0;
  while (safety++ < 1000000) {
    const neighbors = adj.get(cur) || [];
    let nxt = -1;
    for (const n of neighbors) {
      if (n === prev) continue;
      if (used.has(edgeKey(cur, n))) continue;
      nxt = n;
      break;
    }
    if (nxt === -1) break;
    used.add(edgeKey(cur, nxt));
    ring.push(nxt);
    prev = cur;
    cur = nxt;
    if (cur === start) break;
  }
  if (ring.length > 3 && ring[0] === ring[ring.length - 1]) {
    rings.push(ring);
  }
}
function hasUnusedEdge(v) {
  for (const n of adj.get(v) || []) if (!used.has(edgeKey(v, n))) return true;
  return false;
}
console.log(`Closed rings extracted: ${rings.length}`);

// Sort by length descending. The longest ring is the bay's outer perimeter
// (where water meets the surrounding mainland). Smaller rings are interior
// holes — i.e. the island(s) that sit inside the bay's water.
rings.sort((a, b) => b.length - a.length);
const bayPerimeter = rings[0];
const interiorRings = rings.slice(1);
console.log(
  `Bay perimeter ring: ${bayPerimeter.length} pts | interior rings (islands): ${interiorRings.length}`,
);

// Simple Douglas-Peucker simplification to drop redundant collinear points.
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  const px = a[0] + tt * dx, py = a[1] + tt * dy;
  return Math.hypot(p[0] - px, p[1] - py);
}
function rdp(points, eps) {
  if (points.length < 3) return points.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}
const eps = Math.max(dx, dy) * 0.3;
function toCoords(ring) {
  return rdp(ring.map(vertexLonLat), eps);
}
const bayPerimeterCoords = toCoords(bayPerimeter);
const interiorRingCoords = interiorRings.map(toCoords);
console.log(`Simplified bay perimeter: ${bayPerimeter.length} -> ${bayPerimeterCoords.length} points`);

// --- 5. Emit non-water mask as a MultiPolygon ------------------------------
// We emit two polygons that, together, cover all non-water area in our view:
//   Polygon A:  outerRect with the bay perimeter as a HOLE
//               -> renders all SURROUNDING mainland
//   Polygon B:  each island interior ring as its own polygon
//               -> renders the island(s) inside the bay
// This is unambiguous regardless of winding-rule choices.
const outerRect = [
  [-117.50, 32.50],
  [-117.00, 32.50],
  [-117.00, 33.10],
  [-117.50, 33.10],
  [-117.50, 32.50],
];
const polygons = [];
polygons.push([outerRect, bayPerimeterCoords]); // surrounding mainland
for (const r of interiorRingCoords) polygons.push([r]); // each island

const out = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        name: "Non-water mask (Mission Bay around Fiesta Island)",
        description:
          "MultiPolygon covering everything that is NOT bay water in the demo view. Derived from the bathy grid's occupancy. Fill this to clip overlay layers (e.g. heatmap) to water only.",
      },
      geometry: {
        type: "MultiPolygon",
        coordinates: polygons,
      },
    },
  ],
};
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${outPath} (${fs.statSync(outPath).size} bytes).`);
