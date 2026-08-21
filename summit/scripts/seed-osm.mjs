#!/usr/bin/env node
/**
 * Seed Summit's locations and trail network from OpenStreetMap.
 *
 * Why OSM rather than hand-typed coordinates: a badge has to sit on something
 * that exists. A coordinate someone eyeballed off a map lands 40 m into a
 * reservoir, and the dwell check then rejects every honest claim. OSM gives a
 * surveyed point, a name, and a stable id to trace it back to.
 *
 * Four fetches, in order:
 *
 *   1. Overpass, for candidate places inside Singapore's actual admin boundary.
 *      A bounding box is not good enough: it reaches into Johor, and the first
 *      test run duly returned "Legoland Malaysia Signboard".
 *   2. Overpass, for island extents, so the Islands set is decided by geography
 *      rather than by guessing from a name.
 *   3. A DEM, for terrain elevation. Drives difficulty and the weak elevation
 *      check in claim_location().
 *   4. Overpass, for the path network near those places. This is what makes the
 *      trail-coverage anti-spoof check possible.
 *
 * Output is SQL, not direct inserts. A seed you can read, diff, and re-run is
 * worth more than one that already happened invisibly.
 *
 *   node scripts/seed-osm.mjs --dry-run          # summary to stderr, no SQL
 *   node scripts/seed-osm.mjs --out ../supabase/seed
 */

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OPENTOPO = 'https://api.opentopodata.org/v1/srtm30m';
const OPEN_ELEVATION = 'https://api.open-elevation.com/api/v1/lookup';

const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = argValue('--out') ?? '../supabase/seed';

/** Must exceed the 1.5 km approach scope in track_trail_coverage(). */
const FOOTWAY_RADIUS_M = 2000;

/** Same coupling for building footprints, used by the clipping check. */
const BUILDING_RADIUS_M = 2000;

/**
 * Douglas-Peucker tolerance for trail geometry, in degrees (~2.5 m).
 *
 * OSM digitises a curved path with far more vertices than a 25 m proximity test
 * can distinguish. Simplifying roughly halves the seed file and changes no
 * answer the coverage check is capable of giving.
 */
const SIMPLIFY_TOLERANCE_DEG = 0.000022;

/** Rows per INSERT. One statement with 80k VALUES rows is not loadable. */
const INSERT_CHUNK = 500;

/* -------------------------------------------------------------------------- */
/* What counts as a place                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Each rule maps an OSM tag to a Summit set and a base rarity.
 *
 * `named: true` drops unnamed features. An unnamed viewpoint cannot carry a
 * badge reading "LOCATION; PIONEER #0047", and Singapore's data has plenty:
 * 9 of the first 20 viewpoints returned in testing had no name at all.
 */
const RULES = [
  { q: 'node["natural"="peak"]',            set: 'rainforest', rarity: 'epic',   named: true },
  { q: 'node["tourism"="viewpoint"]',       set: 'urban',      rarity: 'rare',   named: true },
  { q: 'node["natural"="waterfall"]',       set: 'rainforest', rarity: 'epic',   named: true },
  { q: 'node["historic"="fort"]',           set: 'heritage',   rarity: 'rare',   named: true },
  { q: 'way["historic"="fort"]',            set: 'heritage',   rarity: 'rare',   named: true },
  { q: 'node["historic"="memorial"]',       set: 'heritage',   rarity: 'common', named: true },
  { q: 'way["historic"="ruins"]',           set: 'heritage',   rarity: 'epic',   named: true },
  { q: 'way["leisure"="nature_reserve"]',   set: 'rainforest', rarity: 'rare',   named: true },
  { q: 'node["man_made"="lighthouse"]',     set: 'coastal',    rarity: 'legendary', named: true },
  { q: 'way["natural"="beach"]',            set: 'coastal',    rarity: 'common', named: true },
  { q: 'node["natural"="cape"]',            set: 'coastal',    rarity: 'rare',   named: true },
  { q: 'way["landuse"="reservoir"]',        set: 'reservoir',  rarity: 'rare',   named: true },
  { q: 'way["natural"="water"]["water"="reservoir"]', set: 'reservoir', rarity: 'rare', named: true },
  { q: 'node["man_made"="tower"]["tower:type"="observation"]', set: 'rainforest', rarity: 'epic', named: true },
];

