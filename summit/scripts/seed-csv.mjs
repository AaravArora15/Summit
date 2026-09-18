#!/usr/bin/env node
/**
 * Seed Summit's locations from treks_and_hikes.csv, replacing the OSM/
 * Singapore seed from seed-osm.mjs.
 *
 * The CSV (repo root) lists ~1,000 named treks and summits worldwide but
 * carries no coordinates, so each row is geocoded through Nominatim before it
 * can become a `locations` row (geom is not-null geography). A row that fails
 * to geocode is skipped and logged, never inserted with a guessed point — the
 * same principle seed-osm.mjs states for hand-typed coordinates: a wrong point
 * silently breaks the honest-arrival check downstream.
 *
 * There is no OSM trail network or no-go geometry for these: they are
 * scattered across every continent, not one small bounding box a handful of
 * Overpass queries can cover. track_trail_coverage() already degrades to null
 * with no trail data on record (see seed-osm.mjs), so claims still succeed,
 * just unverified by trail coverage. That is accepted here, not a bug.
 *
 * Every row lands in one city ("World"), so the app's single-city assumptions
 * (home screen, explore map centring, the profile's home_city_id) keep working
 * unmodified. locations_near()'s 5-20 km radius against real device GPS is
 * left as-is per instruction: Explore stays a genuine "what's near me" query,
 * which for scattered global treks will mostly return nothing, and that is a
 * deliberate, known trade rather than an oversight.
 *
 *   node scripts/seed-csv.mjs --dry-run
 *   node scripts/seed-csv.mjs --out ../supabase/seed
 *
 * Geocoding results are cached to scripts/.geocode-cache.json so a re-run
 * (after fixing a bug in this script) does not re-hit Nominatim for rows
 * already resolved.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CSV_PATH = argValue('--csv') ?? path.join(__dirname, '..', '..', 'treks_and_hikes.csv');
const CACHE_PATH = path.join(__dirname, '.geocode-cache.json');
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OPENTOPO = 'https://api.opentopodata.org/v1/srtm30m';
const OPEN_ELEVATION = 'https://api.open-elevation.com/api/v1/lookup';

const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = argValue('--out') ?? '../supabase/seed';

/** Nominatim's published limit is 1 request/second. */
const GEOCODE_DELAY_MS = 1100;

/** Rows per INSERT, same reasoning as seed-osm.mjs: one huge VALUES list won't load. */
const INSERT_CHUNK = 500;

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

