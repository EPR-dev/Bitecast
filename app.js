(function () {
  "use strict";

  // ============================================================
  // Configuration
  // ============================================================
  const NOAA_STATION = "9410170";
  const NOAA_NAME = "San Diego Bay (Broadway Pier)";
  const PLACE_NAME = "Fiesta Island";
  const PLACE_LAT = 32.7784;
  const PLACE_LON = -117.2201;
  const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
  const FALLBACK_STYLE = {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "\u00a9 OpenStreetMap contributors",
      },
    },
    layers: [
      // Saturated water blue shows through wherever no fill is drawn —
      // this is what gives the surrounding bay its unmistakable "this is water" read.
      { id: "osm-bg", type: "background", paint: { "background-color": "#9fc5dc" } },
      // Dialed OSM raster opacity down so the OSM water/land tile colors don't
      // wash into each other; our land-fill layer paints the island on top.
      { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.62 } },
    ],
  };
  const LEGACY_WAYPOINT_KEY = "fiesta-island-planner-waypoints-v1";
  const PHOTO_MAX_DIM = 1280;
  const PHOTO_JPEG_QUALITY = 0.85;

  // Tide thresholds (ft, MLLW)
  const TIDE_LOW_FT = 1.5;
  const TIDE_HIGH_FT = 4.5;
  const SLACK_MIN = 45;

  // ============================================================
  // Mission Bay species deck
  // ============================================================
  // family colors: bass=green, halibut=tan, croaker=blue, sargo=purple,
  // surfperch=pink, tuna=deep-blue, shark=slate, ray=brown
  // Each species also carries a HABITAT profile used by the heat map:
  //   depth_peak / depth_sigma : ft. depth gaussian (e^-((d-peak)^2 / 2*sigma^2))
  //   shore_pref               : -1..+1 — positive prefers nearshore, negative prefers off-shore
  //   eelgrass_pref            :  0..+1 — eelgrass-affinity weight (boost when near a bed)
  //   channel_pref             :  0..+1 — channel/deep-water affinity (boost on >10 ft cells)
  const SPECIES = [
    { id: "spotted_bay_bass", name: "Spotted bay bass", family: "bass", accent: "#10b981",
      monthsPeak: [5,6,7,8,9], monthsActive: [1,2,3,4,5,6,7,8,9,10,11,12],
      tides: ["incoming","outgoing"], tods: ["dawn","dusk","morning","evening"],
      legal: "12 in min, 5/day",
      note: "Cast plastics tight to eelgrass edges, drop-offs, and pilings.",
      depth_peak: 8, depth_sigma: 4, shore_pref: 0.2, eelgrass_pref: 0.9, channel_pref: 0.25 },
    { id: "sand_bass", name: "Barred sand bass", family: "bass", accent: "#059669",
      monthsPeak: [6,7,8], monthsActive: [4,5,6,7,8,9,10],
      tides: ["incoming","outgoing"], tods: ["dawn","dusk"],
      legal: "14 in min, 5/day",
      note: "Mixed sand/eelgrass bottoms — soft plastics and small swimbaits.",
      depth_peak: 10, depth_sigma: 5, shore_pref: -0.1, eelgrass_pref: 0.4, channel_pref: 0.55 },
    { id: "california_halibut", name: "California halibut", family: "halibut", accent: "#c89968",
      monthsPeak: [5,6,7], monthsActive: [3,4,5,6,7,8,9,10],
      tides: ["outgoing","incoming","slack-low"], tods: ["dawn","morning","dusk"],
      legal: "22 in min, 5/day",
      note: "Drag swimbaits over sandy channels and ramp drop-offs. May-Jul = spawn.",
      depth_peak: 10, depth_sigma: 5, shore_pref: 0, eelgrass_pref: 0.1, channel_pref: 0.65 },
    { id: "yellowfin_croaker", name: "Yellowfin croaker", family: "croaker", accent: "#4ba3d6",
      monthsPeak: [6,7,8,9], monthsActive: [4,5,6,7,8,9,10],
      tides: ["incoming","outgoing","slack-low"], tods: ["dawn","dusk","night"],
      legal: "10/day",
      note: "Bait-fish the sandy edges and just inside the surf line.",
      depth_peak: 4, depth_sigma: 2.5, shore_pref: 0.7, eelgrass_pref: 0.15, channel_pref: 0.05 },
    { id: "spotfin_croaker", name: "Spotfin croaker", family: "croaker", accent: "#3b82c4",
      monthsPeak: [6,7,8,9,10], monthsActive: [4,5,6,7,8,9,10,11],
      tides: ["incoming","outgoing"], tods: ["dusk","night","dawn"],
      legal: "10/day, no commercial",
      note: "Sandcrabs or lugworm in the surf and sandy bay edges.",
      depth_peak: 5, depth_sigma: 2.5, shore_pref: 0.6, eelgrass_pref: 0.15, channel_pref: 0.05 },
    { id: "california_corbina", name: "California corbina", family: "croaker", accent: "#2563a3",
      monthsPeak: [6,7,8,9], monthsActive: [5,6,7,8,9,10],
      tides: ["incoming"], tods: ["morning","dusk"],
      legal: "10/day",
      note: "Sight-cast sandcrabs in the wash. Spooky on calm days — go light.",
      depth_peak: 3, depth_sigma: 1.5, shore_pref: 0.95, eelgrass_pref: 0.05, channel_pref: 0 },
    { id: "pacific_bonito", name: "Pacific bonito", family: "tuna", accent: "#0a72b8",
      monthsPeak: [7,8,9], monthsActive: [6,7,8,9,10],
      tides: ["incoming","outgoing"], tods: ["morning","dusk"],
      legal: "24 in OR 5 lb min, 5/day",
      note: "Boils inside the bay during warm summer windows — small chrome jigs.",
      depth_peak: 13, depth_sigma: 6, shore_pref: -0.5, eelgrass_pref: 0, channel_pref: 0.9 },
    { id: "pacific_mackerel", name: "Pacific mackerel", family: "tuna", accent: "#0c6ba8",
      monthsPeak: [5,6,7,8,9], monthsActive: [1,2,3,4,5,6,7,8,9,10,11,12],
      tides: ["incoming","outgoing"], tods: ["dawn","dusk","night"],
      legal: "no limit",
      note: "Easy bay catch on sabikis and small lures — great kids fish.",
      depth_peak: 10, depth_sigma: 5, shore_pref: -0.2, eelgrass_pref: 0.05, channel_pref: 0.7 },
    { id: "smoothhound_shark", name: "Smoothhound shark", family: "shark", accent: "#64748b",
      monthsPeak: [5,6,7,8,9], monthsActive: [3,4,5,6,7,8,9,10,11],
      tides: ["outgoing","slack-low","incoming"], tods: ["dusk","night","dawn"],
      legal: "no size, daily limits",
      note: "Cut bait on the bottom. Catch and release — handle gently.",
      depth_peak: 8, depth_sigma: 4, shore_pref: 0.1, eelgrass_pref: 0.1, channel_pref: 0.4 },
    { id: "leopard_shark", name: "Leopard shark", family: "shark", accent: "#475569",
      monthsPeak: [5,6,7,8], monthsActive: [3,4,5,6,7,8,9,10],
      tides: ["outgoing","slack-low"], tods: ["dusk","night","dawn"],
      legal: "36 in min, 3/day",
      note: "Bottom rigs with squid or shrimp. Strict size — usually released.",
      depth_peak: 10, depth_sigma: 5, shore_pref: 0, eelgrass_pref: 0.1, channel_pref: 0.55 },
    { id: "round_stingray", name: "Round stingray", family: "ray", accent: "#a16207",
      monthsPeak: [5,6,7,8,9], monthsActive: [3,4,5,6,7,8,9,10],
      tides: ["incoming","outgoing"], tods: ["dawn","dusk","morning"],
      legal: "no limit, incidental",
      note: "Common incidental catch. Cut leader — barb handles with care.",
      depth_peak: 4, depth_sigma: 2.5, shore_pref: 0.5, eelgrass_pref: 0.2, channel_pref: 0.05 },
    { id: "bat_ray", name: "Bat ray", family: "ray", accent: "#92400e",
      monthsPeak: [5,6,7,8,9], monthsActive: [3,4,5,6,7,8,9,10,11],
      tides: ["outgoing","slack-low","incoming"], tods: ["dusk","night","dawn"],
      legal: "no limit, often released",
      note: "Big bay species — stout gear, cut bait (squid/mackerel) on the bottom near sand drop-offs and eelgrass edges.",
      depth_peak: 8, depth_sigma: 5, shore_pref: 0.1, eelgrass_pref: 0.4, channel_pref: 0.35 },
  ];
  function speciesById(id) { return SPECIES.find((s) => s.id === id) || null; }

  // ============================================================
  // State
  // ============================================================
  let map = null;
  let geolocate = null;
  let accessFeatures = [];
  let zoneFeatures = [];
  // Phase 8: continuous habitat heat map (replaces discrete fishing zones)
  let bathyCells = [];          // [{lon, lat, depth_ft, dist_shore_m, dist_eelgrass_m, bottom_class}]
  let bathyGeoJson = null;      // GeoJSON wrapper for heatmap layer (weight injected per render)
  let targetSpeciesId = "any";  // "any" = combined opportunity, otherwise a species id
  let bestCell = null;          // cached top-scoring cell for current window
  let bestCellScore = 0;
  let heatMaxWeight = 1;        // for legend scaling
  let journalEntries = [];
  let journalPhotoUrls = new Map(); // entryId -> objectURL (revoke on rerender)

  let pickerMode = false;
  let pendingLngLat = null;
  let pendingSpeciesId = null;
  let pendingReleased = true;

  // Tide
  let latestWaterFt = null;
  let latestObsTime = null;
  let tideLevel = "unknown";
  let prevHiLo = null;
  let nextHiLo = null;
  let tideStage = "unknown";
  let tideEvents = []; // [{type:'H'|'L', time:Date, value:Number}] sorted ascending

  // Weather
  let latestWindMph = null;
  let latestPrecipProb = null;
  let latestTempF = null;
  let latestSkyCode = null;
  let sunriseTime = null;
  let sunsetTime = null;
  let hourlyForecast = []; // [{time:Date, temp_f, wind_mph, precip_prob, sky_code}]
  let dailySunrise = []; // [Date] indexed by daily forecast day
  let dailySunset = [];

  // Phase 5/6: scrub state (null = "now")
  let scrubTime = null;

  // Freshness / connectivity (Phase 4)
  let tideDataAt = null;
  let weatherDataAt = null;
  let tideIsStale = false;
  let weatherIsStale = false;
  let weatherDays = []; // precomputed daily strings for the card
  let isOnline = navigator.onLine !== false;

  let todayRecommendedAccess = null;
  let selectedActivity = "fishing";
  const els = {};

  // ============================================================
  // Helpers
  // ============================================================
  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function formatTime(ts) {
    if (!ts) return "\u2014";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  function formatClock(d) {
    if (!d) return "\u2014";
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function formatDuration(ms) {
    if (ms == null || !Number.isFinite(ms)) return "\u2014";
    if (ms < 0) ms = 0;
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return m + "m";
    if (m === 0) return h + "h";
    return h + "h " + m + "m";
  }
  function parseNoaaTime(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
    if (!m) return new Date(s);
    return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]), Number(m[5]));
  }
  function ymd(d) {
    return "" + d.getFullYear() + String(d.getMonth()+1).padStart(2,"0") + String(d.getDate()).padStart(2,"0");
  }

  // ============================================================
  // IndexedDB Journal
  // ============================================================
  const DB_NAME = "fiesta-island-journal";
  const DB_VERSION = 1;
  const STORE = "entries";
  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function dbPut(entry) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve(entry);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbDelete(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function migrateLegacyWaypoints() {
    const raw = localStorage.getItem(LEGACY_WAYPOINT_KEY);
    if (!raw) return 0;
    let fc;
    try { fc = JSON.parse(raw); } catch { return 0; }
    if (!fc || !Array.isArray(fc.features)) return 0;
    let count = 0;
    for (const f of fc.features) {
      if (!f.geometry || f.geometry.type !== "Point") continue;
      const p = f.properties || {};
      const entry = {
        id: "legacy_" + uuid(),
        type: "spot",
        createdAt: p.savedAt || new Date().toISOString(),
        geometry: { type: "Point", coordinates: f.geometry.coordinates },
        name: p.name || "Spot",
        notes: p.notes || "",
        spot_type: p.type || "spot",
        conditions: {
          tide_stage: p.tide_stage || null,
          water_ft: p.water_ft != null ? Number(p.water_ft) : null,
          wind_mph: p.wind_mph != null ? Number(p.wind_mph) : null,
          temp_f: p.temp_f != null ? Number(p.temp_f) : null,
        },
      };
      await dbPut(entry);
      count++;
    }
    localStorage.removeItem(LEGACY_WAYPOINT_KEY);
    return count;
  }

  // ============================================================
  // Tide / weather (same as Phase 1, lightly trimmed)
  // ============================================================
  function classifyTideLevel(ft) {
    if (ft == null || Number.isNaN(ft)) return "unknown";
    if (ft < TIDE_LOW_FT) return "low";
    if (ft > TIDE_HIGH_FT) return "high";
    return "mid";
  }
  function tideLevelLabel(level) {
    if (level === "low") return "Low";
    if (level === "high") return "High";
    if (level === "mid") return "Mid";
    return "\u2014";
  }
  function computeTideStage(prev, next, now) {
    if (!prev || !next) return "unknown";
    const slackMs = SLACK_MIN * 60 * 1000;
    const elapsed = now - prev.time.getTime();
    const remaining = next.time.getTime() - now;
    if (elapsed < slackMs) return prev.type === "H" ? "slack-high" : "slack-low";
    if (remaining < slackMs) return next.type === "H" ? "slack-high" : "slack-low";
    return prev.type === "L" ? "incoming" : "outgoing";
  }
  // Phase 5: find prev/next event bracketing a target time.
  function findPrevNext(events, targetMs) {
    let prev = null, next = null;
    for (const ev of events) {
      const t = ev.time.getTime();
      if (t <= targetMs) prev = ev;
      else if (!next) { next = ev; break; }
    }
    return { prev, next };
  }
  // Cosine interpolation between adjacent high/low events.
  function tideHeightAt(targetMs) {
    if (!tideEvents.length) return null;
    const { prev, next } = findPrevNext(tideEvents, targetMs);
    if (!prev || !next) return null;
    const t0 = prev.time.getTime();
    const t1 = next.time.getTime();
    if (t1 === t0) return prev.value;
    const phase = (targetMs - t0) / (t1 - t0);
    const factor = (1 - Math.cos(phase * Math.PI)) / 2;
    return prev.value + (next.value - prev.value) * factor;
  }
  function tideStageAtTime(targetMs) {
    const { prev, next } = findPrevNext(tideEvents, targetMs);
    return computeTideStage(prev, next, targetMs);
  }
  // Pick the hourly forecast bucket nearest a target time.
  function weatherAt(targetMs) {
    if (!hourlyForecast.length) {
      return {
        wind_mph: latestWindMph,
        temp_f: latestTempF,
        precip_prob: latestPrecipProb,
        sky_code: latestSkyCode,
        fromHourly: false,
      };
    }
    let best = hourlyForecast[0];
    let bestDt = Math.abs(best.time.getTime() - targetMs);
    for (const h of hourlyForecast) {
      const dt = Math.abs(h.time.getTime() - targetMs);
      if (dt < bestDt) { best = h; bestDt = dt; }
    }
    return { ...best, fromHourly: true };
  }
  function stageLabel(stage) {
    if (stage === "incoming") return "Incoming";
    if (stage === "outgoing") return "Outgoing";
    if (stage === "slack-high") return "Slack high";
    if (stage === "slack-low") return "Slack low";
    return "\u2014";
  }
  function stageArrow(stage) {
    if (stage === "incoming") return "\u25B2";
    if (stage === "outgoing") return "\u25BC";
    if (stage === "slack-high" || stage === "slack-low") return "\u25CB";
    return "";
  }
  function shoreColorForTide() {
    // Darkened palette so the shoreline reads cleanly against both the deeper
    // water-blue background and the sand-tone island fill.
    if (tideStage === "incoming") return "#0e6fa8";
    if (tideStage === "outgoing") return "#8a5a2a";
    if (tideStage === "slack-high") return "#0b4f7a";
    if (tideStage === "slack-low") return "#6b4a26";
    if (tideLevel === "low") return "#8a5a2a";
    if (tideLevel === "high") return "#0b4f7a";
    return "#0a4f7a";
  }
  function shoreGlowColorForTide() {
    if (tideStage === "incoming" || tideStage === "slack-high") return "#0a72b8";
    if (tideStage === "outgoing" || tideStage === "slack-low") return "#7a5a36";
    return "#0a72b8";
  }
  // Match a target date against the daily forecast arrays to get its sunrise/sunset.
  function sunForDate(d) {
    if (!d) return { sunrise: sunriseTime, sunset: sunsetTime };
    const target = d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
    for (let i = 0; i < dailySunrise.length; i++) {
      const sr = dailySunrise[i];
      if (!sr) continue;
      const key = sr.getFullYear() + "-" +
        String(sr.getMonth() + 1).padStart(2, "0") + "-" +
        String(sr.getDate()).padStart(2, "0");
      if (key === target) return { sunrise: sr, sunset: dailySunset[i] || null };
    }
    return { sunrise: sunriseTime, sunset: sunsetTime };
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }
  function timeOfDay(now, sunrise, sunset) {
    if (!sunrise || !sunset) {
      const h = now.getHours();
      if (h < 6) return "night";
      if (h < 10) return "morning";
      if (h < 14) return "midday";
      if (h < 17) return "afternoon";
      if (h < 20) return "evening";
      return "night";
    }
    const t = now.getTime();
    const sr = sunrise.getTime();
    const ss = sunset.getTime();
    const HR = 60 * 60 * 1000;
    if (t < sr - HR) return "night";
    if (t < sr + 1.5 * HR) return "dawn";
    if (t < ss - 1.5 * HR) return Math.abs(t - (sr + ss) / 2) < 2 * HR ? "midday" : "morning";
    if (t < ss + HR) return "dusk";
    return "night";
  }
  function timeOfDayLabel(tod) {
    if (tod === "dawn") return "Dawn";
    if (tod === "dusk") return "Dusk";
    if (tod === "morning") return "Morning";
    if (tod === "midday") return "Midday";
    if (tod === "afternoon") return "Afternoon";
    if (tod === "evening") return "Evening";
    if (tod === "night") return "Night";
    return "";
  }
  function skyDescription(code) {
    if (code == null) return "\u2014";
    if (code === 0) return "Clear";
    if (code <= 2) return "Mostly sunny";
    if (code === 3) return "Overcast";
    if (code === 45 || code === 48) return "Fog";
    if (code >= 51 && code <= 57) return "Drizzle";
    if (code >= 61 && code <= 67) return "Rain";
    if (code >= 71 && code <= 77) return "Snow";
    if (code >= 80 && code <= 82) return "Rain showers";
    if (code >= 95) return "Thunderstorms";
    return "Mixed";
  }
  function extendBoundsWithGeometry(bounds, geom) {
    if (!geom || !geom.coordinates) return;
    if (geom.type === "LineString") geom.coordinates.forEach((c) => bounds.extend(c));
    else if (geom.type === "MultiLineString" || geom.type === "Polygon")
      geom.coordinates.forEach((r) => r.forEach((c) => bounds.extend(c)));
    else if (geom.type === "MultiPolygon")
      geom.coordinates.forEach((p) => p.forEach((r) => r.forEach((c) => bounds.extend(c))));
  }
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Request failed: " + res.status);
    return res.json();
  }

  // Last-good cache (localStorage) for API responses, so the app keeps
  // displaying tide / weather even when offline.
  const LG_PREFIX = "fiesta-lg-";
  function lgSave(key, payload) {
    try {
      localStorage.setItem(LG_PREFIX + key, JSON.stringify({ at: new Date().toISOString(), payload }));
    } catch {}
  }
  function lgLoad(key) {
    try {
      const raw = localStorage.getItem(LG_PREFIX + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  function freshness(iso) {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + (minutes === 1 ? " min ago" : " min ago");
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hr ago" : " hr ago");
    const days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }
  async function loadGeo() {
    const [shore, access, hazards, pois, zones, park, eelgrass, bathy, nonWaterMask] = await Promise.all([
      fetchJson("data/shore.geojson"),
      fetchJson("data/access.geojson"),
      fetchJson("data/hazards.geojson"),
      fetchJson("data/pois.geojson"),
      fetchJson("data/zones.geojson"),
      fetchJson("data/park.geojson"),
      fetchJson("data/eelgrass.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
      fetchJson("data/bathy_grid.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
      fetchJson("data/non_water_mask.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    ]);
    accessFeatures = access.features || [];
    zoneFeatures = zones.features || [];
    // Cache bathy cells as a plain array for fast scoring.
    bathyCells = (bathy.features || []).map((f) => ({
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth_ft: f.properties.depth_ft,
      dist_shore_m: f.properties.dist_shore_m,
      dist_eelgrass_m: f.properties.dist_eelgrass_m,
      bottom_class: f.properties.bottom_class,
    }));
    bathyGeoJson = bathy;
    return { shore, access, hazards, pois, zones, park, eelgrass, bathy, nonWaterMask };
  }
  function noaaUrl(product, extra) {
    return (
      "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter" +
      "?application=fiesta-island-demo" +
      "&station=" + NOAA_STATION +
      "&product=" + product +
      "&datum=MLLW&time_zone=lst_ldt&units=english&format=json" + (extra || "")
    );
  }
  async function refreshTides() {
    const today = new Date();
    const yest = new Date(today); yest.setDate(today.getDate() - 1);
    const future = new Date(today); future.setDate(today.getDate() + 7);
    const range = "&begin_date=" + ymd(yest) + "&end_date=" + ymd(future);

    const [wlNet, predNet] = await Promise.all([
      fetchJson(noaaUrl("water_level", "&date=latest")).catch(() => null),
      fetchJson(noaaUrl("predictions", range + "&interval=hilo")).catch(() => null),
    ]);

    // Save what we got, then fall back to last-good for any missing piece.
    if (wlNet) lgSave("noaa-wl", wlNet);
    if (predNet) lgSave("noaa-pred", predNet);

    let wl = wlNet, pred = predNet;
    let staleSource = null;
    if (!wl) {
      const lg = lgLoad("noaa-wl");
      if (lg) { wl = lg.payload; staleSource = staleSource || lg.at; }
    }
    if (!pred) {
      const lg = lgLoad("noaa-pred");
      if (lg) { pred = lg.payload; staleSource = staleSource || lg.at; }
    }
    tideIsStale = staleSource !== null;
    tideDataAt = tideIsStale ? staleSource : new Date().toISOString();

    if (wl && wl.data && wl.data.length) {
      const last = wl.data[wl.data.length - 1];
      latestWaterFt = Number(last.v);
      latestObsTime = last.t;
    } else {
      latestWaterFt = null; latestObsTime = null;
    }
    tideLevel = classifyTideLevel(latestWaterFt);

    const preds = (pred && pred.predictions) || [];
    const now = new Date();
    const events = [];
    for (const p of preds) {
      const t = parseNoaaTime(p.t);
      if (!t) continue;
      events.push({ type: p.type, time: t, value: Number(p.v) });
    }
    events.sort((a, b) => a.time - b.time);
    tideEvents = events;
    prevHiLo = null; nextHiLo = null;
    for (const ev of events) {
      if (ev.time.getTime() <= now.getTime()) prevHiLo = ev;
      else if (!nextHiLo) nextHiLo = ev;
    }
    tideStage = computeTideStage(prevHiLo, nextHiLo, now.getTime());

    const todayHiLo = events.filter((e) => {
      const d = e.time;
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    });

    if (!wl && !pred) {
      const card = $("tideCard");
      if (card) card.innerHTML =
        "<p class='muted'>Couldn't load NOAA tides and no cached data yet. Once you're online for one refresh, this card will keep working offline.</p>";
    } else {
      renderTideCard(todayHiLo);
    }
    applyLayerVisibility();
    renderTodayPanel();
    renderConnectivity();
  }
  function renderTideCard(todayHiLo) {
    const card = $("tideCard");
    if (!card) return;
    const heightStr = latestWaterFt != null ? latestWaterFt.toFixed(2) + " ft" : "\u2014";
    const list = (todayHiLo || []).map((h) => {
      const tag = h.type === "H" ? "High" : "Low";
      return "<li><span>" + tag + " (" + formatClock(h.time) + ")</span><strong>" +
        h.value.toFixed(2) + " ft</strong></li>";
    }).join("");
    const freshTxt = freshness(tideDataAt);
    const freshHtml = freshTxt
      ? "<p class='freshness " + (tideIsStale ? "is-stale" : "is-fresh") + "'>" +
        (tideIsStale ? "Offline copy" : "Updated") + " " + escapeHtml(freshTxt) + "</p>"
      : "";
    card.innerHTML =
      "<h3>" + escapeHtml(NOAA_NAME) + "</h3>" +
      freshHtml +
      "<ul class='kv'>" +
      "<li><span>Station</span><strong>" + NOAA_STATION + "</strong></li>" +
      "<li><span>Water level (MLLW)</span><strong>" + heightStr + "</strong></li>" +
      "<li><span>Stage</span><strong>" + stageLabel(tideStage) + "</strong></li>" +
      "<li><span>Observed</span><strong>" + formatTime(latestObsTime) + "</strong></li>" +
      "</ul>" +
      (list ? "<h4>Today's highs &amp; lows</h4><ul class='kv'>" + list + "</ul>" : "") +
      "<p class='muted'>Station is in San Diego Bay; Mission Bay timing matches closely but heights vary a touch.</p>";
  }
  async function refreshWeather() {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=" + PLACE_LAT +
      "&longitude=" + PLACE_LON +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch" +
      "&current=temperature_2m,wind_speed_10m,precipitation,precipitation_probability,weather_code" +
      "&hourly=temperature_2m,wind_speed_10m,precipitation_probability,weather_code" +
      "&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min,sunrise,sunset" +
      "&timezone=America%2FLos_Angeles&forecast_days=7";
    let w = await fetchJson(url).catch(() => null);
    if (w) {
      lgSave("openmeteo", w);
      weatherIsStale = false;
      weatherDataAt = new Date().toISOString();
    } else {
      const lg = lgLoad("openmeteo");
      if (lg) { w = lg.payload; weatherIsStale = true; weatherDataAt = lg.at; }
    }
    if (!w) {
      $("weatherCard").innerHTML =
        "<p class='muted'>Weather unavailable and no cached copy. Once you're online for one refresh, this card will keep working offline.</p>";
      renderTodayPanel(); renderConnectivity();
      return;
    }
    const cur = w.current || {};
    const daily = w.daily || {};
    latestWindMph = cur.wind_speed_10m != null ? Math.round(cur.wind_speed_10m) : null;
    latestPrecipProb = cur.precipitation_probability != null ? cur.precipitation_probability : null;
    latestTempF = cur.temperature_2m != null ? cur.temperature_2m : null;
    latestSkyCode = cur.weather_code != null ? cur.weather_code : null;
    dailySunrise = (daily.sunrise || []).map((s) => s ? new Date(s) : null);
    dailySunset = (daily.sunset || []).map((s) => s ? new Date(s) : null);
    if (dailySunrise[0]) sunriseTime = dailySunrise[0];
    if (dailySunset[0]) sunsetTime = dailySunset[0];
    const hourly = w.hourly || {};
    hourlyForecast = (hourly.time || []).map((t, i) => ({
      time: new Date(t),
      temp_f: hourly.temperature_2m ? hourly.temperature_2m[i] : null,
      wind_mph: hourly.wind_speed_10m != null ? Math.round(hourly.wind_speed_10m[i]) : null,
      precip_prob: hourly.precipitation_probability ? hourly.precipitation_probability[i] : null,
      sky_code: hourly.weather_code ? hourly.weather_code[i] : null,
    }));
    weatherDays = (daily.time || []).map((t, i) => {
      let label = t;
      try { label = new Date(t + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); } catch {}
      const lo = daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[i]) : null;
      const hi = daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[i]) : null;
      const tempStr = lo != null && hi != null ? lo + "\u2013" + hi + "\u00b0F" : "\u2014";
      const precip = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null;
      return "<li><span>" + escapeHtml(label) + "</span><strong>" + tempStr +
        ", precip " + (precip != null ? precip : "\u2014") + "% max</strong></li>";
    });
    const freshTxt = freshness(weatherDataAt);
    const freshHtml = freshTxt
      ? "<p class='freshness " + (weatherIsStale ? "is-stale" : "is-fresh") + "'>" +
        (weatherIsStale ? "Offline copy" : "Updated") + " " + escapeHtml(freshTxt) + "</p>"
      : "";
    $("weatherCard").innerHTML =
      freshHtml +
      "<ul class='kv'>" +
      "<li><span>Temp</span><strong>" + (latestTempF != null ? Math.round(latestTempF) + "\u00b0F" : "\u2014") + "</strong></li>" +
      "<li><span>Wind</span><strong>" + (latestWindMph != null ? latestWindMph + " mph" : "\u2014") + "</strong></li>" +
      "<li><span>Sky</span><strong>" + skyDescription(latestSkyCode) + "</strong></li>" +
      "<li><span>Sunrise</span><strong>" + (sunriseTime ? formatClock(sunriseTime) : "\u2014") + "</strong></li>" +
      "<li><span>Sunset</span><strong>" + (sunsetTime ? formatClock(sunsetTime) : "\u2014") + "</strong></li>" +
      "<li><span>Precip now</span><strong>" + (cur.precipitation != null ? cur.precipitation + " in" : "\u2014") + "</strong></li>" +
      "<li><span>Precip chance</span><strong>" + (latestPrecipProb != null ? latestPrecipProb + "%" : "\u2014") + "</strong></li>" +
      "</ul>" +
      "<h4>3-day outlook</h4><ul class='kv'>" + weatherDays.join("") + "</ul>";
    renderTodayPanel();
    renderConnectivity();
  }

  // ============================================================
  // Conditions snapshot (saved with each journal entry)
  // ============================================================
  function snapshotConditions() {
    const now = new Date();
    return {
      capturedAt: now.toISOString(),
      tide_stage: tideStage,
      tide_level: tideLevel,
      water_ft: latestWaterFt,
      tide_prev: prevHiLo ? { type: prevHiLo.type, time: prevHiLo.time.toISOString(), value: prevHiLo.value } : null,
      tide_next: nextHiLo ? { type: nextHiLo.type, time: nextHiLo.time.toISOString(), value: nextHiLo.value } : null,
      wind_mph: latestWindMph,
      temp_f: latestTempF != null ? Math.round(latestTempF) : null,
      sky_code: latestSkyCode,
      sky: skyDescription(latestSkyCode),
      precip_prob: latestPrecipProb,
      time_of_day: timeOfDay(now, sunriseTime, sunsetTime),
      sunrise: sunriseTime ? sunriseTime.toISOString() : null,
      sunset: sunsetTime ? sunsetTime.toISOString() : null,
    };
  }

  // ============================================================
  // Photo downscaling
  // ============================================================
  async function downscaleImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("image decode failed"));
        img.onload = () => {
          const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) reject(new Error("toBlob failed"));
            else resolve(blob);
          }, "image/jpeg", quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  // Zone filters / map layer visibility
  // ============================================================
  function buildZoneFilters() {
    const zones = [...new Set(zoneFeatures.map((f) => f.properties.activity).filter(Boolean))].sort();
    els.zoneFilters.innerHTML = "";
    zones.forEach((z) => {
      const label = document.createElement("label");
      label.className = "check";
      label.innerHTML =
        '<input type="checkbox" class="zone" value="' + escapeAttr(z) + '" checked /> ' + escapeHtml(z);
      els.zoneFilters.appendChild(label);
    });
  }
  function selectedZones() {
    const boxes = els.zoneFilters.querySelectorAll(".zone");
    const on = [];
    boxes.forEach((b) => { if (b.checked) on.push(b.value); });
    return on.length === boxes.length || on.length === 0 ? null : on;
  }
  function zoneFilterExpression() {
    const z = selectedZones();
    if (!z || !z.length) return null;
    return ["in", ["get", "activity"], ["literal", z]];
  }
  function applyLayerVisibility() {
    if (!map || !map.isStyleLoaded()) return;
    const simple = $("simpleMapView") && $("simpleMapView").checked;
    const vis = (id, show) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    };
    vis("park-fill", !simple);
    vis("zones-fill", !simple);
    vis("pois-layer", !simple);
    vis("journal-layer", $("filterJournal") && $("filterJournal").checked);
    vis("access-layer", true);
    vis("hazards-layer", true);
    vis("shore-line-glow", true);
    vis("shore-line", true);
    // Phase 8: continuous habitat heat map + best-spot pin always visible
    // when the user is not in simple-map mode. The user can hide the heat
    // via the "show heat map" toggle if they just want the chart.
    const showHeat = $("filterHeatmap") ? $("filterHeatmap").checked : true;
    const showEelgrass = $("filterEelgrass") ? $("filterEelgrass").checked : true;
    vis("habitat-heat", showHeat);
    vis("eelgrass-fill", showEelgrass);
    vis("best-spot-halo", showHeat);
    vis("best-spot-dot", showHeat);
    if (map.getLayer("zones-fill")) map.setFilter("zones-fill", zoneFilterExpression());
    const colorByTide = $("filterTideColor") && $("filterTideColor").checked;
    const mainColor = colorByTide ? shoreColorForTide() : "#0a4f7a";
    // Inner glow is the LAND-side soft shadow — keep it in the sand family at
    // all times so it never reads as heatmap bleed.
    if (map.getLayer("shore-line-glow")) map.setPaintProperty("shore-line-glow", "line-color", "#c9b687");
    if (map.getLayer("shore-line")) map.setPaintProperty("shore-line", "line-color", mainColor);
  }
  function popupHtml(props, titleKey) {
    const title = props[titleKey] || props.name || "Details";
    const rows = Object.keys(props)
      .filter((k) => k !== titleKey && props[k] !== null && props[k] !== undefined && String(props[k]).length)
      .map((k) => "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(String(props[k])) + "</dd>");
    return "<strong>" + escapeHtml(String(title)) + "</strong><dl class='pop-dl'>" + rows.join("") + "</dl>";
  }

  // ============================================================
  // Today panel (verdict, stage, tips) - same as Phase 1
  // ============================================================
  function rankSpecies(now, stage, tod) {
    const month = now.getMonth() + 1;
    return SPECIES.map((s) => {
      let score = 0;
      if (s.monthsPeak.includes(month)) score += 30;
      else if (s.monthsActive.includes(month)) score += 10;
      if (s.tides.includes(stage)) score += 20;
      if (s.tods.includes(tod)) score += 10;
      return { sp: s, score };
    }).sort((a, b) => b.score - a.score)
      .filter((r) => r.score > 20).slice(0, 3).map((r) => r.sp);
  }
  function computeVerdict(targetDate) {
    const target = targetDate || new Date();
    const targetMs = target.getTime();
    const reasons = [];
    let score = 50;
    // Tide stage at target time (uses scrub-aware lookup)
    const stage = tideStageAtTime(targetMs);
    if (stage === "incoming" || stage === "outgoing") {
      score += 30;
      reasons.push({ label: "Tide is moving (" + stageLabel(stage).toLowerCase() + ")", delta: 30 });
    } else if (stage === "slack-high" || stage === "slack-low") {
      score -= 10;
      reasons.push({ label: "Slack tide — current barely moving", delta: -10 });
    } else {
      reasons.push({ label: "Tide stage unknown (data loading)", delta: 0 });
    }
    // Weather at target time (hourly forecast if available, else current)
    const wx = weatherAt(targetMs);
    if (wx.wind_mph == null) reasons.push({ label: "Wind data loading", delta: 0 });
    else if (wx.wind_mph < 8) { score += 12; reasons.push({ label: "Calm wind (" + wx.wind_mph + " mph)", delta: 12 }); }
    else if (wx.wind_mph < 14) { score += 4; reasons.push({ label: "Light wind (" + wx.wind_mph + " mph)", delta: 4 }); }
    else if (wx.wind_mph < 20) { score -= 12; reasons.push({ label: "Breezy (" + wx.wind_mph + " mph) — lines bow", delta: -12 }); }
    else { score -= 25; reasons.push({ label: "Windy (" + wx.wind_mph + " mph) — small boats wary", delta: -25 }); }
    if (wx.precip_prob == null) reasons.push({ label: "Precip data loading", delta: 0 });
    else if (wx.precip_prob < 30) { score += 5; reasons.push({ label: "Dry forecast", delta: 5 }); }
    else if (wx.precip_prob < 60) reasons.push({ label: "Spot showers possible", delta: 0 });
    else { score -= 15; reasons.push({ label: "High rain chance (" + wx.precip_prob + "%)", delta: -15 }); }
    const sun = sunForDate(target);
    const tod = timeOfDay(target, sun.sunrise, sun.sunset);
    if (tod === "dawn" || tod === "dusk") { score += 15; reasons.push({ label: timeOfDayLabel(tod) + " light — prime feeding window", delta: 15 }); }
    else if (tod === "midday") { score -= 5; reasons.push({ label: "Midday sun — fish push deeper", delta: -5 }); }
    else if (tod === "night") { score -= 5; reasons.push({ label: "After dark — bay bite slows", delta: -5 }); }
    else reasons.push({ label: timeOfDayLabel(tod) + " hours", delta: 0 });
    const month = target.getMonth() + 1;
    if (month >= 5 && month <= 7) { score += 8; reasons.push({ label: "Halibut spawn window (May–Jul)", delta: 8 }); }
    if (score < 0) score = 0;
    if (score > 100) score = 100;
    let level = "ok";
    if (score >= 70) level = "go";
    else if (score < 40) level = "skip";
    let confidence = 1;
    if (score >= 90) confidence = 5;
    else if (score >= 75) confidence = 4;
    else if (score >= 60) confidence = 3;
    else if (score >= 40) confidence = 2;
    return { level, score, confidence, reasons, tod, stage, wx };
  }
  function recommendStartAccessFeature(stageKey) {
    if (!accessFeatures.length) return null;
    const act = selectedActivity || "general";
    const stageNow = stageKey || tideStage;
    if (act === "fishing") {
      const pref =
        stageNow === "outgoing" || stageNow === "slack-low"
          ? ["Boat Launch", "Paddle Launch", "Parking"]
          : ["Paddle Launch", "Parking", "Boat Launch"];
      for (const t of pref) {
        const f = accessFeatures.find((af) => (af.properties.type || "") === t);
        if (f) return f;
      }
      return accessFeatures[0];
    }
    let pool = accessFeatures.filter((f) => (f.properties.activity || "general") === act);
    if (!pool.length && act !== "general") pool = accessFeatures.filter((f) => (f.properties.activity || "general") === "general");
    if (!pool.length) pool = accessFeatures.slice();
    if (tideLevel === "low") {
      const lowOk = pool.filter((f) => f.properties.low_tide_ok !== false);
      if (lowOk.length) pool = lowOk;
    }
    return pool[0];
  }
  function flyToCoord(coord) {
    if (!map || !coord) return;
    map.flyTo({ center: coord, zoom: Math.max(map.getZoom(), 15), essential: true });
  }
  function flyToAccessFeature(feat) {
    if (feat && feat.geometry && feat.geometry.type === "Point") flyToCoord(feat.geometry.coordinates);
  }
  function switchToTab(name) {
    const tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.click();
  }
  function renderConfidenceDots(n) {
    let s = "";
    for (let i = 0; i < 5; i++) s += i < n ? "\u25CF" : "\u25CB";
    return s;
  }

  // ============================================================
  // Phase 8: Habitat heat map
  // ============================================================
  //
  // Approach: a static grid of points (one per ~55 m cell) covers the water
  // around Fiesta Island. Each cell already knows its depth, distance to
  // shore, and distance to eelgrass (baked into data/bathy_grid.geojson).
  //
  // At render time we compute a per-cell weight for the previewed window:
  //
  //   weight = depthGaussian(cell, sp)
  //          * seasonMul(sp, month)     // 0 if out of season, 1.3 in peak
  //          * tideMul(sp, stage)       // 1.0 right, 0.5 wrong
  //          * todMul(sp, tod)          // 1.0 right, 0.6 wrong
  //          * habitatMul(cell, sp)     // shore + eelgrass + channel proximity
  //
  // "Target = any" sums weights across in-season species and exposes the
  // overall opportunity surface; selecting a species narrows the view.
  //
  // The MapLibre heatmap layer renders the weighted points as a smooth
  // gradient; the highest-weight cell becomes the "best spot" pin.

  function depthGaussian(depth_ft, peak, sigma) {
    if (sigma <= 0) return 0;
    const dz = depth_ft - peak;
    return Math.exp(-(dz * dz) / (2 * sigma * sigma));
  }
  function habitatMul(cell, sp) {
    let mul = 1.0;
    // Shore proximity (positive shore_pref favors nearshore; negative favors offshore).
    const shorePref = sp.shore_pref || 0;
    if (shorePref !== 0) {
      // 0 m = full nearshore weight, 300 m = neutral.
      const shoreNess = Math.max(0, 1 - cell.dist_shore_m / 300);
      // shoreNess is 0..1; map to -1..+1 around the neutral point at 150 m.
      const norm = 2 * shoreNess - 1;
      mul *= (1 + 0.6 * shorePref * norm);
    }
    // Eelgrass proximity: inside or within ~80 m gets the full boost.
    const eelPref = sp.eelgrass_pref || 0;
    if (eelPref > 0) {
      const eelNess = cell.dist_eelgrass_m <= 0 ? 1 : Math.max(0, 1 - cell.dist_eelgrass_m / 120);
      mul *= (1 + 0.8 * eelPref * eelNess);
    }
    // Channel/deep-water affinity kicks in above 8 ft.
    const chPref = sp.channel_pref || 0;
    if (chPref > 0) {
      const depthness = Math.max(0, Math.min(1, (cell.depth_ft - 8) / 7));
      mul *= (1 + 0.7 * chPref * depthness);
    }
    return Math.max(0.3, Math.min(2.0, mul));
  }
  function scoreCellForSpecies(cell, sp, stageKey, tod, month) {
    if (!sp.monthsActive.includes(month)) return 0;
    const seasonMul = sp.monthsPeak.includes(month) ? 1.3 : 1.0;
    const tideMul = stageKey && sp.tides.includes(stageKey) ? 1.0 : 0.5;
    const todMul = tod && sp.tods.includes(tod) ? 1.0 : 0.6;
    const depthScore = depthGaussian(cell.depth_ft, sp.depth_peak, sp.depth_sigma);
    if (depthScore < 0.02) return 0;
    return depthScore * seasonMul * tideMul * todMul * habitatMul(cell, sp);
  }
  function scoreCellCombined(cell, stageKey, tod, month) {
    let total = 0;
    for (const sp of SPECIES) {
      total += scoreCellForSpecies(cell, sp, stageKey, tod, month);
    }
    return total;
  }
  function topSpeciesForCell(cell, stageKey, tod, month, n) {
    const ranked = [];
    for (const sp of SPECIES) {
      const s = scoreCellForSpecies(cell, sp, stageKey, tod, month);
      if (s > 0) ranked.push({ sp, score: s });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, n || 3);
  }
  function bottomDescription(cell) {
    const bits = [];
    bits.push(cell.depth_ft.toFixed(1) + " ft");
    if (cell.bottom_class === "channel") bits.push("channel depth");
    else if (cell.bottom_class === "ledge") bits.push("ledge / drop-off");
    else bits.push("sand flat");
    if (cell.dist_eelgrass_m === 0) bits.push("in eelgrass");
    else if (cell.dist_eelgrass_m < 80) bits.push("eelgrass edge");
    if (cell.dist_shore_m < 60) bits.push("close to shore");
    else if (cell.dist_shore_m > 250) bits.push("off-shore");
    return bits.join(" \u00B7 ");
  }
  // Re-score every cell for the current window and push the updated weights
  // into the heatmap source. Also pick the top cell as the "best spot."
  function refreshHeatmap(target, stageKey, tod) {
    if (!bathyGeoJson || !bathyCells.length) return;
    const month = (target || new Date()).getMonth() + 1;
    const sp = targetSpeciesId === "any" ? null : speciesById(targetSpeciesId);
    let maxW = 0;
    let bestIdx = -1;
    let bestScore = 0;
    const features = bathyGeoJson.features;
    // Hot path: avoid allocations.
    for (let i = 0; i < features.length; i++) {
      const cell = bathyCells[i];
      const w = sp
        ? scoreCellForSpecies(cell, sp, stageKey, tod, month)
        : scoreCellCombined(cell, stageKey, tod, month);
      features[i].properties.weight = w;
      if (w > maxW) maxW = w;
      if (w > bestScore) { bestScore = w; bestIdx = i; }
    }
    // Normalize weights into 0..1 so the heatmap layer has a stable
    // color ramp regardless of the absolute scale of the current window
    // (e.g. winter is dimmer than summer).
    const denom = maxW > 0 ? maxW : 1;
    for (let i = 0; i < features.length; i++) {
      features[i].properties.weight_norm = features[i].properties.weight / denom;
    }
    heatMaxWeight = maxW;
    bestCell = bestIdx >= 0 ? bathyCells[bestIdx] : null;
    bestCellScore = bestScore;

    if (map && map.getSource("bathy-grid")) {
      try { map.getSource("bathy-grid").setData(bathyGeoJson); } catch {}
    }
    syncBestSpotPin();
  }
  function syncBestSpotPin() {
    if (!map || !map.getSource("best-spot")) return;
    const fc = { type: "FeatureCollection", features: [] };
    if (bestCell && bestCellScore > 0) {
      fc.features.push({
        type: "Feature",
        properties: { score: bestCellScore },
        geometry: { type: "Point", coordinates: [bestCell.lon, bestCell.lat] },
      });
    }
    try { map.getSource("best-spot").setData(fc); } catch {}
  }
  function targetLabel() {
    if (targetSpeciesId === "any") return "Any species";
    const sp = speciesById(targetSpeciesId);
    return sp ? sp.name : "Any species";
  }
  function inSeasonSpeciesList(target) {
    const month = (target || new Date()).getMonth() + 1;
    return SPECIES.filter((s) => s.monthsActive.includes(month));
  }
  function renderTargetSpeciesPicker(target) {
    const wrap = $("targetSpeciesPicker");
    if (!wrap) return;
    const list = inSeasonSpeciesList(target);
    const chips = [];
    chips.push(
      "<button type='button' class='target-chip" +
      (targetSpeciesId === "any" ? " is-active" : "") +
      "' data-target-sp='any'>" +
      "<span class='target-dot' style='background:#94a3b8'></span>" +
      "<span class='target-name'>Any species</span></button>"
    );
    for (const sp of list) {
      const active = targetSpeciesId === sp.id;
      chips.push(
        "<button type='button' class='target-chip" + (active ? " is-active" : "") +
        "' data-target-sp='" + sp.id + "'>" +
        "<span class='target-dot' style='background:" + sp.accent + "'></span>" +
        "<span class='target-name'>" + escapeHtml(sp.name) + "</span></button>"
      );
    }
    wrap.innerHTML = chips.join("");
    wrap.querySelectorAll("[data-target-sp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        targetSpeciesId = btn.getAttribute("data-target-sp");
        renderTodayPanel();
      });
    });
  }
  function renderTargetSpeciesCard(target, stageKey, tod) {
    const card = $("targetSpeciesCard");
    if (!card) return;
    refreshHeatmap(target, stageKey, tod);
    const legendTarget = $("heatLegendTarget");
    if (legendTarget) legendTarget.textContent = targetLabel();

    const sp = targetSpeciesId === "any" ? null : speciesById(targetSpeciesId);
    const month = target.getMonth() + 1;
    const seasonOK = !sp || sp.monthsActive.includes(month);
    const peak = sp && sp.monthsPeak.includes(month);

    const label = targetLabel();
    const eyebrow = sp
      ? (peak ? "Peak season target" : seasonOK ? "Target species" : "Out of season")
      : "All in-season opportunity";

    let body = "";
    if (!bathyCells.length) {
      body = "<p class='zone-reason'>Heat map data loading\u2026</p>";
    } else if (!bestCell || bestCellScore <= 0) {
      body = sp
        ? "<p class='zone-reason'>" + escapeHtml(sp.name) +
            " is out of season this month. Try \"Any species\" or pick something active." +
          "</p>"
        : "<p class='zone-reason'>No active species for this window — odds are low across the bay.</p>";
    } else {
      const bestBottom = bottomDescription(bestCell);
      const topAt = topSpeciesForCell(bestCell, stageKey, tod, month, 3);
      const reason = sp
        ? buildSpeciesReason(sp, bestCell, stageKey, tod)
        : "Hot spot blends best in-season species — heat reflects combined chance across the bay.";
      const chips = topAt.length
        ? topAt.map((r) =>
            "<span class='chip chip-species' title='" + escapeAttr(r.sp.note) + "'>" +
            "<span class='chip-dot' style='background:" + r.sp.accent + "'></span>" +
            escapeHtml(r.sp.name) + "</span>"
          ).join("")
        : "";
      body =
        "<p class='zone-reason'>" + escapeHtml(reason) + "</p>" +
        (chips ? "<div class='zone-species chip-row'>" + chips + "</div>" : "") +
        "<div class='zone-meta'>" +
          "<span class='zone-pill'>Hot spot: " + escapeHtml(bestBottom) + "</span>" +
          "<button type='button' class='btn btn-ghost zone-fly' data-best-fly='1'>Show on map</button>" +
        "</div>";
    }
    const accent = sp ? sp.accent : "#0a72b8";
    card.style.setProperty("--zone-color", accent);
    card.hidden = false;
    card.innerHTML =
      "<div class='zone-head'>" +
        "<span class='zone-eyebrow'>" + escapeHtml(eyebrow) + "</span>" +
        "<span class='zone-habitat' style='--zone-color:" + accent + "'>" +
          "<span class='zone-swatch' style='background:" + accent + "'></span>" +
          escapeHtml(label) +
        "</span>" +
      "</div>" + body;
    const flyBtn = card.querySelector("[data-best-fly]");
    if (flyBtn) flyBtn.addEventListener("click", () => {
      if (bestCell) { flyToCoord([bestCell.lon, bestCell.lat]); switchToTab("map"); }
    });
  }
  function buildSpeciesReason(sp, cell, stageKey, tod) {
    const bits = [];
    // Depth phrasing
    const dp = sp.depth_peak;
    if (cell.depth_ft < dp - 2) bits.push(sp.name + " sit on shallower water than the bay's best — this is the upper edge of their range");
    else if (cell.depth_ft > dp + 2) bits.push("Deeper hold — fish hang on the channel side");
    else bits.push("Right in the sweet-spot depth (~" + dp + " ft)");
    // Habitat
    if (sp.eelgrass_pref > 0.5 && cell.dist_eelgrass_m < 100) bits.push("on the eelgrass edge");
    if (sp.shore_pref > 0.5 && cell.dist_shore_m < 80) bits.push("tight to the shore wash");
    if (sp.channel_pref > 0.5 && cell.depth_ft > 9) bits.push("along the channel seam");
    // Tide
    if (stageKey === "incoming") bits.push("incoming pushes bait in");
    else if (stageKey === "outgoing") bits.push("outgoing drains bait off the flats");
    else if (stageKey === "slack-high") bits.push("slack high — slow drift");
    else if (stageKey === "slack-low") bits.push("slack low — fish the deepest edge");
    return bits.join(". ") + ".";
  }
  function fishingZonesPlaceholder() {
    // (Phase 8) The discrete fishing-zone polygons have been retired in favor
    // of the continuous heat map. data/fishing_zones.geojson is still on disk
    // for future reference, but is no longer loaded by the runtime.
  }
  function renderTodayPanel() {
    const now = new Date();
    const target = scrubTime || now;
    const isScrub = scrubTime != null;
    const verdict = computeVerdict(target);
    const stageKey = verdict.stage;
    const wx = verdict.wx;
    const verdictPill = verdict.level === "go" ? "GO" : verdict.level === "ok" ? "OK" : "SKIP";
    const verdictSummary =
      verdict.level === "go" ? "Strong " + (selectedActivity === "fishing" ? "fishing" : "day") + " window."
      : verdict.level === "ok" ? "Workable with caveats." : "Probably skip today.";
    const stageText = stageLabel(stageKey);
    const arrow = stageArrow(stageKey);

    // Height: prefer interpolated for target, fall back to latest observation if scrub == now.
    const heightAtTarget = tideHeightAt(target.getTime());
    const heightForDisplay = heightAtTarget != null ? heightAtTarget : latestWaterFt;
    const heightStr = heightForDisplay != null ? heightForDisplay.toFixed(2) + " ft" : "\u2014";
    const { prev: tPrev, next: tNext } = findPrevNext(tideEvents, target.getTime());

    let stageDetail = "";
    if (tPrev && tNext) {
      const remaining = tNext.time.getTime() - target.getTime();
      stageDetail = heightStr + " (MLLW). Next " + (tNext.type === "H" ? "high" : "low") + " " +
        tNext.value.toFixed(1) + " ft at " + formatClock(tNext.time) +
        " — " + formatDuration(remaining) + (isScrub ? " from preview." : " away.");
    } else {
      stageDetail = heightStr + " (MLLW). Tide schedule loading\u2026";
    }
    if (verdict.level === "go" && (stageKey === "incoming" || stageKey === "outgoing") && tNext) {
      const remaining = tNext.time.getTime() - target.getTime();
      const peakStart = Math.max(0, remaining - 90 * 60 * 1000);
      if (peakStart > 0) {
        const ps = new Date(target.getTime() + peakStart);
        const pe = new Date(target.getTime() + remaining - 15 * 60 * 1000);
        stageDetail += " Peak bite window: " + formatClock(ps) + "\u2013" + formatClock(pe) + ".";
      }
    }

    renderDatePicker();

    // Scrub banner (above all cards). Shows different text for today vs future days.
    const scrubBar = $("scrubBar");
    if (scrubBar) {
      if (isScrub) {
        const sameAsToday = sameDay(target, now);
        let label;
        if (sameAsToday) {
          const deltaMs = target.getTime() - now.getTime();
          label = deltaMs >= 0
            ? "Previewing " + formatClock(target) + " (in " + formatDuration(deltaMs) + ")"
            : "Previewing " + formatClock(target) + " (" + formatDuration(-deltaMs) + " ago)";
        } else {
          const dayStr = target.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
          label = "Previewing " + dayStr + " at " + formatClock(target);
        }
        scrubBar.innerHTML =
          "<span class='scrub-label'>" + escapeHtml(label) + "</span>" +
          "<button type='button' class='btn btn-ghost' id='scrubReset'>Reset to now</button>";
        scrubBar.hidden = false;
        const resetBtn = $("scrubReset");
        if (resetBtn) resetBtn.addEventListener("click", () => { scrubTime = null; renderTodayPanel(); });
      } else {
        scrubBar.hidden = true;
        scrubBar.innerHTML = "";
      }
    }

    const stageCard = $("stageCard");
    if (stageCard) {
      stageCard.innerHTML =
        "<div class='stage-row'>" +
        "<span class='stage-label'>" + (isScrub ? "Tide at preview" : "Tide stage") + "</span>" +
        "<span class='stage-label'>" + escapeHtml(timeOfDayLabel(verdict.tod)) + "</span>" +
        "</div>" +
        "<h3 class='stage-headline'><span class='arrow'>" + arrow + "</span> " + escapeHtml(stageText) + "</h3>" +
        "<p class='stage-detail'>" + escapeHtml(stageDetail) + "</p>";
    }
    renderTideTimeline(target);

    const vCard = $("todayVerdict");
    if (vCard) {
      vCard.className = "verdict-card is-" + verdict.level + (isScrub ? " is-scrub" : "");
      vCard.innerHTML =
        "<div class='verdict-pill'>" + verdictPill + "</div>" +
        "<div class='verdict-header'>" +
        "<span class='verdict-summary'>" + escapeHtml(verdictSummary) + "</span>" +
        "<span class='verdict-confidence' title='Confidence " + verdict.confidence + " of 5'>" +
        renderConfidenceDots(verdict.confidence) + "</span>" +
        "</div>" +
        "<p class='verdict-headline'>" + escapeHtml(buildVerdictHeadline(verdict, stageKey, tNext, target)) + "</p>";
    }
    const tempStr = wx.temp_f != null ? Math.round(wx.temp_f) + "\u00b0F" : "\u2014";
    const windStr = wx.wind_mph != null ? wx.wind_mph + " mph" : "\u2014";
    const precipStr = wx.precip_prob != null ? wx.precip_prob + "% precip" : "\u2014";
    const targetSun = sunForDate(target);
    const sunsetStr = targetSun.sunset ? "sunset " + formatClock(targetSun.sunset) : "";
    const strip = $("todayConditions");
    if (strip) {
      strip.innerHTML =
        "<span><strong>" + tempStr + "</strong></span>" +
        "<span><strong>Wind</strong> " + windStr + "</span>" +
        "<span><strong>Sky</strong> " + escapeHtml(skyDescription(wx.sky_code)) + "</span>" +
        "<span><strong>" + escapeHtml(precipStr) + "</strong></span>" +
        (sunsetStr ? "<span>" + escapeHtml(sunsetStr) + "</span>" : "");
    }
    const species = rankSpecies(target, stageKey, verdict.tod);
    const feat = recommendStartAccessFeature(stageKey);
    todayRecommendedAccess = feat;
    const playRow = $("todayPlays");
    if (playRow) {
      const speciesChips = species.map((s) =>
        "<span class='chip chip-species' title='" + escapeAttr(s.note) + "'>" +
        "<span class='chip-dot' style='background:" + s.accent + "'></span>" +
        escapeHtml(s.name) + "</span>"
      ).join("");
      const spotChip = feat
        ? "<button type='button' class='chip chip-spot' data-fly='1'>\u279C " + escapeHtml(feat.properties.name || "Suggested entry") + "</button>"
        : "";
      playRow.innerHTML = (speciesChips || "<span class='muted'>No matching species for this window.</span>") + spotChip;
      const flyBtn = playRow.querySelector("[data-fly]");
      if (flyBtn) flyBtn.addEventListener("click", () => {
        if (todayRecommendedAccess) { flyToAccessFeature(todayRecommendedAccess); switchToTab("map"); }
      });
    }
    renderTargetSpeciesPicker(target);
    renderTargetSpeciesCard(target, stageKey, verdict.tod);
    const recs = buildTodayTips(target, verdict, species, feat, stageKey, wx);
    const ul = $("todayRecs");
    if (ul) ul.innerHTML = recs.map((r) => "<li>" + escapeHtml(r) + "</li>").join("");
    const whyList = $("whyList");
    if (whyList) {
      whyList.innerHTML = verdict.reasons.map((r) => {
        const cls = r.delta > 0 ? "plus" : r.delta < 0 ? "minus" : "zero";
        const sign = r.delta > 0 ? "+" : r.delta < 0 ? "" : "\u00b1";
        return "<li><span>" + escapeHtml(r.label) + "</span><span class='delta " + cls + "'>" + sign + r.delta + "</span></li>";
      }).join("");
      const whyScore = $("whyScore");
      if (whyScore) whyScore.textContent = "Score " + verdict.score + " / 100";
    }
    renderInsightsStrip();
  }
  function buildVerdictHeadline(v, stageKey, nextEv, target) {
    if (stageKey === "incoming" || stageKey === "outgoing") {
      const remaining = nextEv ? formatDuration(nextEv.time.getTime() - target.getTime()) : "";
      return stageLabel(stageKey) + " tide" + (remaining ? " for the next " + remaining : "") +
        ". " + (selectedActivity === "fishing"
          ? "Best bite window is the back half of the run."
          : "Current is moving — water activities are favorable.");
    }
    if (stageKey === "slack-high" || stageKey === "slack-low") {
      return "Slack water — bite often pauses; great time to reposition or check bait.";
    }
    return "Loading current conditions\u2026";
  }
  function buildTodayTips(target, verdict, species, feat, stageKey, wx) {
    const tips = [];
    if (stageKey === "incoming") tips.push("Incoming tide pushes bait into the bay — work eelgrass edges and channel mouths.");
    else if (stageKey === "outgoing") tips.push("Outgoing tide concentrates bait at channel exits — fish drop-offs and the last hour of the ebb.");
    else if (stageKey === "slack-high") tips.push("Slack high — bite slows; good time to reposition, scout, or grab bait.");
    else if (stageKey === "slack-low") tips.push("Slack low — structure is exposed; cast tight to drop-offs and pilings before the turn.");
    if (selectedActivity === "fishing") {
      if (verdict.tod === "dawn" || verdict.tod === "dusk") tips.push("Low-light window: surface and shallow plastics shine. Slow your retrieve.");
      else if (verdict.tod === "midday") tips.push("Midday: drop deeper. Drop-shot the channel ledges and bridge pilings.");
      if (wx.wind_mph != null && wx.wind_mph >= 15) tips.push("Wind is up — lee shorelines stay fishable.");
      if (species.length) tips.push("Likely catches: " + species.map((s) => s.name).join(", ") + ".");
    } else if (selectedActivity === "dogs") tips.push("Off-leash hours and area rules apply — bring water and bags.");
    else if (selectedActivity === "paddle") tips.push("Paddle: PFD required; the west cove is usually calmest.");
    else if (selectedActivity === "boat") tips.push("Boats: observe no-wake zones; yield to paddlers and swimmers.");
    else if (selectedActivity === "bike") tips.push("Bike: ~4 mi flat loop; watch for loose sand near the south end.");
    if (wx.precip_prob != null && wx.precip_prob >= 50) tips.push("Rain odds elevated (" + wx.precip_prob + "%). Seal gear, fishing usually keeps going.");
    if (feat) tips.push("Suggested start: " + (feat.properties.name || "see map") + ".");
    return tips;
  }

  // ============================================================
  // Phase 6: 7-day date picker (trip planner)
  // ============================================================
  function renderDatePicker() {
    const wrap = $("datePicker");
    if (!wrap) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    const viewing = scrubTime || new Date();
    wrap.innerHTML = days.map((d, idx) => {
      const active = sameDay(d, viewing);
      const label = idx === 0 ? "Today" :
        idx === 1 ? "Tomorrow" :
        d.toLocaleDateString(undefined, { weekday: "short" });
      const sub = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return "<button type='button' class='date-chip" + (active ? " is-active" : "") +
        "' data-day-idx='" + idx + "'>" +
        "<span class='date-chip-label'>" + escapeHtml(label) + "</span>" +
        "<span class='date-chip-sub'>" + escapeHtml(sub) + "</span>" +
        "</button>";
    }).join("");
    wrap.querySelectorAll("[data-day-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-day-idx"));
        const target = new Date(today);
        target.setDate(target.getDate() + idx);
        if (idx === 0) {
          // "Today" — drop scrub entirely and go back to live view.
          scrubTime = null;
        } else {
          // Future day — anchor to that day at noon (or the next H/L event after dawn).
          target.setHours(12, 0, 0, 0);
          const sun = sunForDate(target);
          if (sun.sunrise) {
            const dawn = new Date(sun.sunrise.getTime() + 30 * 60 * 1000);
            target.setHours(dawn.getHours(), dawn.getMinutes(), 0, 0);
          }
          scrubTime = target;
        }
        renderTodayPanel();
      });
    });
  }

  // ============================================================
  // Phase 5: 12-hour tide timeline (SVG, scrub-aware)
  // ============================================================
  // Timeline geometry: -2h .. +10h around centerTime (default now).
  const TL_W = 1200, TL_H = 160;
  const TL_M = { top: 28, right: 12, bottom: 22, left: 12 };
  const TL_PLOT_W = TL_W - TL_M.left - TL_M.right;
  const TL_PLOT_H = TL_H - TL_M.top - TL_M.bottom;

  // Decide what time window the timeline shows.
  // Today (no scrub or scrub still on today): rolling -2h..+10h centered on now.
  // Future day: that day, 5am..10pm (angler hours).
  function currentTimelineWindow() {
    const now = new Date();
    const nowMs = now.getTime();
    if (!scrubTime || sameDay(scrubTime, now)) {
      return { xMin: nowMs - 2 * 3600 * 1000, xMax: nowMs + 10 * 3600 * 1000, anchor: "today" };
    }
    const day = new Date(scrubTime);
    day.setHours(5, 0, 0, 0);
    const xMin = day.getTime();
    day.setHours(22, 0, 0, 0);
    const xMax = day.getTime();
    return { xMin, xMax, anchor: "future" };
  }

  function renderTideTimeline(target) {
    const svg = $("tideTimeline");
    if (!svg) return;
    const now = new Date();
    const nowMs = now.getTime();
    const targetMs = (target || now).getTime();

    const win = currentTimelineWindow();
    const xMin = win.xMin;
    const xMax = win.xMax;
    const timeToX = (t) => TL_M.left + ((t - xMin) / (xMax - xMin)) * TL_PLOT_W;
    const xToTime = (x) => xMin + ((x - TL_M.left) / TL_PLOT_W) * (xMax - xMin);

    if (!tideEvents.length) {
      svg.innerHTML =
        "<text x='" + (TL_W / 2) + "' y='" + (TL_H / 2) +
        "' text-anchor='middle' fill='#94a3b8' font-size='14'>Tide data loading…</text>";
      return;
    }

    // Sample the curve every 10 minutes.
    const samples = [];
    const step = 10 * 60 * 1000;
    for (let t = xMin; t <= xMax; t += step) {
      const h = tideHeightAt(t);
      if (h != null) samples.push({ t, h });
    }
    if (samples.length < 2) {
      svg.innerHTML =
        "<text x='" + (TL_W / 2) + "' y='" + (TL_H / 2) +
        "' text-anchor='middle' fill='#94a3b8' font-size='14'>Not enough tide data for this window.</text>";
      return;
    }
    // Y-scale from local samples (with a touch of padding).
    let yMin = Infinity, yMax = -Infinity;
    for (const s of samples) { if (s.h < yMin) yMin = s.h; if (s.h > yMax) yMax = s.h; }
    const yPad = Math.max(0.2, (yMax - yMin) * 0.15);
    yMin -= yPad; yMax += yPad;
    const heightToY = (h) => TL_M.top + (1 - (h - yMin) / (yMax - yMin)) * TL_PLOT_H;

    // Sun bands (dawn / dusk shading) for the day being viewed.
    const viewDate = scrubTime || now;
    const viewSun = sunForDate(viewDate);
    const bands = [];
    if (viewSun.sunrise && viewSun.sunset) {
      const sr = viewSun.sunrise.getTime();
      const ss = viewSun.sunset.getTime();
      const HR = 60 * 60 * 1000;
      bands.push({ x1: xMin, x2: Math.min(sr - HR, xMax), fill: "#1e293b", opacity: 0.06, label: "" });
      bands.push({ x1: Math.max(sr - HR, xMin), x2: Math.min(sr + 1.5 * HR, xMax), fill: "#fbbf24", opacity: 0.18, label: "Dawn" });
      bands.push({ x1: Math.max(ss - 1.5 * HR, xMin), x2: Math.min(ss + HR, xMax), fill: "#c084fc", opacity: 0.18, label: "Dusk" });
      bands.push({ x1: Math.max(ss + HR, xMin), x2: xMax, fill: "#1e293b", opacity: 0.06, label: "" });
    }

    // Build curve + area paths.
    let pathD = "";
    let areaD = "";
    const baselineY = heightToY(yMin);
    samples.forEach((s, i) => {
      const x = timeToX(s.t);
      const y = heightToY(s.h);
      pathD += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
    });
    areaD = pathD +
      "L" + timeToX(samples[samples.length - 1].t).toFixed(1) + "," + baselineY.toFixed(1) +
      "L" + timeToX(samples[0].t).toFixed(1) + "," + baselineY.toFixed(1) + "Z";

    // High/low markers within the window.
    const markers = tideEvents
      .filter((e) => e.time.getTime() >= xMin && e.time.getTime() <= xMax)
      .map((e) => {
        const x = timeToX(e.time.getTime());
        const y = heightToY(e.value);
        const isHigh = e.type === "H";
        return (
          "<circle cx='" + x.toFixed(1) + "' cy='" + y.toFixed(1) + "' r='5' fill='" +
          (isHigh ? "#0a72b8" : "#c89968") + "' stroke='#fff' stroke-width='1.5'/>" +
          "<text x='" + x.toFixed(1) + "' y='" + (isHigh ? y - 10 : y + 16).toFixed(1) +
          "' text-anchor='middle' font-size='11' fill='#0c1a2c'>" +
          (isHigh ? "H " : "L ") + e.value.toFixed(1) + " ft</text>" +
          "<text x='" + x.toFixed(1) + "' y='" + (TL_H - 6) +
          "' text-anchor='middle' font-size='10' fill='#475569'>" + escapeHtml(formatClock(e.time)) + "</text>"
        );
      }).join("");

    // Hour ticks (every 2 hours)
    let ticks = "";
    const tickStartHour = new Date(xMin);
    tickStartHour.setMinutes(0, 0, 0);
    tickStartHour.setHours(tickStartHour.getHours() + 1);
    for (let t = tickStartHour.getTime(); t <= xMax; t += 2 * 60 * 60 * 1000) {
      const x = timeToX(t);
      ticks +=
        "<line x1='" + x.toFixed(1) + "' y1='" + (TL_M.top - 4) + "' x2='" +
        x.toFixed(1) + "' y2='" + (TL_M.top + TL_PLOT_H) + "' stroke='#e2e8f0' stroke-width='1'/>" +
        "<text x='" + x.toFixed(1) + "' y='" + (TL_M.top - 8) +
        "' text-anchor='middle' font-size='10' fill='#94a3b8'>" + escapeHtml(formatClock(new Date(t))) + "</text>";
    }

    // Now marker — only when "now" is within the visible window.
    let nowMarker = "";
    if (nowMs >= xMin && nowMs <= xMax) {
      const nowX = timeToX(nowMs);
      nowMarker =
        "<line x1='" + nowX.toFixed(1) + "' y1='" + TL_M.top + "' x2='" + nowX.toFixed(1) +
        "' y2='" + (TL_M.top + TL_PLOT_H) + "' stroke='#0c1a2c' stroke-width='2' stroke-dasharray='2 2'/>" +
        "<text x='" + nowX.toFixed(1) + "' y='" + (TL_M.top - 8) +
        "' text-anchor='middle' font-size='10' font-weight='700' fill='#0c1a2c'>now</text>";
    }

    // Scrub marker (only if scrubbed)
    let scrubMarker = "";
    if (scrubTime) {
      const sx = timeToX(targetMs);
      scrubMarker =
        "<line x1='" + sx.toFixed(1) + "' y1='" + TL_M.top + "' x2='" + sx.toFixed(1) +
        "' y2='" + (TL_M.top + TL_PLOT_H) + "' stroke='#0a72b8' stroke-width='2.5'/>" +
        "<circle cx='" + sx.toFixed(1) + "' cy='" + heightToY(tideHeightAt(targetMs) || 0).toFixed(1) +
        "' r='7' fill='#0a72b8' stroke='#fff' stroke-width='2'/>";
    }

    // Bands SVG
    const bandsSvg = bands.map((b) =>
      "<rect x='" + timeToX(b.x1).toFixed(1) + "' y='" + TL_M.top +
      "' width='" + (timeToX(b.x2) - timeToX(b.x1)).toFixed(1) +
      "' height='" + TL_PLOT_H + "' fill='" + b.fill +
      "' opacity='" + b.opacity + "'/>" +
      (b.label
        ? "<text x='" + ((timeToX(b.x1) + timeToX(b.x2)) / 2).toFixed(1) +
          "' y='" + (TL_M.top + 12) + "' text-anchor='middle' font-size='10' " +
          "font-weight='700' fill='#7c2d12' opacity='0.55'>" + b.label + "</text>"
        : "")
    ).join("");

    svg.innerHTML =
      "<defs>" +
      "<linearGradient id='tideArea' x1='0' x2='0' y1='0' y2='1'>" +
      "<stop offset='0%' stop-color='#0a72b8' stop-opacity='0.35'/>" +
      "<stop offset='100%' stop-color='#0a72b8' stop-opacity='0.05'/>" +
      "</linearGradient>" +
      "</defs>" +
      bandsSvg +
      ticks +
      "<path d='" + areaD + "' fill='url(#tideArea)'/>" +
      "<path d='" + pathD + "' fill='none' stroke='#0a72b8' stroke-width='2.5' stroke-linejoin='round'/>" +
      markers +
      nowMarker +
      scrubMarker;

    attachTimelineHandlers(svg);
  }

  function attachTimelineHandlers(svg) {
    if (svg.__handlersAttached) return;
    svg.__handlersAttached = true;
    let dragging = false;
    function localX(ev) {
      const rect = svg.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      return (cx / rect.width) * TL_W;
    }
    function applyAt(x) {
      const win = currentTimelineWindow();
      const t = win.xMin + ((x - TL_M.left) / TL_PLOT_W) * (win.xMax - win.xMin);
      const clamped = Math.max(win.xMin, Math.min(win.xMax, t));
      const nowMs = Date.now();
      // On a today-style window, snap to "now" if user taps within 10 min of it.
      if (win.anchor === "today" && Math.abs(clamped - nowMs) < 10 * 60 * 1000) {
        scrubTime = null;
      } else {
        scrubTime = new Date(clamped);
      }
      renderTodayPanel();
    }
    svg.addEventListener("pointerdown", (ev) => {
      dragging = true;
      try { svg.setPointerCapture(ev.pointerId); } catch {}
      applyAt(localX(ev));
      ev.preventDefault();
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!dragging) return;
      applyAt(localX(ev));
    });
    const stop = () => { dragging = false; };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("pointerleave", stop);
    svg.addEventListener("dblclick", () => { scrubTime = null; renderTodayPanel(); });
  }

  // ============================================================
  // Journal — load, render, save
  // ============================================================
  function revokeAllPhotoUrls() {
    journalPhotoUrls.forEach((url) => { try { URL.revokeObjectURL(url); } catch {} });
    journalPhotoUrls.clear();
  }
  function photoUrlFor(entry) {
    if (!entry.photo) return null;
    if (journalPhotoUrls.has(entry.id)) return journalPhotoUrls.get(entry.id);
    const url = URL.createObjectURL(entry.photo);
    journalPhotoUrls.set(entry.id, url);
    return url;
  }

  async function loadJournal() {
    journalEntries = await dbGetAll();
    journalEntries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return journalEntries;
  }

  function journalToGeoJson(entries) {
    return {
      type: "FeatureCollection",
      features: entries
        .filter((e) => e.geometry && e.geometry.coordinates)
        .map((e) => {
          const sp = e.species_id ? speciesById(e.species_id) : null;
          const family = sp ? sp.family : (e.type === "sighting" ? "sighting" : "spot");
          return {
            type: "Feature",
            properties: {
              id: e.id,
              entry_type: e.type,
              family,
              name: sp ? sp.name : (e.name || (e.type === "spot" ? "Spot" : "Entry")),
              length_in: e.length_in || null,
              released: e.released,
              notes: e.notes || "",
              savedAt: e.createdAt,
            },
            geometry: e.geometry,
          };
        }),
    };
  }
  function syncJournalSource() {
    const src = map && map.getSource("journal");
    if (src) src.setData(journalToGeoJson(journalEntries));
  }

  function nearestAccessName(coord) {
    if (!accessFeatures.length) return null;
    let best = null; let bestDist = Infinity;
    for (const f of accessFeatures) {
      if (!f.geometry || f.geometry.type !== "Point") continue;
      const c = f.geometry.coordinates;
      const dx = c[0] - coord[0]; const dy = c[1] - coord[1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best ? best.properties.name : null;
  }

  function renderConditionsChips(c) {
    if (!c) return "";
    const chips = [];
    if (c.tide_stage && c.tide_stage !== "unknown")
      chips.push("<span class='cond-chip'>" + escapeHtml(stageLabel(c.tide_stage)) +
        (c.water_ft != null ? " " + c.water_ft.toFixed(1) + " ft" : "") + "</span>");
    if (c.wind_mph != null) chips.push("<span class='cond-chip'>Wind " + c.wind_mph + " mph</span>");
    if (c.temp_f != null) chips.push("<span class='cond-chip'>" + c.temp_f + "\u00b0F</span>");
    if (c.sky) chips.push("<span class='cond-chip'>" + escapeHtml(c.sky) + "</span>");
    if (c.time_of_day) chips.push("<span class='cond-chip'>" + escapeHtml(timeOfDayLabel(c.time_of_day)) + "</span>");
    return chips.join("");
  }

  // ============================================================
  // Phase 3: Journal stats, discovery deck, achievements, insights
  // ============================================================
  function computeJournalStats(entries) {
    const catches = entries.filter((e) => e.type === "catch");
    const perSpecies = {};
    for (const c of catches) {
      const id = c.species_id || "_unknown";
      if (!perSpecies[id]) perSpecies[id] = { id, count: 0, biggest: null, lastAt: null, released: 0, kept: 0, catches: [] };
      perSpecies[id].count++;
      perSpecies[id].catches.push(c);
      if (c.length_in && (!perSpecies[id].biggest || c.length_in > perSpecies[id].biggest)) {
        perSpecies[id].biggest = c.length_in;
      }
      if (!perSpecies[id].lastAt || (c.createdAt || "") > (perSpecies[id].lastAt || "")) {
        perSpecies[id].lastAt = c.createdAt;
      }
      if (c.released === false) perSpecies[id].kept++; else perSpecies[id].released++;
    }
    const tideStageCounts = {};
    const todCounts = {};
    let releasedTotal = 0;
    let keptTotal = 0;
    for (const c of catches) {
      const cd = c.conditions || {};
      if (cd.tide_stage && cd.tide_stage !== "unknown")
        tideStageCounts[cd.tide_stage] = (tideStageCounts[cd.tide_stage] || 0) + 1;
      if (cd.time_of_day)
        todCounts[cd.time_of_day] = (todCounts[cd.time_of_day] || 0) + 1;
      if (c.released === false) keptTotal++; else releasedTotal++;
    }
    // unique calendar days from all entries (any type) = "trips"
    const dayKey = (iso) => iso ? iso.substring(0, 10) : null;
    const trips = new Set(entries.map((e) => dayKey(e.createdAt)).filter(Boolean));
    // species per day (for "slam" check)
    const dailySpecies = {};
    for (const c of catches) {
      const d = dayKey(c.createdAt);
      if (!d || !c.species_id) continue;
      if (!dailySpecies[d]) dailySpecies[d] = new Set();
      dailySpecies[d].add(c.species_id);
    }
    let maxSpeciesInDay = 0;
    for (const d in dailySpecies) maxSpeciesInDay = Math.max(maxSpeciesInDay, dailySpecies[d].size);

    return {
      totalEntries: entries.length,
      totalCatches: catches.length,
      perSpecies,
      speciesCaught: Object.keys(perSpecies).filter((k) => k !== "_unknown").length,
      speciesTotal: SPECIES.length,
      tideStageCounts,
      todCounts,
      trips: trips.size,
      released: releasedTotal,
      kept: keptTotal,
      maxSpeciesInDay,
    };
  }

  const ACHIEVEMENTS = [
    { id: "first_catch", label: "First catch", description: "Log your first catch.",
      check: (s) => [Math.min(s.totalCatches, 1), 1] },
    { id: "bay_regular", label: "Bay regular", description: "3 trips on the bay.",
      check: (s) => [Math.min(s.trips, 3), 3] },
    { id: "five_fish", label: "Five fish", description: "5 catches logged.",
      check: (s) => [Math.min(s.totalCatches, 5), 5] },
    { id: "variety_pack", label: "Variety pack", description: "Catch 3 different species.",
      check: (s) => [Math.min(s.speciesCaught, 3), 3] },
    { id: "dawn_patrol", label: "Dawn patrol", description: "3 catches at dawn.",
      check: (s) => [Math.min(s.todCounts.dawn || 0, 3), 3] },
    { id: "tide_reader", label: "Tide reader", description: "Catch in all 4 tide stages.",
      check: (s) => {
        const stages = ["incoming", "outgoing", "slack-high", "slack-low"];
        const hit = stages.filter((st) => (s.tideStageCounts[st] || 0) > 0).length;
        return [hit, 4];
      } },
    { id: "slam", label: "Slam", description: "3 species in a single day.",
      check: (s) => [Math.min(s.maxSpeciesInDay, 3), 3] },
    { id: "species_hunter", label: "Species hunter", description: "5 Mission Bay species.",
      check: (s) => [Math.min(s.speciesCaught, 5), 5] },
    { id: "twenty_fish", label: "Twenty fish", description: "20 catches logged.",
      check: (s) => [Math.min(s.totalCatches, 20), 20] },
    { id: "released_ten", label: "Conservation 10", description: "Release 10 fish.",
      check: (s) => [Math.min(s.released, 10), 10] },
    { id: "mb_ten", label: "Mission Bay 10", description: "10 of 12 Mission Bay species.",
      check: (s) => [Math.min(s.speciesCaught, 10), 10] },
    { id: "mb_master", label: "Mission Bay master", description: "All 12 Mission Bay species.",
      check: (s) => [Math.min(s.speciesCaught, 12), 12] },
  ];

  function computeAchievements(stats) {
    return ACHIEVEMENTS.map((a) => {
      const [current, target] = a.check(stats);
      return {
        id: a.id,
        label: a.label,
        description: a.description,
        earned: current >= target,
        current,
        target,
      };
    });
  }

  function renderAchievements(stats) {
    const wrap = $("achievementsWrap");
    if (!wrap) return;
    if (!stats.totalCatches && !stats.totalEntries) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const list = computeAchievements(stats);
    const earnedCount = list.filter((a) => a.earned).length;
    const earnedEl = $("achievementsEarned");
    if (earnedEl) earnedEl.textContent = earnedCount + " / " + list.length;
    const row = $("achievementsList");
    if (!row) return;
    row.innerHTML = list.map((a) => {
      const pct = Math.min(100, Math.round((a.current / a.target) * 100));
      return "<button type='button' class='achv " + (a.earned ? "is-earned" : "is-locked") +
        "' title='" + escapeAttr(a.description) + "'>" +
        "<span class='achv-mark'>" + (a.earned ? "\u2605" : "\u25CB") + "</span>" +
        "<span class='achv-label'>" + escapeHtml(a.label) + "</span>" +
        (a.earned
          ? "<span class='achv-meta'>Earned</span>"
          : "<span class='achv-meta'>" + a.current + " / " + a.target + "</span>") +
        (a.earned ? "" : "<span class='achv-bar'><span style='width:" + pct + "%'></span></span>") +
        "</button>";
    }).join("");
  }

  function renderDiscoveryDeck(stats) {
    const wrap = $("discoveryDeckWrap");
    if (!wrap) return;
    wrap.hidden = false;
    const caughtEl = $("deckCount");
    if (caughtEl) caughtEl.textContent = stats.speciesCaught + " / " + stats.speciesTotal;

    const grid = $("discoveryDeck");
    if (!grid) return;
    const month = new Date().getMonth() + 1;
    // Sort: caught (most-caught first), then uncaught in-season, then uncaught out-of-season
    const ranked = SPECIES.map((sp) => {
      const stat = stats.perSpecies[sp.id];
      const caught = !!stat;
      const inSeason = sp.monthsActive.includes(month);
      return { sp, stat, caught, inSeason };
    }).sort((a, b) => {
      if (a.caught !== b.caught) return a.caught ? -1 : 1;
      if (a.caught && b.caught) return (b.stat.count || 0) - (a.stat.count || 0);
      if (a.inSeason !== b.inSeason) return a.inSeason ? -1 : 1;
      return 0;
    });
    grid.innerHTML = ranked.map(({ sp, stat, caught, inSeason }) => {
      const initialsTxt = initials(sp.name);
      const metaBits = [];
      if (caught) {
        metaBits.push(stat.count + (stat.count === 1 ? " catch" : " catches"));
        if (stat.biggest) metaBits.push("PB " + stat.biggest + " in");
      } else {
        metaBits.push(inSeason ? "In season" : "Off-season");
      }
      const seasonChip = inSeason ? "<span class='deck-flag in-season'>in season</span>" : "";
      const cls = "deck-card" + (caught ? " is-caught" : " is-locked");
      return "<button type='button' class='" + cls + "' data-deck-species='" + escapeAttr(sp.id) + "' title='" + escapeAttr(sp.note) + "'>" +
        "<span class='deck-accent' style='background:" + sp.accent + "'></span>" +
        "<span class='deck-icon' style='--accent:" + sp.accent + "'>" + escapeHtml(initialsTxt) + "</span>" +
        "<span class='deck-name'>" + escapeHtml(sp.name) + "</span>" +
        "<span class='deck-meta'>" + escapeHtml(metaBits.join(" \u00b7 ")) + "</span>" +
        seasonChip +
        "</button>";
    }).join("");
    grid.querySelectorAll("[data-deck-species]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-deck-species");
        flashJournalToSpecies(id);
      });
    });
  }
  function flashJournalToSpecies(speciesId) {
    const ul = $("journalList");
    if (!ul) return;
    let firstMatch = null;
    ul.querySelectorAll(".journal-entry").forEach((li) => li.classList.remove("is-flash"));
    journalEntries.forEach((e, i) => {
      if (e.species_id === speciesId) {
        const li = ul.children[i];
        if (!li) return;
        if (!firstMatch) firstMatch = li;
        li.classList.add("is-flash");
      }
    });
    if (firstMatch) firstMatch.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderInsightsStrip() {
    const wrap = $("insightsStrip");
    if (!wrap) return;
    const stats = computeJournalStats(journalEntries);
    if (stats.totalCatches < 3) { wrap.hidden = true; return; }
    const lines = [];
    lines.push(stats.totalCatches + " catches across " + stats.trips +
      (stats.trips === 1 ? " trip" : " trips") +
      " \u00b7 " + stats.speciesCaught + "/" + stats.speciesTotal + " species");
    const topTide = topKey(stats.tideStageCounts);
    if (topTide) {
      const pct = Math.round((stats.tideStageCounts[topTide] / stats.totalCatches) * 100);
      let line = "Best tide: " + stageLabel(topTide) + " (" + pct + "% of catches).";
      if (topTide === tideStage) line += " Today matches.";
      lines.push(line);
    }
    const topTod = topKey(stats.todCounts);
    if (topTod) {
      const pct = Math.round((stats.todCounts[topTod] / stats.totalCatches) * 100);
      const now = new Date();
      const todNow = timeOfDay(now, sunriseTime, sunsetTime);
      let line = "Best time: " + timeOfDayLabel(topTod) + " (" + pct + "%).";
      if (topTod === todNow) line += " You're in it.";
      lines.push(line);
    }
    wrap.hidden = false;
    wrap.innerHTML =
      "<div class='insights-head'>" +
      "<span class='insights-title'>Your patterns</span>" +
      "<span class='insights-pill'>" + stats.totalCatches + " catches</span>" +
      "</div>" +
      "<ul class='insights-list'>" +
      lines.map((l) => "<li>" + escapeHtml(l) + "</li>").join("") +
      "</ul>";
  }
  function topKey(counts) {
    let best = null; let bestN = 0;
    for (const k in counts) if (counts[k] > bestN) { best = k; bestN = counts[k]; }
    return best;
  }

  // ============================================================
  // Mission Bay Slams (themed multi-species challenges) + Community
  // big-fish board. Slams complement the flat discovery deck —
  // instead of "catch all 12", they bundle 3 specific species
  // (optionally with season/time-of-day constraints) into a named
  // challenge. Community board is a seeded anonymous leaderboard —
  // length + weight + vague zone only, never coordinates.
  // ============================================================
  const SLAMS = [
    {
      id: "inshore_slam",
      label: "Inshore Slam",
      blurb: "The classic Mission Bay trio. Any time, any conditions.",
      accent: "#10b981",
      requirements: [
        { kind: "species", id: "spotted_bay_bass" },
        { kind: "species", id: "california_halibut" },
        { kind: "species", id: "california_corbina" },
      ],
    },
    {
      id: "summer_bite",
      label: "Summer Bite",
      blurb: "Three peak-summer fish — all logged between May and September.",
      accent: "#c89968",
      requirements: [
        { kind: "species", id: "pacific_bonito", monthsAllowed: [5, 6, 7, 8, 9] },
        { kind: "species", id: "california_halibut", monthsAllowed: [5, 6, 7, 8, 9] },
        { kind: "species", id: "spotted_bay_bass", monthsAllowed: [5, 6, 7, 8, 9] },
      ],
    },
    {
      id: "shore_to_channel",
      label: "Shore-to-Channel",
      blurb: "Nearshore croaker, bay bass, and a channel fish — all in a single trip.",
      accent: "#4ba3d6",
      sameDay: true,
      requirements: [
        { kind: "speciesIn", ids: ["yellowfin_croaker", "spotfin_croaker", "california_corbina"], label: "Nearshore" },
        { kind: "speciesIn", ids: ["spotted_bay_bass", "sand_bass"], label: "Bay bass" },
        { kind: "speciesIn", ids: ["california_halibut", "pacific_bonito", "pacific_mackerel"], label: "Channel" },
      ],
    },
    {
      id: "night_bite",
      label: "Night Bite",
      blurb: "Three after-dark species — all logged at dusk or night.",
      accent: "#475569",
      requirements: [
        { kind: "species", id: "smoothhound_shark", todAllowed: ["night", "dusk"] },
        { kind: "species", id: "bat_ray", todAllowed: ["night", "dusk"] },
        { kind: "species", id: "spotfin_croaker", todAllowed: ["night", "dusk"] },
      ],
    },
  ];

  function reqMatches(req, c) {
    const sid = c.species_id;
    const month = c.createdAt ? new Date(c.createdAt).getMonth() + 1 : null;
    const tod = c.conditions && c.conditions.time_of_day;
    if (req.kind === "species" && sid !== req.id) return false;
    if (req.kind === "speciesIn" && !req.ids.includes(sid)) return false;
    if (req.monthsAllowed && month && !req.monthsAllowed.includes(month)) return false;
    if (req.todAllowed && tod && !req.todAllowed.includes(tod)) return false;
    return true;
  }

  function computeSlam(slam, catches) {
    const ymdOf = (iso) => iso ? iso.substring(0, 10) : null;
    if (slam.sameDay) {
      const byDay = {};
      for (const c of catches) {
        const d = ymdOf(c.createdAt);
        if (!d) continue;
        (byDay[d] = byDay[d] || []).push(c);
      }
      const sortedDays = Object.keys(byDay).sort();
      let earnedDay = null; let earnedChecks = null;
      for (const d of sortedDays) {
        const dayCatches = byDay[d];
        const checks = slam.requirements.map((r) => dayCatches.find((c) => reqMatches(r, c)) || null);
        if (checks.every(Boolean)) { earnedDay = d; earnedChecks = checks; break; }
      }
      let bestChecks = slam.requirements.map(() => null);
      if (!earnedDay) {
        let bestN = -1;
        for (const d of sortedDays) {
          const dayCatches = byDay[d];
          const checks = slam.requirements.map((r) => dayCatches.find((c) => reqMatches(r, c)) || null);
          const n = checks.filter(Boolean).length;
          if (n > bestN) { bestN = n; bestChecks = checks; }
        }
      }
      return {
        id: slam.id, label: slam.label, blurb: slam.blurb, accent: slam.accent,
        sameDay: true, requirements: slam.requirements,
        checks: earnedChecks || bestChecks,
        earned: !!earnedDay, earnedAt: earnedDay,
      };
    }
    const sorted = [...catches].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const checks = slam.requirements.map((r) => sorted.find((c) => reqMatches(r, c)) || null);
    const earned = checks.every(Boolean);
    const earnedAt = earned ? checks.map((c) => c.createdAt).sort().slice(-1)[0] : null;
    return {
      id: slam.id, label: slam.label, blurb: slam.blurb, accent: slam.accent,
      sameDay: false, requirements: slam.requirements,
      checks, earned, earnedAt,
    };
  }

  function reqLabel(req) {
    if (req.kind === "species") {
      const sp = speciesById(req.id);
      return sp ? sp.name : req.id;
    }
    if (req.kind === "speciesIn") return req.label || (req.ids.length + " species");
    return "";
  }
  function reqInitials(req) {
    if (req.kind === "species") {
      const sp = speciesById(req.id);
      return sp ? initials(sp.name) : "?";
    }
    if (req.kind === "speciesIn") return (req.label || "?").charAt(0).toUpperCase();
    return "?";
  }
  function reqAccent(req) {
    if (req.kind === "species") {
      const sp = speciesById(req.id);
      return sp ? sp.accent : "#94a3b8";
    }
    if (req.kind === "speciesIn") {
      const first = req.ids[0] ? speciesById(req.ids[0]) : null;
      return first ? first.accent : "#94a3b8";
    }
    return "#94a3b8";
  }
  function humanDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    if (!isFinite(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function renderSlams() {
    const wrap = $("slamsWrap");
    if (!wrap) return;
    // Always show slams (even with zero catches) so users see what's possible.
    wrap.hidden = false;
    const catches = journalEntries.filter((e) => e.type === "catch");
    const slams = SLAMS.map((s) => computeSlam(s, catches));
    const earnedCount = slams.filter((s) => s.earned).length;
    const countEl = $("slamsEarned");
    if (countEl) countEl.textContent = earnedCount + " / " + slams.length;
    const grid = $("slamsList");
    if (!grid) return;
    grid.innerHTML = slams.map((s) => {
      const reqs = s.requirements.map((r, i) => {
        const ok = !!s.checks[i];
        const cls = "slam-req" + (ok ? " is-hit" : "");
        return "<span class='" + cls + "' title='" + escapeAttr(reqLabel(r)) + "' style='--accent:" + reqAccent(r) + "'>" +
          "<span class='slam-req-mark'>" + escapeHtml(reqInitials(r)) + "</span>" +
          "<span class='slam-req-name'>" + escapeHtml(reqLabel(r)) + "</span>" +
          "</span>";
      }).join("");
      const stamp = s.earned
        ? "<span class='slam-stamp'>Earned" + (s.earnedAt ? " \u00b7 " + escapeHtml(humanDate(s.earnedAt)) : "") + "</span>"
        : "<span class='slam-progress'>" + s.checks.filter(Boolean).length + " / " + s.requirements.length + "</span>";
      const dayBadge = s.sameDay ? "<span class='slam-tag'>single trip</span>" : "";
      return "<article class='slam-card " + (s.earned ? "is-earned" : "is-locked") + "' style='--accent:" + s.accent + "'>" +
        "<header class='slam-head'>" +
        "<span class='slam-title'>" + escapeHtml(s.label) + dayBadge + "</span>" +
        stamp +
        "</header>" +
        "<p class='slam-blurb'>" + escapeHtml(s.blurb) + "</p>" +
        "<div class='slam-reqs'>" + reqs + "</div>" +
        "</article>";
    }).join("");
  }

  // ============================================================
  // Community big-fish board (seeded demo data, anonymous handles,
  // zone-only locations — no coordinates).
  // ============================================================
  let communityRecords = [];
  let communitySort = "biggest"; // 'biggest' | 'recent' | 'species'

  async function loadCommunity() {
    const j = await fetchJson("data/community.json").catch(() => null);
    if (!j || !Array.isArray(j.entries)) { communityRecords = []; return; }
    const now = Date.now();
    communityRecords = j.entries.map((e) => ({
      ...e,
      dateMs: now - (Number(e.daysAgo) || 0) * 86400000,
    }));
  }
  function communityTopForSpecies(speciesId) {
    return communityRecords
      .filter((e) => e.species_id === speciesId)
      .sort((a, b) => (b.length_in || 0) - (a.length_in || 0));
  }
  function communityFeatured() {
    const cutoff = Date.now() - 31 * 86400000;
    const recent = communityRecords.filter((e) => e.dateMs >= cutoff);
    const pool = recent.length ? recent : communityRecords;
    return [...pool].sort((a, b) => (b.weight_lb || 0) - (a.weight_lb || 0))[0] || null;
  }
  function relativeDate(ms) {
    const diff = Math.max(0, Date.now() - ms);
    const days = Math.round(diff / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    if (days < 14) return "1 week ago";
    if (days < 31) return Math.round(days / 7) + " weeks ago";
    if (days < 60) return "1 month ago";
    return Math.round(days / 30) + " months ago";
  }
  function communityRow(e, sp) {
    const acc = (sp && sp.accent) || "#94a3b8";
    return "<li class='cb-row' style='--accent:" + acc + "'>" +
      "<span class='cb-row-icon'>" + escapeHtml(sp ? initials(sp.name) : "?") + "</span>" +
      "<div class='cb-row-body'>" +
      "<div class='cb-row-line'>" +
      "<strong class='cb-row-species'>" + escapeHtml(sp ? sp.name : e.species_id) + "</strong> \u00b7 " +
      "<span class='cb-row-size'>" + (e.length_in || "?") + " in" +
      (e.weight_lb ? " \u00b7 " + e.weight_lb + " lb" : "") + "</span>" +
      "</div>" +
      "<div class='cb-row-meta'>" +
      escapeHtml(e.angler) + " \u00b7 " + escapeHtml(e.zone) + " \u00b7 " + escapeHtml(relativeDate(e.dateMs)) +
      (e.released ? " \u00b7 released" : "") +
      "</div>" +
      "</div></li>";
  }
  function renderCommunityBoard() {
    const wrap = $("communityWrap");
    if (!wrap) return;
    if (!communityRecords.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const featuredEl = $("communityFeatured");
    if (featuredEl) {
      const f = communityFeatured();
      if (f) {
        const sp = speciesById(f.species_id);
        featuredEl.innerHTML =
          "<span class='cf-eyebrow'>Big fish this month</span>" +
          "<div class='cf-body'>" +
          "<span class='cf-icon' style='--accent:" + (sp ? sp.accent : "#0a72b8") + "'>" + escapeHtml(initials((sp && sp.name) || "?")) + "</span>" +
          "<div class='cf-text'>" +
          "<div class='cf-line'>" +
          "<strong class='cf-species'>" + escapeHtml(sp ? sp.name : f.species_id) + "</strong> \u00b7 " +
          "<span class='cf-size'>" + (f.length_in || "?") + " in" + (f.weight_lb ? " \u00b7 " + f.weight_lb + " lb" : "") + "</span>" +
          "</div>" +
          "<div class='cf-meta'>" +
          escapeHtml(f.angler) + " \u00b7 " + escapeHtml(f.zone) + " \u00b7 " + escapeHtml(relativeDate(f.dateMs)) +
          "</div>" +
          (f.note ? "<div class='cf-note'>\u201c" + escapeHtml(f.note) + "\u201d</div>" : "") +
          "</div></div>";
      } else {
        featuredEl.innerHTML = "";
      }
    }

    const ctrls = $("communitySort");
    if (ctrls) {
      ctrls.innerHTML = ["biggest", "recent", "species"]
        .map((k) => "<button type='button' class='seg" + (k === communitySort ? " is-active" : "") + "' data-csort='" + k + "'>" +
          (k === "biggest" ? "Biggest" : k === "recent" ? "Recent" : "By species") + "</button>")
        .join("");
      ctrls.querySelectorAll("[data-csort]").forEach((btn) => {
        btn.addEventListener("click", () => {
          communitySort = btn.getAttribute("data-csort");
          renderCommunityBoard();
        });
      });
    }

    const list = $("communityList");
    if (!list) return;
    let html = "";
    if (communitySort === "species") {
      const present = SPECIES.filter((sp) => communityRecords.some((e) => e.species_id === sp.id));
      const stats = computeJournalStats(journalEntries);
      html = present.map((sp) => {
        const top = communityTopForSpecies(sp.id).slice(0, 3);
        const myStat = stats.perSpecies[sp.id];
        const myPb = myStat && myStat.biggest ? myStat.biggest : null;
        const cmpTop = top[0] ? top[0].length_in : null;
        const pbLine = myPb && cmpTop
          ? "<span class='cb-pb'>Your PB " + myPb + " in vs. " + cmpTop + " in here</span>"
          : (myPb
            ? "<span class='cb-pb'>Your PB " + myPb + " in</span>"
            : "<span class='cb-pb is-muted'>No personal record yet</span>");
        const items = top.map((e) => communityRow(e, sp)).join("");
        return "<section class='cb-species'>" +
          "<header class='cb-species-head'>" +
          "<span class='cb-species-icon' style='--accent:" + sp.accent + "'>" + escapeHtml(initials(sp.name)) + "</span>" +
          "<span class='cb-species-name'>" + escapeHtml(sp.name) + "</span>" +
          pbLine +
          "</header>" +
          "<ul class='cb-list'>" + items + "</ul>" +
          "</section>";
      }).join("");
    } else {
      const sorted = [...communityRecords].sort((a, b) =>
        communitySort === "recent"
          ? (b.dateMs - a.dateMs)
          : ((b.length_in || 0) - (a.length_in || 0))
      );
      html = "<ul class='cb-list'>" + sorted.map((e) => communityRow(e, speciesById(e.species_id))).join("") + "</ul>";
    }
    list.innerHTML = html;
  }

  function renderJournalDerivatives() {
    const stats = computeJournalStats(journalEntries);
    renderDiscoveryDeck(stats);
    renderAchievements(stats);
    renderInsightsStrip();
    renderSlams();
    renderCommunityBoard();
  }

  // ============================================================
  // Phase 4: connectivity indicator + service worker
  // ============================================================
  function renderConnectivity() {
    const dot = $("connectivityDot");
    const text = $("connectivityText");
    if (!dot || !text) return;
    let state = isOnline ? "online" : "offline";
    if (isOnline && (tideIsStale || weatherIsStale)) state = "degraded";
    dot.className = "conn-dot conn-" + state;
    text.textContent =
      state === "offline" ? "Offline" :
      state === "degraded" ? "Live data stale" : "Live";
  }
  function setupConnectivityListeners() {
    window.addEventListener("online", () => {
      isOnline = true;
      renderConnectivity();
      refreshTides();
      refreshWeather();
    });
    window.addEventListener("offline", () => {
      isOnline = false;
      renderConnectivity();
    });
  }
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(
        (reg) => {
          console.log("SW registered:", reg.scope);
          // Reload once when a new SW takes control (so the user sees fresh code).
          let refreshing = false;
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
          });
        },
        (err) => console.warn("SW register failed:", err)
      );
    });
  }

  // ============================================================
  // Phase 4: Journal export / import
  // ============================================================
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }
  async function exportJournal() {
    const entries = await dbGetAll();
    const serialized = [];
    for (const e of entries) {
      const out = Object.assign({}, e);
      if (e.photo instanceof Blob) {
        try { out.photoDataUrl = await blobToDataUrl(e.photo); } catch {}
      }
      delete out.photo;
      serialized.push(out);
    }
    const payload = {
      kind: "fiesta-island-journal",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: serialized,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fiesta-journal-" + new Date().toISOString().substring(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  async function importJournalFile(file) {
    if (!file) return { ok: false, message: "No file selected" };
    let text;
    try { text = await file.text(); }
    catch (e) { return { ok: false, message: "Couldn't read file" }; }
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, message: "Not valid JSON" }; }
    if (!parsed || parsed.kind !== "fiesta-island-journal" || !Array.isArray(parsed.entries)) {
      return { ok: false, message: "Not a Fiesta Island journal file" };
    }
    let added = 0; let skipped = 0;
    const existing = await dbGetAll();
    const existingIds = new Set(existing.map((e) => e.id));
    for (const raw of parsed.entries) {
      if (!raw || !raw.id) { skipped++; continue; }
      if (existingIds.has(raw.id)) { skipped++; continue; }
      const out = Object.assign({}, raw);
      if (out.photoDataUrl) {
        try { out.photo = await dataUrlToBlob(out.photoDataUrl); } catch {}
      }
      delete out.photoDataUrl;
      await dbPut(out);
      added++;
    }
    return { ok: true, added, skipped };
  }

  function renderJournalList() {
    revokeAllPhotoUrls();
    const ul = $("journalList");
    const counter = $("journalCount");
    if (counter) counter.textContent = String(journalEntries.length);
    if (!ul) return;
    ul.innerHTML = "";
    if (!journalEntries.length) {
      ul.innerHTML =
        "<li class='journal-empty muted'>" +
        "No entries yet. Tap <strong>Add to journal</strong> above, then tap the map where you fished, paddled, or stopped." +
        "</li>";
      return;
    }
    for (const e of journalEntries) {
      const sp = e.species_id ? speciesById(e.species_id) : null;
      const li = document.createElement("li");
      li.className = "journal-entry";
      const accent = sp ? sp.accent : (e.type === "sighting" ? "#14b8a6" : "#ec4899");
      const photo = photoUrlFor(e);
      const photoHtml = photo
        ? "<img class='journal-photo' src='" + escapeAttr(photo) + "' alt='Catch photo'>"
        : "<div class='journal-photo placeholder' style='--accent:" + accent + "'>" +
            (sp ? escapeHtml(initials(sp.name)) : (e.type === "sighting" ? "\u2731" : "\u2691")) +
          "</div>";
      const title = sp ? sp.name : (e.name || (e.type === "spot" ? "Spot" : "Entry"));
      const dimensions = [];
      if (e.length_in) dimensions.push(e.length_in + " in");
      if (e.weight_lb) dimensions.push(e.weight_lb + " lb");
      const dimStr = dimensions.length ? " \u00b7 " + dimensions.join(" \u00b7 ") : "";
      const outcome = e.type === "catch"
        ? (e.released === false ? "Kept" : "Released")
        : "";
      const locName = e.location_name ? " \u00b7 " + escapeHtml(e.location_name) : "";
      const conds = renderConditionsChips(e.conditions);
      const dateStr = e.createdAt
        ? new Date(e.createdAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "";

      li.innerHTML =
        photoHtml +
        "<div class='journal-body'>" +
        "<div class='journal-row'>" +
        "<strong style='color:" + accent + "'>" + escapeHtml(title) + "</strong>" +
        "<span class='journal-date'>" + escapeHtml(dateStr) + "</span>" +
        "</div>" +
        "<div class='journal-meta'>" +
        (outcome ? "<span>" + outcome + "</span>" : "") +
        (dimStr ? "<span>" + escapeHtml(dimStr.replace(/^\s\u00b7\s/, "")) + "</span>" : "") +
        (e.location_name ? "<span>" + escapeHtml(e.location_name) + "</span>" : "") +
        "</div>" +
        (conds ? "<div class='journal-conds'>" + conds + "</div>" : "") +
        (e.notes ? "<p class='journal-notes'>" + escapeHtml(e.notes) + "</p>" : "") +
        "<div class='journal-actions'>" +
        "<button type='button' class='btn btn-ghost' data-j-fly='" + escapeAttr(e.id) + "'>Show on map</button>" +
        "<button type='button' class='btn btn-ghost' data-j-del='" + escapeAttr(e.id) + "'>Remove</button>" +
        "</div>" +
        "</div>";
      ul.appendChild(li);
    }
    ul.querySelectorAll("[data-j-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-j-del");
        if (!confirm("Remove this entry?")) return;
        await dbDelete(id);
        await loadJournal();
        renderJournalList();
        renderJournalDerivatives();
        syncJournalSource();
      });
    });
    ul.querySelectorAll("[data-j-fly]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-j-fly");
        const e = journalEntries.find((x) => x.id === id);
        if (e && e.geometry) {
          flyToCoord(e.geometry.coordinates);
          switchToTab("map");
        }
      });
    });
  }
  function initials(name) {
    return String(name).split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
  }

  // ============================================================
  // Journal form
  // ============================================================
  function entryFormFor(typeKey) {
    document.querySelectorAll("[data-show-for]").forEach((el) => {
      const types = el.getAttribute("data-show-for").split(",");
      el.hidden = !types.includes(typeKey);
    });
  }
  function setEntryType(typeKey) {
    document.querySelectorAll("[data-entry-type]").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-entry-type") === typeKey);
    });
    entryFormFor(typeKey);
  }
  function getEntryType() {
    const a = document.querySelector("[data-entry-type].is-active");
    return a ? a.getAttribute("data-entry-type") : "catch";
  }
  function setReleased(val) {
    pendingReleased = !!val;
    document.querySelectorAll("[data-released]").forEach((b) => {
      b.classList.toggle("is-active", String(val) === b.getAttribute("data-released"));
    });
  }

  function renderSpeciesPicker() {
    const grid = $("speciesGrid");
    if (!grid) return;
    grid.innerHTML = SPECIES.map((s) => {
      const active = s.id === pendingSpeciesId;
      return "<button type='button' class='species-card" + (active ? " is-active" : "") +
        "' data-species-id='" + escapeAttr(s.id) + "'>" +
        "<span class='species-accent' style='background:" + s.accent + "'></span>" +
        "<span class='species-name'>" + escapeHtml(s.name) + "</span>" +
        "<span class='species-meta'>" + escapeHtml(seasonLabel(s)) + " \u00b7 " + escapeHtml(s.legal || "") + "</span>" +
        "<span class='species-note'>" + escapeHtml(s.note) + "</span>" +
        "</button>";
    }).join("");
    grid.querySelectorAll(".species-card").forEach((card) => {
      card.addEventListener("click", () => {
        pendingSpeciesId = card.getAttribute("data-species-id");
        renderSpeciesPicker();
        updateSpeciesCurrent();
      });
    });
  }
  function seasonLabel(s) {
    if (!s.monthsPeak || !s.monthsPeak.length) return "";
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const sorted = s.monthsPeak.slice().sort((a, b) => a - b);
    if (sorted.length === 1) return "Peak " + months[sorted[0] - 1];
    const contiguous = sorted.every((m, i) => i === 0 || m === sorted[i - 1] + 1);
    if (contiguous) return "Peak " + months[sorted[0] - 1] + "\u2013" + months[sorted[sorted.length - 1] - 1];
    return "Peak " + sorted.map((m) => months[m - 1]).join(", ");
  }
  function updateSpeciesCurrent() {
    const el = $("jSpeciesCurrent");
    if (!el) return;
    if (pendingSpeciesId) {
      const sp = speciesById(pendingSpeciesId);
      el.innerHTML = sp
        ? "<span class='species-pick-label'><span class='species-accent' style='background:" + sp.accent +
          "'></span>" + escapeHtml(sp.name) + "</span>" +
          "<button type='button' class='btn btn-ghost' id='jSpeciesToggle'>Change</button>"
        : "<span class='muted'>No species picked</span>";
    } else {
      el.innerHTML =
        "<span class='muted'>No species picked yet</span>" +
        "<button type='button' class='btn btn-primary' id='jSpeciesToggle'>Pick species</button>";
    }
    const toggle = $("jSpeciesToggle");
    if (toggle) toggle.addEventListener("click", () => {
      const grid = $("speciesGrid");
      grid.hidden = !grid.hidden;
      if (!grid.hidden) renderSpeciesPicker();
    });
  }

  function openJournalFormAt(lngLat) {
    pendingLngLat = lngLat;
    pendingSpeciesId = null;
    pendingReleased = true;
    setEntryType("catch");
    setReleased(true);
    $("journalForm").hidden = false;
    $("jPhoto").value = "";
    $("jLength").value = "";
    $("jWeight").value = "";
    $("jBait").value = "";
    $("jName").value = "";
    $("jNotes").value = "";
    const grid = $("speciesGrid");
    if (grid) grid.hidden = true;
    updateSpeciesCurrent();

    const locName = nearestAccessName([lngLat.lng, lngLat.lat]);
    const locEl = $("jLocation");
    if (locEl) {
      locEl.innerHTML = "Location: <strong>" +
        lngLat.lat.toFixed(5) + ", " + lngLat.lng.toFixed(5) + "</strong>" +
        (locName ? " (near " + escapeHtml(locName) + ")" : "");
    }
    const cEl = $("jConditions");
    if (cEl) {
      const c = snapshotConditions();
      cEl.innerHTML = "Snapshot at save: " + (renderConditionsChips(c) || "<span class='muted'>loading\u2026</span>");
    }
    switchToTab("waypoints");
    const formEl = document.getElementById("journalForm");
    if (formEl && typeof formEl.scrollIntoView === "function") {
      formEl.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }
  function closeJournalForm() {
    pendingLngLat = null;
    $("journalForm").hidden = true;
  }

  async function saveJournalEntry() {
    if (!pendingLngLat) {
      alert("Tap the map to set a location first.");
      return;
    }
    const type = getEntryType();
    let photoBlob = null;
    const f = $("jPhoto").files && $("jPhoto").files[0];
    if (f) {
      try { photoBlob = await downscaleImage(f, PHOTO_MAX_DIM, PHOTO_JPEG_QUALITY); }
      catch (e) { alert("Couldn't read photo: " + (e.message || e)); return; }
    }
    const coord = [pendingLngLat.lng, pendingLngLat.lat];
    const entry = {
      id: type + "_" + uuid(),
      type,
      createdAt: new Date().toISOString(),
      geometry: { type: "Point", coordinates: coord },
      location_name: nearestAccessName(coord) || null,
      name: $("jName").value.trim() || null,
      notes: $("jNotes").value.trim() || "",
      conditions: snapshotConditions(),
      photo: photoBlob,
    };
    if (type === "catch") {
      entry.species_id = pendingSpeciesId || null;
      const len = Number($("jLength").value);
      const wt = Number($("jWeight").value);
      entry.length_in = Number.isFinite(len) && len > 0 ? len : null;
      entry.weight_lb = Number.isFinite(wt) && wt > 0 ? wt : null;
      entry.released = pendingReleased;
      entry.bait = $("jBait").value.trim() || null;
    }
    await dbPut(entry);
    setPickerMode(false);
    closeJournalForm();
    await loadJournal();
    renderJournalList();
    renderJournalDerivatives();
    syncJournalSource();
    flashAchievementsForSave(entry);
  }
  function flashAchievementsForSave(entry) {
    // Surface newly-earned achievements AND slams as a quick banner.
    if (entry.type !== "catch") return;
    const allCatches = journalEntries.filter((e) => e.type === "catch");
    const beforeCatches = allCatches.filter((e) => e.id !== entry.id);
    const beforeEntries = journalEntries.filter((e) => e.id !== entry.id);
    const stats = computeJournalStats(journalEntries);
    const beforeStats = computeJournalStats(beforeEntries);
    const nowAch = computeAchievements(stats).filter((a) => a.earned).map((a) => a.id);
    const wasAch = computeAchievements(beforeStats).filter((a) => a.earned).map((a) => a.id);
    const newAch = nowAch.filter((id) => !wasAch.includes(id));
    const nowSlams = SLAMS.map((s) => computeSlam(s, allCatches)).filter((s) => s.earned).map((s) => s.id);
    const wasSlams = SLAMS.map((s) => computeSlam(s, beforeCatches)).filter((s) => s.earned).map((s) => s.id);
    const newSlams = nowSlams.filter((id) => !wasSlams.includes(id));
    const items = [
      ...newSlams.map((id) => "Slam: " + (SLAMS.find((s) => s.id === id) || {}).label),
      ...newAch.map((id) => (ACHIEVEMENTS.find((a) => a.id === id) || {}).label),
    ].filter(Boolean);
    if (!items.length) return;
    const banner = $("achievementsBanner");
    if (banner) {
      banner.textContent = "Unlocked! " + items.join(" \u00b7 ");
      banner.classList.remove("is-hidden");
      window.setTimeout(() => banner.classList.add("is-hidden"), 6000);
    }
  }

  // ============================================================
  // Map init
  // ============================================================
  function initMap(data) {
    map = new maplibregl.Map({
      container: "map",
      style: MAP_STYLE,
      center: [PLACE_LON, PLACE_LAT],
      zoom: 14,
      attributionControl: true,
    });

    let usedFallback = false;
    map.on("error", (ev) => {
      const err = ev && ev.error;
      const msg = err && err.message ? err.message : "";
      // If the style itself failed, swap to the raster fallback once.
      if (!usedFallback && (msg.indexOf("style") >= 0 || (err && err.status >= 400))) {
        usedFallback = true;
        console.warn("Map style failed, falling back to OSM raster:", msg);
        map.setStyle(FALLBACK_STYLE);
      } else {
        console.warn("Map error:", msg || ev);
      }
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
    });
    map.addControl(geolocate, "top-left");

    const addAppLayers = () => {
      map.addSource("park", { type: "geojson", data: data.park });
      map.addSource("zones", { type: "geojson", data: data.zones });
      map.addSource("shore", { type: "geojson", data: data.shore });
      map.addSource("hazards", { type: "geojson", data: data.hazards });
      map.addSource("access", { type: "geojson", data: data.access });
      map.addSource("pois", { type: "geojson", data: data.pois });
      // Phase 8: habitat heat map.
      map.addSource("bathy-grid", { type: "geojson",
        data: bathyGeoJson || { type: "FeatureCollection", features: [] } });
      map.addSource("eelgrass", { type: "geojson",
        data: data.eelgrass || { type: "FeatureCollection", features: [] } });
      map.addSource("best-spot", { type: "geojson",
        data: { type: "FeatureCollection", features: [] } });
      map.addSource("journal", { type: "geojson", data: journalToGeoJson(journalEntries) });
      // Non-water mask: a MultiPolygon covering every non-bay area in view
      // (surrounding mainland + the island). Generated from the bathy grid by
      // scripts/build_water_mask.js. Used to clip the heatmap to water-only.
      map.addSource("non-water-mask", { type: "geojson",
        data: data.nonWaterMask || { type: "FeatureCollection", features: [] } });

      // ====================================================================
      // Layer order matters: MapLibre draws in the order layers are added.
      //
      // Water-area visuals (eelgrass + heatmap) are drawn FIRST. The heatmap's
      // Gaussian radius will inevitably blur past the shoreline — that's
      // expected and is what gives the heat its smooth field. We then draw the
      // land-fill polygon ON TOP, which acts as a hard mask: any heatmap or
      // eelgrass pixels that bled onto the island are occluded by the sand
      // fill. The shoreline is drawn last so it always reads as a crisp edge.
      // ====================================================================

      // Eelgrass habitat hint, drawn below the heat so the heat dominates.
      map.addLayer({
        id: "eelgrass-fill", type: "fill", source: "eelgrass",
        paint: {
          "fill-color": "#10b981",
          "fill-opacity": 0.10,
          "fill-outline-color": "#047857",
        },
      });
      // Continuous species-aware heat field over the bathymetric grid.
      map.addLayer({
        id: "habitat-heat", type: "heatmap", source: "bathy-grid",
        paint: {
          // Drive heat directly from the per-cell weight we compute each
          // render. weight_norm is 0..1 normalized to the current window's max.
          "heatmap-weight": ["coalesce", ["get", "weight_norm"], 0],
          // Intensity scales with zoom so the gradient stays readable as the
          // user zooms in close to a single spot.
          "heatmap-intensity": [
            "interpolate", ["linear"], ["zoom"],
            10, 1.0,
            14, 2.0,
            17, 3.2,
          ],
          // Radius tightened so heat stays close to its grid cell. The land
          // mask above clips any residual bleed past the bay's shoreline, but
          // a smaller radius means less bleed to clip in the first place.
          "heatmap-radius": [
            "interpolate", ["linear"], ["zoom"],
            10, 3,
            13, 7,
            15, 12,
            17, 20,
          ],
          // Cool blue (low) -> green (mid) -> orange (high) -> red (peak).
          // Low-density start pushed higher and made fully transparent so the
          // heat doesn't spread a wide blue "floor" across the bay — only
          // meaningful scores produce visible color.
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0,    "rgba(15, 76, 117, 0)",
            0.20, "rgba(15, 76, 117, 0)",
            0.32, "rgba(56, 161, 198, 0.35)",
            0.48, "rgba(125, 197, 154, 0.60)",
            0.62, "rgba(253, 219, 130, 0.80)",
            0.78, "rgba(245, 158, 66, 0.92)",
            0.92, "rgba(220, 60, 60, 0.96)",
          ],
          "heatmap-opacity": [
            "interpolate", ["linear"], ["zoom"],
            10, 0.55,
            14, 0.70,
            17, 0.55,
          ],
        },
      });

      // Non-water mask: sand-tone fill over EVERY non-bay area in view
      // (surrounding mainland + the island). Drawn at near-full opacity so
      // it fully occludes any heatmap bleed past the bay's shoreline.
      map.addLayer({
        id: "non-water-fill", type: "fill", source: "non-water-mask",
        paint: { "fill-color": "#e8dcb8", "fill-opacity": 0.94 },
      });
      // Island land mask: redundant with non-water-fill (the island is
      // already covered there) but kept as a precise OSM-park-polygon-aligned
      // overlay so the on-island visuals key off the same source.
      map.addLayer({ id: "park-fill", type: "fill", source: "park",
        paint: { "fill-color": "#e8dcb8", "fill-opacity": 0.94 } });
      // Activity zones (dogs, paddle, boat, etc.) sit on top of the land.
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: {
          "fill-color": [
            "match", ["get", "activity"],
            "dogs", "#f59e0b", "paddle", "#10b981", "boat", "#0a72b8",
            "swim", "#a855f7", "no-wake", "#7c3aed", "#4ba3d6"
          ],
          "fill-opacity": 0.18,
          "fill-outline-color": "#0c1a2c",
        },
      });

      // Soft sand-tone inner glow on the LAND side of the shoreline — this
      // sells the edge without introducing a wide blue halo that reads as
      // heatmap bleed. Color stays in the sand family regardless of tide so
      // the eye never confuses it with water.
      map.addLayer({
        id: "shore-line-glow", type: "line", source: "shore",
        paint: {
          "line-color": "#c9b687",
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 5, 18, 8],
          "line-opacity": 0.55, "line-blur": 1,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "shore-line", type: "line", source: "shore",
        paint: {
          "line-color": shoreColorForTide(),
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 3.5, 18, 5.5],
          "line-opacity": 1.0,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "hazards-layer", type: "circle", source: "hazards",
        paint: { "circle-radius": 7, "circle-color": "#f59e0b",
          "circle-stroke-width": 2, "circle-stroke-color": "#1a1204" },
      });
      map.addLayer({
        id: "access-layer", type: "circle", source: "access",
        paint: {
          "circle-radius": 8,
          "circle-color": [
            "match", ["get", "activity"],
            "dogs", "#f59e0b", "paddle", "#10b981", "boat", "#0a72b8",
            "bike", "#7c3aed", "#0a72b8"
          ],
          "circle-stroke-width": 2, "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "pois-layer", type: "circle", source: "pois",
        paint: { "circle-radius": 5, "circle-color": "#14b8a6",
          "circle-stroke-width": 1.5, "circle-stroke-color": "#ffffff" },
      });
      // Phase 8: "Best spot" pin. Two stacked circles for a pulsing-pin look.
      map.addLayer({
        id: "best-spot-halo", type: "circle", source: "best-spot",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 14, 14, 24, 17, 40],
          "circle-color": "#ef4444",
          "circle-opacity": 0.18,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ef4444",
          "circle-stroke-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "best-spot-dot", type: "circle", source: "best-spot",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 17, 12],
          "circle-color": "#ef4444",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "journal-layer", type: "circle", source: "journal",
        paint: {
          "circle-radius": 9,
          "circle-color": [
            "match", ["get", "family"],
            "bass", "#10b981",
            "halibut", "#c89968",
            "croaker", "#4ba3d6",
            "sargo", "#7c3aed",
            "surfperch", "#ec4899",
            "tuna", "#0a72b8",
            "shark", "#64748b",
            "ray", "#a16207",
            "sighting", "#14b8a6",
            "#ec4899"
          ],
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      const bounds = new maplibregl.LngLatBounds();
      (data.shore.features || []).forEach((f) => extendBoundsWithGeometry(bounds, f.geometry));
      try { map.fitBounds(bounds, { padding: 60, maxZoom: 15.5 }); } catch {}
      applyLayerVisibility();
      // Score every cell and push initial heatmap weights.
      const now = new Date();
      const sun = sunForDate(now);
      refreshHeatmap(now, tideStageAtTime(now.getTime()), timeOfDay(now, sun.sunrise, sun.sunset));
    };
    wireMapInteractions();
    map.on("load", addAppLayers);
    // After a style swap (e.g. fallback), re-add our sources/layers.
    map.on("styledata", () => {
      if (map.isStyleLoaded() && !map.getSource("shore")) addAppLayers();
    });
  }
  function wireMapInteractions() {
    const layers = [
      ["access-layer", "name"], ["hazards-layer", "name"],
      ["pois-layer", "name"], ["zones-fill", "name"],
      ["park-fill", "name"], ["journal-layer", "name"],
    ];
    map.on("click", (e) => {
      if (pickerMode) {
        openJournalFormAt(e.lngLat);
        setPickerMode(false);
        return;
      }
      const feats = map.queryRenderedFeatures(e.point, { layers: layers.map((l) => l[0]) });
      if (feats.length) {
        const f = feats[0];
        const titleKey = (layers.find((l) => l[0] === f.layer.id) || [null, "name"])[1];
        new maplibregl.Popup({ maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setHTML(popupHtml(f.properties || {}, titleKey))
          .addTo(map);
        return;
      }
      // Phase 8: tap on empty water -> show nearest heatmap cell info
      // (depth, distance to shore/eelgrass, top species for current window).
      if (!bathyCells.length) return;
      let bi = -1, bd = Infinity;
      const clickLon = e.lngLat.lng, clickLat = e.lngLat.lat;
      for (let i = 0; i < bathyCells.length; i++) {
        const c = bathyCells[i];
        const d = (c.lon - clickLon) * (c.lon - clickLon) + (c.lat - clickLat) * (c.lat - clickLat);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi < 0) return;
      const cell = bathyCells[bi];
      // 0.0005 deg ~ 55 m; ignore clicks more than ~150 m from a grid cell.
      if (bd > 0.0015 * 0.0015) return;
      const target = scrubTime || new Date();
      const sun = sunForDate(target);
      const tod = timeOfDay(target, sun.sunrise, sun.sunset);
      const stage = tideStageAtTime(target.getTime());
      const month = target.getMonth() + 1;
      const top = topSpeciesForCell(cell, stage, tod, month, 3);
      const topRows = top.length
        ? top.map((r) =>
            "<dt>" + escapeHtml(r.sp.name) + "</dt>" +
            "<dd>" + Math.round(100 * r.score / (top[0].score || 1)) + "%</dd>"
          ).join("")
        : "<dt>—</dt><dd>No matching species this window</dd>";
      const html =
        "<strong>Spot detail</strong>" +
        "<dl class='pop-dl'>" +
          "<dt>Depth</dt><dd>" + cell.depth_ft.toFixed(1) + " ft (" + cell.bottom_class + ")</dd>" +
          "<dt>To shore</dt><dd>" + cell.dist_shore_m + " m</dd>" +
          "<dt>To eelgrass</dt><dd>" +
            (cell.dist_eelgrass_m === 0 ? "in bed" : cell.dist_eelgrass_m + " m") + "</dd>" +
          "<dt><em>Best for this window</em></dt><dd></dd>" +
          topRows +
        "</dl>";
      new maplibregl.Popup({ maxWidth: "280px" })
        .setLngLat([cell.lon, cell.lat])
        .setHTML(html)
        .addTo(map);
    });
    ["access-layer", "hazards-layer", "pois-layer", "journal-layer"].forEach((id) => {
      map.on("mouseenter", id, () => {
        map.getCanvas().style.cursor = pickerMode ? "crosshair" : "pointer";
      });
      map.on("mouseleave", id, () => {
        map.getCanvas().style.cursor = pickerMode ? "crosshair" : "";
      });
    });
  }

  function setPickerMode(on) {
    pickerMode = !!on;
    const btn = $("toggleJournalMode");
    if (btn) {
      btn.classList.toggle("is-active", pickerMode);
      btn.textContent = pickerMode ? "Cancel" : "Add to journal";
    }
    const banner = $("journalBanner");
    if (banner) {
      if (pickerMode) {
        banner.textContent = "Tap the map where the catch / spot happened. Conditions will save automatically.";
        banner.classList.remove("is-hidden");
      } else {
        banner.classList.add("is-hidden");
      }
    }
    if (map) map.getCanvas().style.cursor = pickerMode ? "crosshair" : "";
    if (pickerMode && window.matchMedia("(max-width: 800px)").matches) {
      // on mobile, slide the sheet down a bit so the map is reachable
      document.body.classList.add("picker-mode");
    } else {
      document.body.classList.remove("picker-mode");
    }
    // Tell MapLibre the container resized so the canvas refits to the new sheet height.
    if (map && typeof map.resize === "function") {
      window.setTimeout(() => map.resize(), 260);
    }
  }

  // ============================================================
  // UI wiring
  // ============================================================
  function wireUi() {
    els.zoneFilters = $("zoneFilters");

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        const name = tab.getAttribute("data-tab");
        document.querySelectorAll(".tab-panel").forEach((p) => {
          const on = p.getAttribute("data-panel") === name;
          p.classList.toggle("is-active", on);
          p.hidden = !on;
        });
        // On mobile: expand the sheet whenever the user taps a tab, so the
        // map-first landing experience gracefully reveals the data on demand.
        if (window.matchMedia("(max-width: 800px)").matches &&
            document.body.classList.contains("sheet-min")) {
          document.body.classList.remove("sheet-min");
          localStorage.setItem("bitecast.sheetMin", "0");
          const h = document.getElementById("sheetHandle");
          if (h) h.setAttribute("aria-expanded", "true");
          if (map && typeof map.resize === "function") {
            window.setTimeout(() => map.resize(), 260);
          }
        }
      });
    });

    ["filterJournal", "filterTideColor", "filterHeatmap", "filterEelgrass", "simpleMapView"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", () => applyLayerVisibility());
    });
    if (els.zoneFilters) els.zoneFilters.addEventListener("change", () => applyLayerVisibility());

    $("fieldMode").addEventListener("change", (e) => {
      document.body.classList.toggle("field-mode", e.target.checked);
    });
    $("whereAmI").addEventListener("click", () => { if (geolocate) geolocate.trigger(); });

    $("activitySelect").addEventListener("change", (e) => {
      selectedActivity = e.target.value || "fishing";
      renderTodayPanel();
    });
    // Journal type segmenter
    document.querySelectorAll("[data-entry-type]").forEach((b) => {
      b.addEventListener("click", () => setEntryType(b.getAttribute("data-entry-type")));
    });
    document.querySelectorAll("[data-released]").forEach((b) => {
      b.addEventListener("click", () => setReleased(b.getAttribute("data-released") === "true"));
    });

    $("toggleJournalMode").addEventListener("click", () => setPickerMode(!pickerMode));

    // Bottom-sheet sizing on mobile.
    //
    // Default landing experience on mobile: map is the hero (full viewport
    // behind a thin tab strip). The sheet expands when the user taps a tab
    // or the handle. Choice persists per device once they interact.
    const sheetHandle = $("sheetHandle");
    const isMobile = window.matchMedia("(max-width: 800px)").matches;
    const SHEET_MIN_KEY = "bitecast.sheetMin";
    const stored = localStorage.getItem(SHEET_MIN_KEY);
    const startMin = isMobile && (stored === null || stored === "1");
    if (startMin) document.body.classList.add("sheet-min");
    if (sheetHandle) {
      sheetHandle.setAttribute("aria-expanded", startMin ? "false" : "true");
      sheetHandle.addEventListener("click", () => {
        const isMin = document.body.classList.toggle("sheet-min");
        localStorage.setItem(SHEET_MIN_KEY, isMin ? "1" : "0");
        sheetHandle.setAttribute("aria-expanded", isMin ? "false" : "true");
        if (map && typeof map.resize === "function") {
          window.setTimeout(() => map.resize(), 260);
        }
      });
    }
    $("jSave").addEventListener("click", saveJournalEntry);
    $("jCancel").addEventListener("click", () => {
      closeJournalForm();
      setPickerMode(false);
    });

    // Export / Import (Phase 4)
    const exportBtn = $("exportJournalBtn");
    if (exportBtn) exportBtn.addEventListener("click", () => {
      exportJournal().catch((e) => alert("Export failed: " + (e.message || e)));
    });
    const importBtn = $("importJournalBtn");
    const importInput = $("importJournalFile");
    if (importBtn && importInput) {
      importBtn.addEventListener("click", () => importInput.click());
      importInput.addEventListener("change", async () => {
        const file = importInput.files && importInput.files[0];
        importInput.value = "";
        if (!file) return;
        const res = await importJournalFile(file);
        if (!res.ok) { alert("Import failed: " + res.message); return; }
        await loadJournal();
        renderJournalList();
        renderJournalDerivatives();
        syncJournalSource();
        alert("Imported " + res.added + " entries (" + res.skipped + " skipped as duplicates).");
      });
    }

    updateSpeciesCurrent();
  }

  // ============================================================
  // Boot
  // ============================================================
  async function boot() {
    wireUi();
    setupConnectivityListeners();
    registerServiceWorker();
    try { await migrateLegacyWaypoints(); } catch (e) { console.warn("legacy migration skipped:", e); }
    await loadJournal();
    const data = await loadGeo();
    await loadCommunity();
    buildZoneFilters();
    initMap(data);
    renderJournalList();
    renderJournalDerivatives();
    renderConnectivity();
    refreshTides();
    refreshWeather();
    renderTodayPanel();
    window.setInterval(refreshTides, 6 * 60 * 1000);
    window.setInterval(refreshWeather, 15 * 60 * 1000);
    window.setInterval(() => {
      renderTodayPanel();
      renderInsightsStrip();
      renderConnectivity();
    }, 60 * 1000);
  }
  function showBootError(err) {
    console.error("boot error:", err);
    let banner = document.getElementById("bootError");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "bootError";
      banner.style.cssText =
        "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;" +
        "background:#fee2e2;color:#7f1d1d;border:1px solid #dc2626;" +
        "border-radius:10px;padding:10px 14px;font-family:system-ui;font-size:13px;" +
        "box-shadow:0 8px 24px rgba(0,0,0,0.15);";
      document.body.appendChild(banner);
    }
    banner.textContent = "Startup error: " + (err && err.message ? err.message : String(err));
  }
  boot().catch(showBootError);
})();