/**
 * Which islands form the Islands set.
 *
 * An allowlist, not "everything tagged place=island", for two reasons. OSM tags
 * the mainland itself as place=island ("Singapore Island", relation 1769123),
 * which would sweep all 163 places into a single set. And it tags Sungei Buloh
 * Wetland Reserve as an island although it sits on the mainland coast.
 *
 * The curatorial reason matters more. The Islands set means islands you can
 * actually go to. Jurong Island is a petrochemical complex with no public
 * access and Pulau Tekong is a live military training area, so neither is
 * somewhere to send a person holding a badge to collect.
 */
const ISLAND_NAMES = [
  'Sentosa',
  'Pulau Ubin',
  'Coney Island',
  'Pulau Brani',
  'Lazarus Island',
  "St John's Island",
  'Kusu Island',
  "Sisters' Islands",
  'Pulau Hantu',
  'Pulau Semakau',
];

let ISLAND_KEYS_UNUSED_MARKER = null;

/**
 * Places a real person cannot legally walk to, found by hand after the first
 * seed run put badges on Pulau Tekong, the Pulau Sudong/Pawai/Senang live-firing
 * islands, the Sarimbun/Murai/Pasir Laba training area, Jurong Port, and DSO
 * National Laboratories.
 *
 * The comment on ISLAND_NAMES above already says Tekong should never appear —
 * but that allowlist only decides which places join the Islands *set*, not
 * whether a place is a candidate at all, so a peak or cape rule elsewhere in
 * RULES still picked "Botak Hill" straight off the training island. This list,
 * and restrictedPlaceKeys() below, are the actual exclusion.
 *
 * Keyed by `${osm_type}/${osm_id}`, matching Place.key, so a name change in
 * OSM doesn't silently let one back in.
 */
const EXCLUDED_OSM_KEYS = new Set([
  'node/9794258967',   // ~Marina Hill — DSO National Laboratories
  'node/11406975879',  // Bajau Hill — Pasir Laba training area
  'node/11677800855',  // Botak Hill — Pulau Tekong
  'node/11406991393',  // Bukit Kelapa Tujoh Pokok — Pulau Senang
  'node/11406991392',  // Bukit Pak Bekang — Pulau Senang
  'node/11406991394',  // Bukit Prigi Kling — Pulau Senang
  'node/11673402534',  // Elephant Hill — Pasir Laba training area
  'node/11673402533',  // FOFO Hill — Pasir Laba training area
  'node/11406991404',  // P. Biola — Pulau Sudong/Pawai/Senang cluster
  'node/11406991391',  // P. Salu — Western Islands, no public access
  'node/4502051446',   // Peng Kang Hill — Pasir Laba training area
  'node/10589201769',  // Pulau Chichir — Jurong Port
  'node/11673402532',  // Rambutan Hill — Pasir Laba training area
  'node/6722078985',   // Route 2 - closed 2019 — Lim Chu Kang live-firing area
  'node/11673353763',  // Sarimbun — Murai/Ama Keng training area
  'node/1499839383',   // Sarimbun Landing Memorial — Lim Chu Kang training area
  'way/20423973',      // Sarimbun Reservoir — Murai training area
  'node/10312594905',  // Tanjong Batu Balok — Pulau Senang
  'node/10312600915',  // Tanjong Batu Koyok — Pulau Tekong
  'node/10312594906',  // Tanjong Berhala Kuda — Pulau Pawai
  'node/10307757289',  // Tanjong Chenting — Pasir Laba training area
  'node/10307757283',  // Tanjong Gedong — Murai training area
  'node/10312594907',  // Tanjong Genting — Pulau Pawai
  'node/11407015356',  // Tanjong Hokian — Pulau Tekong
  'node/1133036384',   // Tanjong Pasir — Pulau Tekong
  'node/6494626408',   // Tanjong Pasir Laba — Pasir Laba Camp
  'node/10312600918',  // Tanjong Renggam — Pulau Tekong
  'node/10307757288',  // Tanjong Skopek — Murai Urban Training Facility
]);