/** RFC4180-ish parser: quoted fields, embedded commas, escaped "" quotes. */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function loadRows() {
  const text = await readFile(CSV_PATH, 'utf8');
  const rows = parseCSV(text);
  const header = rows[0];
  return rows.slice(1)
    .filter((r) => r.length === header.length && r[0])
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/* -------------------------------------------------------------------------- */
/* Type -> Summit set. 19 raw CSV Type strings collapse to 7 sets so the app's */
/* fixed 4-glyph badge system (ridge/tree/fort/drop, see SET_GLYPH in         */
/* src/lib/queries.ts) stays legible instead of one set per raw string.       */
/* -------------------------------------------------------------------------- */

const TYPE_TO_SET = {
  Summit: 'summit', Mountain: 'summit', Volcano: 'summit', 'Ski Touring': 'summit',
  'Ice Trek': 'summit',
  Trail: 'trail', 'Park Trail': 'trail', 'Day hike': 'trail', 'Day Hike': 'trail',
  Cultural: 'trail',
  'Multi-day': 'expedition', 'Coastal Multi-day': 'expedition',
  'Canyon Multi-day': 'expedition', 'Park Multi-day': 'expedition',
  'Ski Touring Multi-day': 'expedition',
  Coastal: 'coastal',
  Canyon: 'canyon', Desert: 'canyon',
  Park: 'park',
  'Urban Trail': 'urban',
};

const SETS = [
  ['summit',     'Summits & Volcanoes', '#4A4740'],
  ['trail',      'Trails',              '#35604A'],
  ['expedition', 'Expeditions',         '#6E7B88'],
  ['coastal',    'Coastal',             '#C7A15A'],
  ['canyon',     'Canyon & Desert',     '#B5651D'],
  ['park',       'Parks',               '#46707F'],
  ['urban',      'Urban Trails',        '#7A9E4F'],
];

const DIFFICULTY_TO_LEVEL = {
  Easy: 1, 'Easy-Moderate': 2, Moderate: 2, Strenuous: 3, 'Very Strenuous': 4,
};

const LEVEL_TO_RARITY = { 1: 'common', 2: 'rare', 3: 'epic', 4: 'legendary' };

/* -------------------------------------------------------------------------- */
/* Geocoding                                                                  */
/* -------------------------------------------------------------------------- */

async function loadCache() {
  try {
    return JSON.parse(await readFile(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 1));
}

/**
 * The part of Notes before the first colon is usually the specific park or
 * range the row belongs to ("Yosemite National Park: Iconic cable ascent..."),
 * a much better geocoding anchor than the bare trek name alone.
 */
function notesHint(notes) {
  const m = notes.match(/^([^:]+):/);
  return m ? m[1].trim() : null;
}

/**
 * Nominatim indexes real place names, not route descriptions. "Everest Base
 * Camp Trek" fails; "Everest Base Camp" resolves on the first try. Testing a
 * sample of rows found stripping one trailing route-type word fixes most of
 * what the raw name misses.
 */
const ROUTE_NOISE_WORDS = new Set([
  'trek', 'trekking', 'trail', 'circuit', 'route', 'walk', 'path', 'loop',
  'climb', 'ascent', 'descent', 'crossing', 'traverse', 'summit', 'tour',
  'trip', 'hike', 'hiking', 'expedition',
]);

function stripRouteNoise(name) {
  const words = name.split(/\s+/);
  if (words.length > 1 && ROUTE_NOISE_WORDS.has(words[words.length - 1].toLowerCase())) {
    return words.slice(0, -1).join(' ');
  }
  return name;
}

/**
 * Rows with no colon-delimited Notes hint (mostly Urban Trail) often still
 * name their city in prose - "Boston historic walking route", "San Francisco
 * coastal city walk". Stripping generic route/geography filler words usually
 * leaves just the city. Tested against Freedom Trail's Notes ("Boston historic
 * walking route" -> without a city anchor, "Freedom Trail, USA" alone resolves
 * to a wrong same-named place in Virginia; with "Boston" added it resolves
 * correctly).
 */
const NOTES_FILLER_WORDS = new Set([
  'historic', 'walking', 'walk', 'route', 'trail', 'trails', 'city', 'coastal',
  'promenade', 'path', 'paths', 'loop', 'riverside', 'corridor', 'district',
  'park', 'waterfront', 'seafront', 'scenic', 'famous', 'iconic', 'popular',
  'central', 'urban', 'green', 'national', 'state', 'regional', 'area',
  'views', 'view', 'landmark', 'hike', 'hiking', 'trek', 'classic', 'the',
]);

function cityGuessFromNotes(notes) {
  const words = notes.replace(/[.,]/g, '').split(/\s+/);
  const kept = words.filter((w) => w && !NOTES_FILLER_WORDS.has(w.toLowerCase()));
  return kept.length ? kept.join(' ') : null;
}

/**
 * Attempts, cheapest/most-specific first, each only fired if the last came
 * back empty. Rows with a colon hint (National-Park-style Notes) lean on it
 * directly; rows without one lean on a city guessed out of the Notes prose,
 * since the bare name + country alone is prone to a same-named wrong-place
 * match once the country is large (see Freedom Trail above).
 */
function geocodeQueries(row) {
  const hint = notesHint(row.Notes);
  const stripped = stripRouteNoise(row.Name);
  const queries = [];

  if (hint) {
    queries.push([row.Name, hint, row.Country].filter(Boolean).join(', '));
    if (stripped !== row.Name) queries.push([stripped, hint, row.Country].filter(Boolean).join(', '));
    queries.push([hint, row.Country].join(', '));
  } else {
    const cityGuess = cityGuessFromNotes(row.Notes);
    if (cityGuess) queries.push([row.Name, cityGuess, row.Country].join(', '));
    if (stripped !== row.Name) queries.push([stripped, row.Country].join(', '));
    if (cityGuess) queries.push([cityGuess, row.Country].join(', '));
  }

  queries.push([row.Name, row.Country].join(', ')); // last-resort bare name

  return [...new Set(queries)];
}

async function geocodeOne(query) {
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'summit-seed/1.0 (hackathon build; contact via repo)' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}

async function geocodeAll(rows) {
  const cache = await loadCache();
  const results = new Map();
  let hits = 0, misses = 0, cached = 0, calls = 0;

  for (const [i, row] of rows.entries()) {
    const cacheKey = `${row.Name}||${row.Type}||${row.Country}`;

    if (cacheKey in cache) {
      cached++;
      if (cache[cacheKey]) results.set(row, cache[cacheKey]);
      else misses++;
      continue;
    }

    let point = null;
    for (const query of geocodeQueries(row)) {
      try {
        calls++;
        point = await geocodeOne(query);
        await sleep(GEOCODE_DELAY_MS);
        if (point) break;
      } catch (error) {
        warn(`geocode failed for "${query}": ${error.message}`);
        await sleep(GEOCODE_DELAY_MS);
      }
    }

    cache[cacheKey] = point;
    if (point) { results.set(row, point); hits++; }
    else misses++;

    if ((i + 1) % 25 === 0) {
      step(`     ${i + 1}/${rows.length} (${hits} geocoded, ${misses} missed, ${cached} cached, ${calls} calls)`);
      await saveCache(cache);
    }
  }

  await saveCache(cache);
  step(`     done: ${hits} geocoded, ${misses} missed, ${cached} from cache, ${calls} network calls`);
  return results;
}

/* -------------------------------------------------------------------------- */
/* Elevation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * SRTM 30m via OpenTopoData, same source and fallback chain as seed-osm.mjs.
 * Global coverage, not Singapore-specific, so it applies unchanged here.
 * 30_points_and_league.sql picks its scoring fixture with
 * `where elevation_m is not null`, so this is not cosmetic: without it that
 * test finds no row and fails.
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

    await sleep(1100);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Shaping                                                                    */
/* -------------------------------------------------------------------------- */

function slugify(name, taken) {
  const base =
    name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'place';

  let slug = base, n = 2;
  while (taken.has(slug)) slug = `${base}${n++}`;
  taken.add(slug);
  return slug;
}

function toPlace(row, point, taken) {
  const level = DIFFICULTY_TO_LEVEL[row.Difficulty.trim()] ?? 2;
  const km = Number(row.Distance_km);
  const slug = slugify(row.Name, taken);

  return {
    name: row.Name,
    slug,
    key: slug, // stable key for the elevation lookup map, independent of geocode cacheKey
    lat: point.lat,
    lng: point.lng,
    set: TYPE_TO_SET[row.Type.trim()] ?? 'trail',
    difficulty: level,
    rarity: LEVEL_TO_RARITY[level],
    distanceM: Number.isFinite(km) ? Math.round(km * 1000) : null,
  };
}

/* -------------------------------------------------------------------------- */
/* SQL                                                                        */
/* -------------------------------------------------------------------------- */

const HEADER = `-- Generated by scripts/seed-csv.mjs from treks_and_hikes.csv. Regenerate rather than hand-edit.
-- Coordinates from Nominatim (OpenStreetMap), best-effort per row.
`;

const TXN_OPEN = 'begin;\nset local search_path = public, extensions;';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function emitLocations(places) {
  const lat = places.reduce((s, p) => s + p.lat, 0) / places.length;
  const lng = places.reduce((s, p) => s + p.lng, 0) / places.length;

  const out = [HEADER, '', TXN_OPEN, ''];

  out.push('insert into cities (name, country, centre)');
  out.push(`values ('World', 'Global', st_point(${lng.toFixed(7)}, ${lat.toFixed(7)})::geography)`);
  out.push('on conflict (name) do nothing;', '');

  out.push('insert into location_sets (city_id, key, name, colour, sort_order) values');
  out.push(
    SETS.map(([k, n, c], i) =>
      `  ((select id from cities where name = 'World'), ${q(k)}, ${q(n)}, ${q(c)}, ${i})`,
    ).join(',\n') + '\non conflict (city_id, key) do nothing;',
    '',
  );

  for (const batch of chunk(places, INSERT_CHUNK)) {
    out.push('insert into locations');
    out.push('  (city_id, set_id, slug, name, geom, rarity, difficulty, distance_m,');
    out.push('   elevation_m, elevation_source)');
    out.push('values');
    out.push(
      batch
        .map(
          (l) =>
            `  ((select id from cities where name = 'World'),` +
            ` (select id from location_sets where key = ${q(l.set)} and city_id = (select id from cities where name = 'World')),` +
            ` ${q(l.slug)}, ${q(l.name)},` +
            ` st_point(${l.lng.toFixed(7)}, ${l.lat.toFixed(7)})::geography,` +
            ` ${q(l.rarity)}, ${l.difficulty},` +
            ` ${l.distanceM ?? 'null'},` +
            ` ${l.elevationM ?? 'null'}, ${l.elevationSource ? q(l.elevationSource) : 'null'})`,
        )
        .join(',\n'),
    );
    out.push('on conflict (slug) do nothing;', '');
  }

  out.push('commit;');
  return out.join('\n') + '\n';
}

/* -------------------------------------------------------------------------- */

function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = (m) => process.stderr.write(`  ! ${m}\n`);
const step = (m) => process.stderr.write(`${m}\n`);

/* -------------------------------------------------------------------------- */

async function main() {
  step('1/4  Reading treks_and_hikes.csv');
  const rows = await loadRows();
  step(`     ${rows.length} rows`);

  step('2/4  Geocoding via Nominatim (~1/sec, cached to .geocode-cache.json)');
  const geocoded = await geocodeAll(rows);

  const taken = new Set();
  const places = [];
  for (const row of rows) {
    const point = geocoded.get(row);
    if (!point) continue;
    places.push(toPlace(row, point, taken));
  }

  const bySet = places.reduce((acc, l) => ({ ...acc, [l.set]: (acc[l.set] ?? 0) + 1 }), {});
  const byRarity = places.reduce((acc, l) => ({ ...acc, [l.rarity]: (acc[l.rarity] ?? 0) + 1 }), {});
  step(`3/4  ${places.length}/${rows.length} placed`);
  step(`     by set: ${JSON.stringify(bySet)}`);
  step(`     by rarity: ${JSON.stringify(byRarity)}`);

  step('4/4  Elevation from SRTM 30 m (global coverage, not Singapore-specific)');
  const elevations = await fetchElevations(places);
  for (const l of places) {
    const e = elevations.get(l.key);
    l.elevationM = e?.m ?? null;
    l.elevationSource = e?.source ?? null;
  }
  step(`     ${elevations.size}/${places.length} resolved`);

  if (DRY_RUN) {
    for (const l of places.slice(0, 20)) {
      step(`     ${l.name} | ${l.set} | ${l.rarity} | d${l.difficulty} | ${l.lat.toFixed(4)},${l.lng.toFixed(4)} | ${l.elevationM ?? '?'} m`);
    }
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/0001_world_locations.sql`, emitLocations(places));
  step(`     wrote ${OUT_DIR}/0001_world_locations.sql`);
}

main().catch((error) => {
  process.stderr.write(`\nfailed: ${error.message}\n`);
  process.exit(1);
});