/* -------------------------------------------------------------------------- */
/* Overpass                                                                   */
/* -------------------------------------------------------------------------- */

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    // Overpass answers 406 to a request with no User-Agent, which is how it
    // turns away anonymous scripts. Identify the tool.
    headers: {
      'Content-Type': 'text/plain',
      'User-Agent': 'summit-seed/1.0 (hackathon build; OSM data via Overpass)',
    },
    body: query,
  });

  if (!res.ok) {
    // 429 and 504 are Overpass saying "busy", not a bug in the query. The
    // documented remedy is to wait and try again.
    throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  return res.json();
}

/** Candidate places, clipped to Singapore's admin boundary. */
async function fetchPlaces() {
  const body = RULES.map((r) => `  ${r.q}(area.sg);`).join('\n');
  const data = await overpass(`[out:json][timeout:180];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(
${body}
);
out center tags;`);

  return data.elements ?? [];
}

/**
 * Which of our candidate places sit on an allowlisted island.
 *
 * Overpass `area` filters are a true point-in-polygon test against the island's
 * real geometry, so this replaces an earlier bounding-box approximation. The
 * bbox was wrong in principle and would have drifted: Sentosa's box spans open
 * water and a strip of mainland, and any future place seeded there would have
 * been mislabelled with no way to notice.
 *
 * Matching `islet` as well as `island` is what picks up Lazarus, Kusu and
 * St John's, which the island-only query missed entirely (5 of 10 allowlisted
 * islands were found before adding it).
 *
 * Returns a Set of "type/id" keys, matching Place.key.
 */
async function fetchIslandKeys() {
  const areas = ISLAND_NAMES.map(
    (n) => `  area["place"~"^(island|islet)$"]["name"=${JSON.stringify(n)}];`,
  ).join('\n');
  const body = RULES.map((r) => `  ${r.q}(area.isl);`).join('\n');

  const data = await overpass(`[out:json][timeout:180];
(
${areas}
)->.isl;
(
${body}
);
out ids;`);

  return new Set((data.elements ?? []).map((e) => `${e.type}/${e.id}`));
}

let ISLAND_KEYS = new Set();

/**
 * Areas a walk should never pass through.
 *
 * This is the environmental-clipping check: a real person walks around a
 * building and along the shore of a reservoir. A synthesised track drawn
 * between two coordinates goes straight through both, because it has no idea
 * they are there.
 *
 * Three sources, scoped by how many there are:
 *
 *   water        1,589 nationwide. Cheap, take all of it.
 *   restricted   96 nationwide (military, private land). Cheap.
 *   buildings    124,660 nationwide, so scoped to BUILDING_RADIUS_M of a
 *                seeded place, exactly like footways.
 *
 * Closed ways only. Multipolygon relations (234 of the water features) are
 * skipped rather than ring-assembled, which loses some large reservoirs.
 * Recorded here because it means water coverage is partial, and a check built
 * on it must not treat "not inside known water" as proof of anything.
 */
async function fetchNoGoAreas(places) {
  const around = places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');

  const data = await overpass(`[out:json][timeout:300];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(
  way(area.sg)["natural"="water"];
  way(area.sg)["landuse"="reservoir"];
  way(area.sg)["military"];
  way(area.sg)["landuse"="military"];
  way(around:${BUILDING_RADIUS_M},${around})["building"];
);
out geom;`);

  return (data.elements ?? [])
    .filter((e) => {
      const g = e.geometry;
      // A polygon needs a closed ring. Overpass returns open ways too.
      if (!g || g.length < 4) return false;
      const a = g[0];
      const b = g[g.length - 1];
      return a.lat === b.lat && a.lon === b.lon;
    })
    .map((e) => ({
      id: e.id,
      kind: e.tags?.building
        ? 'building'
        : e.tags?.military || e.tags?.landuse === 'military'
          ? 'restricted'
          : 'water',
      name: e.tags?.name ?? null,
      geometry: e.geometry,
    }));
}

/**
 * The path network near the seeded places.
 *
 * Split by highway type on purpose. path/track/steps are trails and there are
 * few enough to take nationwide. footway/pedestrian/cycleway run to tens of
 * thousands in Singapore, so those are fetched only near a seeded place.
 *
 * FOOTWAY_RADIUS_M is coupled to track_trail_coverage() in migration 0002,
 * which scores only the final 1.5 km of an approach. This radius must stay
 * larger than that scope, or the check judges honest walkers against reference
 * data that was never downloaded. Change one, change the other.
 */
async function fetchTrails(places) {
  const around = places.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');

  const data = await overpass(`[out:json][timeout:300];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(
  way(area.sg)["highway"~"^(path|track|steps|bridleway)$"];
  way(around:${FOOTWAY_RADIUS_M},${around})["highway"~"^(footway|pedestrian|cycleway)$"];
);
out geom;`);

  return (data.elements ?? []).filter((e) => e.type === 'way' && (e.geometry?.length ?? 0) >= 2);
}

/**
 * Which highway tags count as a "natural" trail versus a paved one, for
 * difficultyFor()'s terrain axis below. Mirrors the split fetchTrails() above
 * already makes between the two Overpass sub-queries.
 */
const NATURAL_HIGHWAYS = new Set(['path', 'track', 'steps', 'bridleway']);
const PAVED_HIGHWAYS = new Set(['footway', 'pedestrian', 'cycleway']);

/**
 * Local metres-per-degree at a given latitude. A flat-earth approximation,
 * fine at Singapore's scale (a few km across, all within 1.1-1.5°N) and far
 * cheaper than a proper geodesic for the thousands of point-to-way checks
 * difficultyFor() below does.
 */
function metersPerDegree(latDeg) {
  const latRad = (latDeg * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad),
    lng: 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad),
  };
}

/** Shortest distance, in metres, from a point to one segment of a polyline. */
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance, in metres, from a point to an Overpass way's geometry. */
function distanceToWayM(lat, lng, geometry) {
  const { lat: mLat, lng: mLng } = metersPerDegree(lat);
  const toXY = (pt) => [(pt.lon - lng) * mLng, (pt.lat - lat) * mLat];

  if (geometry.length === 1) {
    const [x, y] = toXY(geometry[0]);
    return Math.hypot(x, y);
  }

  let min = Infinity;
  for (let i = 0; i < geometry.length - 1; i++) {
    const [ax, ay] = toXY(geometry[i]);
    const [bx, by] = toXY(geometry[i + 1]);
    min = Math.min(min, pointToSegmentDistance(0, 0, ax, ay, bx, by));
  }
  return min;
}

/**
 * Nearest way among `trails` whose highway tag is in `kinds`, within `maxM`.
 * Bounding-box precheck first: a place's difficulty is scored against every
 * trail fetched near every place, so this is the difference between one seed
 * run finishing in seconds versus minutes once the network is a few thousand
 * ways.
 */
function nearestTrail(lat, lng, trails, kinds, maxM) {
  const { lat: mLat, lng: mLng } = metersPerDegree(lat);
  const maxLatDeg = maxM / mLat;
  const maxLngDeg = maxM / mLng;

  let best = null;
  for (const t of trails) {
    if (!kinds.has(t.tags?.highway)) continue;

    const g = t.geometry;
    let minLat = g[0].lat, maxLat = g[0].lat, minLon = g[0].lon, maxLon = g[0].lon;
    for (const p of g) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    if (lat < minLat - maxLatDeg || lat > maxLat + maxLatDeg) continue;
    if (lng < minLon - maxLngDeg || lng > maxLon + maxLngDeg) continue;

    const d = distanceToWayM(lat, lng, g);
    if (d <= maxM && (!best || d < best.distanceM)) best = { distanceM: d, highway: t.tags.highway };
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* Elevation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Terrain height for each place.
 *
 * OpenTopoData first: it names its dataset in the response, so the number is
 * traceable, and it takes 100 points per request. It rate-limits to one call a
 * second, hence the pause. Open-Elevation is the fallback, the same SRTM data
 * without the provenance.
 *
 * Both return a SURFACE model. Over rainforest that is canopy height, not
 * ground: Bukit Timah comes back at 179 m against an official summit of
 * 163.6 m. Nothing downstream should treat these as survey-grade, and the
 * tolerance band in claim_location() is sized for exactly this error.
 */
async function fetchElevations(points) {
  const out = new Map();
  const batches = [...chunk(points, 100)];

  for (const [i, batch] of batches.entries()) {
    const locs = batch.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
    let done = false;

    try {
      const res = await fetch(`${OPENTOPO}?locations=${locs}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'OK') {
          data.results.forEach((r, j) => {
            if (r.elevation !== null) out.set(batch[j].key, { m: r.elevation, source: r.dataset });
          });
          done = true;
        }
      }
    } catch (error) {
      warn(`opentopodata batch ${i} failed: ${error.message}`);
    }

    if (!done) {
      try {
        const res = await fetch(`${OPEN_ELEVATION}?locations=${locs}`);
        const data = await res.json();
        data.results.forEach((r, j) => {
          if (r.elevation !== null) out.set(batch[j].key, { m: r.elevation, source: 'open-elevation' });
        });
      } catch (error) {
        warn(`open-elevation batch ${i} failed too: ${error.message}`);
      }
    }

    await sleep(1100); // OpenTopoData's published limit is 1 call/second.
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Shaping                                                                    */
/* -------------------------------------------------------------------------- */

function toPlace(element, rule) {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (lat == null || lng == null) return null;

  const name = element.tags?.name;
  if (rule.named && !name) return null;

  return {
    osmType: element.type,
    osmId: element.id,
    name,
    lat,
    lng,
    set: ISLAND_KEYS.has(`${element.type}/${element.id}`) ? 'islands' : rule.set,
    rarity: rule.rarity,
    key: `${element.type}/${element.id}`,
  };
}

/**
 * Difficulty, 1 to 4. Still a first pass to be hand-tuned before the demo,
 * but a multi-factor one now rather than elevation read off a single band.
 *
 * Adapted from three trail-difficulty methodologies that all score a route on
 * several independent axes instead of elevation alone: mountainfyi.com's
 * calculator (distance/gain/altitude/terrain, weighted), trekntrails.com's
 * Effort Index (physical demand, technical challenge, altitude stress,
 * endurance, remoteness), and the SAC T1-T6 scale that get.whympr.com
 * summarises (trail visibility and surface, not just steepness).
 *
 * None of their axes transfer to Singapore untouched. Altitude stress in the
 * first two starts at 2,000-3,000 m; SAC's T3 and up require exposure, ropes,
 * scree, glaciers. Singapore's whole relief is 0-164 m and every seeded place
 * sits on a marked, unroped path, so nothing here leaves SAC's T1/T2 band and
 * altitude is a non-factor worth scoring. What does still vary, and maps onto
 * their remaining axes:
 *
 *   physical demand (40%)  elevation_m over Singapore's 0-164 m range.
 *                           mountainfyi's and trekntrails' gain axis.
 *   gradient        (35%)  elevation_m per metre from the nearest paved
 *                           footway, i.e. how steep the final stretch in is:
 *                           the same climb reached by a short stair reads
 *                           harder than one reached by a long gentle path.
 *                           Stands in for mountainfyi's distance axis, which
 *                           has no real "trailhead" to measure from here.
 *   terrain         (25%)  surface of the nearest trail. steps and unpaved
 *                           track/path score higher than a paved footway,
 *                           the same distinction SAC draws between T1 and T2
 *                           and mountainfyi scores as terrain type.
 *
 * Weighted sum, 0 to 1, cut into quartiles for difficulty 1 to 4.
 */
const TERRAIN_SCORE = {
  steps: 1,
  track: 0.8,
  path: 0.65,
  bridleway: 0.55,
  footway: 0.25,
  pedestrian: 0.15,
  cycleway: 0.1,
};

/** No trail found within FOOTWAY_RADIUS_M at all: neither easy nor hard, just unknown. */
const TERRAIN_SCORE_UNKNOWN = 0.35;

/** Metres climbed per metre walked capped here; above this the gradient axis is already maxed. */
const GRADIENT_CAP = 0.5;

const clamp01 = (x) => Math.max(0, Math.min(1, x));

function difficultyFor(place, trails) {
  const elevationM = place.elevationM ?? 0;
  const natural = nearestTrail(place.lat, place.lng, trails, NATURAL_HIGHWAYS, FOOTWAY_RADIUS_M);
  const paved = nearestTrail(place.lat, place.lng, trails, PAVED_HIGHWAYS, FOOTWAY_RADIUS_M);

  const nearest = natural ?? paved;
  const terrain = nearest ? (TERRAIN_SCORE[nearest.highway] ?? TERRAIN_SCORE_UNKNOWN) : TERRAIN_SCORE_UNKNOWN;

  // Distance from the nearest paved access point, floored so a place that sits
  // right on a footway doesn't divide by a near-zero number.
  const approachM = Math.max(paved?.distanceM ?? natural?.distanceM ?? 200, 15);
  const gradient = clamp01(elevationM / approachM / GRADIENT_CAP);
  const physicalDemand = clamp01(elevationM / 164);

  const score = 0.4 * physicalDemand + 0.35 * gradient + 0.25 * terrain;

  let difficulty = score >= 0.75 ? 4 : score >= 0.5 ? 3 : score >= 0.25 ? 2 : 1;
  // Dense, uneven jungle floor is harder going than flat pavement even at low
  // elevation, the same floor the old elevation-only version applied.
  if (place.set === 'rainforest') difficulty = Math.max(difficulty, 2);

  return { difficulty, score };
}

/** Drop near-duplicates: OSM often carries both a node and a way for one place. */
function dedupe(places) {
  const kept = [];
  for (const p of places) {
    if (!kept.some((k) => haversine(k.lat, k.lng, p.lat, p.lng) < 120)) kept.push(p);
  }
  return kept;
}

function slugify(name, taken) {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24) || 'place';

  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}${n++}`;
  taken.add(slug);
  return slug;
}

/** Douglas-Peucker, on raw lat/lng degrees. Fine at this scale and tolerance. */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;

  let maxDist = 0;
  let index = 0;
  const [first] = pts;
  const last = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicular(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist <= tol) return [first, last];

  return [
    ...simplify(pts.slice(0, index + 1), tol).slice(0, -1),
    ...simplify(pts.slice(index), tol),
  ];
}

function perpendicular(p, a, b) {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat);
  const t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy);
  const cx = a.lon + Math.max(0, Math.min(1, t)) * dx;
  const cy = a.lat + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p.lon - cx, p.lat - cy);
}

/* -------------------------------------------------------------------------- */
/* SQL                                                                        */
/* -------------------------------------------------------------------------- */

const SETS = [
  ['rainforest', 'Rainforest',     '#35604A'],
  ['reservoir',  'Reservoir Ring', '#46707F'],
  ['coastal',    'Coastal',        '#C7A15A'],
  ['heritage',   'Heritage',       '#4A4740'],
  ['urban',      'Rail & City',    '#6E7B88'],
  ['islands',    'Islands',        '#7A9E4F'],
];

const HEADER = `-- Generated by scripts/seed-osm.mjs. Regenerate rather than hand-edit.
-- Place and path data (c) OpenStreetMap contributors, ODbL.
-- Elevation from SRTM 30 m via OpenTopoData.
`;

/**
 * Opens every seed file's transaction.
 *
 * \`set local\`, inside the transaction, rather than a session-level SET above
 * it. Supabase's direct connection is IPv6-only on the free tier, so many
 * networks can only reach the transaction pooler, where consecutive statements
 * may land on different backends and a session SET would evaporate. One
 * transaction pins the file to one backend and \`set local\` scopes the path to
 * it. PostGIS lives in the \`extensions\` schema on Supabase, so without the
 * path every st_* call here fails.
 */
const TXN_OPEN = 'begin;\nset local search_path = public, extensions;';

function emitLocations(places) {
  const out = [HEADER, '', TXN_OPEN, ''];

  out.push("insert into cities (name, country, centre)");
  out.push("values ('Singapore', 'SG', st_point(103.8198, 1.3521)::geography)");
  out.push('on conflict (name) do nothing;', '');

  out.push('insert into location_sets (city_id, key, name, colour, sort_order) values');
  out.push(
    SETS.map(([k, n, c], i) =>
      `  ((select id from cities where name = 'Singapore'), ${q(k)}, ${q(n)}, ${q(c)}, ${i})`,
    ).join(',\n') + '\non conflict (city_id, key) do nothing;',
    '',
  );

  for (const batch of chunk(places, INSERT_CHUNK)) {
    out.push('insert into locations');
    out.push('  (city_id, set_id, slug, name, geom, rarity, difficulty,');
    out.push('   elevation_m, elevation_source, osm_type, osm_id)');
    out.push('values');
    out.push(
      batch
        .map(
          (l) =>
            `  ((select id from cities where name = 'Singapore'),` +
            ` (select id from location_sets where key = ${q(l.set)}),` +
            ` ${q(l.slug)}, ${q(l.name)},` +
            ` st_point(${l.lng.toFixed(7)}, ${l.lat.toFixed(7)})::geography,` +
            ` ${q(l.rarity)}, ${l.difficulty},` +
            ` ${l.elevationM ?? 'null'}, ${l.elevationSource ? q(l.elevationSource) : 'null'},` +
            ` ${q(l.osmType)}, ${l.osmId})`,
        )
        .join(',\n'),
    );
    out.push('on conflict (slug) do nothing;', '');
  }

  out.push('commit;');
  return out.join('\n') + '\n';
}

function emitTrails(trails) {
  const out = [HEADER, '', TXN_OPEN, ''];

  for (const batch of chunk(trails, INSERT_CHUNK)) {
    out.push('insert into trails (osm_id, city_id, name, highway, geom) values');
    out.push(
      batch
        .map((t) => {
          const coords = t.geometry.map((g) => `${g.lon.toFixed(6)} ${g.lat.toFixed(6)}`).join(',');
          return (
            `  (${t.id}, (select id from cities where name = 'Singapore'),` +
            ` ${t.tags?.name ? q(t.tags.name) : 'null'}, ${q(t.tags.highway)},` +
            ` st_geogfromtext('SRID=4326;LINESTRING(${coords})'))`
          );
        })
        .join(',\n'),
    );
    out.push('on conflict (osm_id) do nothing;', '');
  }

  out.push('commit;');
  return out.join('\n') + '\n';
}

function emitNoGo(areas) {
  const out = [HEADER, '', TXN_OPEN, ''];

  for (const batch of chunk(areas, INSERT_CHUNK)) {
    out.push('insert into no_go_areas (osm_id, kind, name, geom) values');
    out.push(
      batch
        .map((a) => {
          const ring = a.geometry.map((g) => `${g.lon.toFixed(6)} ${g.lat.toFixed(6)}`).join(',');
          // ST_MakeValid because OSM contains self-intersecting rings, and one
          // bad polygon would otherwise abort the whole transaction.
          return `  (${a.id}, ${q(a.kind)}, ${a.name ? q(a.name) : 'null'},` +
            ` st_makevalid(st_geomfromtext('POLYGON((${ring}))', 4326)))`;
        })
        .join(',\n'),
    );
    out.push('on conflict (osm_id) do nothing;', '');
  }

  out.push('commit;');
  return out.join('\n') + '\n';
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/* -------------------------------------------------------------------------- */

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

/**
 * Re-derive which rule produced an element. Overpass does not label results by
 * the sub-query that matched, so the rule's tag test is applied again here.
 */
function matches(el, rule) {
  const m = rule.q.match(/^(node|way|relation)((?:\["[^"]+"(?:=|~)"[^"]+"\])+)$/);
  if (!m || m[1] !== el.type) return false;

  return [...m[2].matchAll(/\["([^"]+)"(=|~)"([^"]+)"\]/g)].every(([, k, op, v]) =>
    op === '=' ? el.tags?.[k] === v : new RegExp(v).test(el.tags?.[k] ?? ''),
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = (m) => process.stderr.write(`  ! ${m}\n`);
const step = (m) => process.stderr.write(`${m}\n`);

/* -------------------------------------------------------------------------- */

async function main() {
  step('1/6  Overpass: which places sit on an island');
  ISLAND_KEYS = await fetchIslandKeys();
  step(`     ${ISLAND_KEYS.size} features inside allowlisted islands`);

  step('2/6  Overpass: candidate places inside the Singapore boundary');
  const raw = await fetchPlaces();
  const matched = [];
  for (const el of raw) {
    const rule = RULES.find((r) => matches(el, r));
    const place = rule ? toPlace(el, rule) : null;
    if (place && !EXCLUDED_OSM_KEYS.has(place.key)) matched.push(place);
  }
  const places = dedupe(matched);
  step(`     ${raw.length} returned, ${matched.length} named and usable, ${places.length} after dedupe`);

  step('3/6  Elevation from SRTM 30 m');
  const elevations = await fetchElevations(places);
  const taken = new Set();
  for (const l of places) {
    const e = elevations.get(l.key);
    l.elevationM = e?.m ?? null;
    l.elevationSource = e?.source ?? null;
    l.slug = slugify(l.name, taken);
  }
  step(`     ${elevations.size}/${places.length} resolved`);

  step('4/6  Overpass: path network near those places');
  let trails = [];
  try {
    trails = await fetchTrails(places);
    const before = trails.reduce((n, t) => n + t.geometry.length, 0);
    for (const t of trails) t.geometry = simplify(t.geometry, SIMPLIFY_TOLERANCE_DEG);
    const after = trails.reduce((n, t) => n + t.geometry.length, 0);
    step(`     ${trails.length} ways, ${before} vertices simplified to ${after}`);
  } catch (error) {
    warn(`trail fetch failed, seeding without it: ${error.message}`);
    warn('  track_trail_coverage() returns null with no trails, so claims still pass.');
  }

  // Difficulty needs the trail network (its gradient and terrain axes), so
  // this runs after fetchTrails() rather than alongside elevation above. It
  // still degrades gracefully if that fetch failed: nearestTrail() over an
  // empty array just returns null for every place, which difficultyFor()
  // reads as "unknown terrain" rather than crashing.
  for (const l of places) {
    const { difficulty, score } = difficultyFor(l, trails);
    l.difficulty = difficulty;
    l.difficultyScore = score;
  }

  step('5/6  Overpass: buildings, water and restricted land');
  let noGo = [];
  try {
    noGo = await fetchNoGoAreas(places);
    const byKind = noGo.reduce((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {});
    step(`     ${noGo.length} closed rings ${JSON.stringify(byKind)}`);
  } catch (error) {
    warn(`no-go fetch failed, seeding without it: ${error.message}`);
  }

  const bySet = places.reduce((acc, l) => ({ ...acc, [l.set]: (acc[l.set] ?? 0) + 1 }), {});
  step(`6/6  ${JSON.stringify(bySet)}`);

  if (DRY_RUN) {
    for (const l of places.slice(0, 20)) {
      step(
        `     ${l.name} | ${l.set} | ${l.rarity} | d${l.difficulty} (${l.difficultyScore.toFixed(2)}) | ${l.elevationM ?? '?'} m`,
      );
    }
    return;
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/0001_singapore_locations.sql`, emitLocations(places));
  step(`     wrote ${OUT_DIR}/0001_singapore_locations.sql`);
  if (trails.length) {
    await writeFile(`${OUT_DIR}/0002_singapore_trails.sql`, emitTrails(trails));
    step(`     wrote ${OUT_DIR}/0002_singapore_trails.sql`);
  }
  if (noGo.length) {
    await writeFile(`${OUT_DIR}/0003_singapore_no_go.sql`, emitNoGo(noGo));
    step(`     wrote ${OUT_DIR}/0003_singapore_no_go.sql`);
  }
}

main().catch((error) => {
  process.stderr.write(`\nfailed: ${error.message}\n`);
  process.exit(1);
});
