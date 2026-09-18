/**
 * Demo data.
 *
 * Used when Supabase is not configured, so the app is presentable without a
 * backend. Every row matches the shape returned by `locations_near()` exactly,
 * which means the switch to live data is a change of source and nothing else.
 *
 * DEMO_LOCATIONS are real places with real coordinates, geocoded the same way
 * as the real seed (see scripts/seed-csv.mjs) — all from the Yosemite cluster
 * in treks_and_hikes.csv, chosen because they genuinely sit within a few
 * kilometres of each other. That matters for this file specifically: unlike
 * the old Singapore demo, the real seed is now ~640 locations scattered
 * across every continent, so "nearby" is no longer true almost everywhere.
 * Faking a small distance_m for a location that is actually on another
 * continent would make the demo map lie about what it is showing, which is
 * the one thing demo data here must never do. distance_m below is the real
 * geodesic distance from DEMO_CENTRE, not invented. The pioneer counts are
 * invented (an RPC value, not a stored fact).
 *
 * DEMO_BADGES, DEMO_RECENT_BADGES, DEMO_SET_PROGRESS and DEMO_PROFILE.featured
 * carry no proximity claim — a badge you already hold, unlike a `locations_near()`
 * row, is not asserting anything about where you are standing — so those pull
 * from real locations anywhere in the seed, for set variety a single national
 * park cluster cannot offer on its own.
 *
 * This is demo scaffolding, not seed data. When the database is live, seed it
 * from a migration rather than from here.
 */
import type { NearbyLocation } from '@/lib/supabase';

/** Yosemite Valley Visitor Center. Distances below are measured from here. */
export const DEMO_CENTRE: [number, number] = [-119.5877, 37.7489];

type DemoLocation = NearbyLocation & {
  /** The demo rows predate set_key/set_name; this is the field screens key art off. */
  set: 'summit' | 'trail' | 'expedition' | 'coastal' | 'canyon' | 'park' | 'urban';
};

export const DEMO_LOCATIONS: DemoLocation[] = [
  {
    id: 'demo-yosemite-falls',
    name: 'Yosemite Falls Trail',
    slug: 'yosemitefallstrail',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'epic',
    difficulty: 3,
    elevation_m: 1223,
    distance_m: 1132,
    pioneer_taken: 204,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5984165,
    lat: 37.7432573,
  },
  {
    id: 'demo-lower-yosemite-fall',
    name: 'Lower Yosemite Fall Trail',
    slug: 'loweryosemitefalltrail',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'common',
    difficulty: 1,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 421,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5164635,
    lat: 37.8393004,
  },
  {
    id: 'demo-mariposa-grove',
    name: 'Mariposa Grove Loop',
    slug: 'mariposagroveloop',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'common',
    difficulty: 1,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 156,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5164635,
    lat: 37.8393004,
  },
  {
    id: 'demo-mist-trail',
    name: 'Mist Trail to Vernal & Nevada Falls',
    slug: 'misttrailtovernalnevadaf',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'epic',
    difficulty: 3,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 89,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5164635,
    lat: 37.8393004,
  },
  {
    id: 'demo-cathedral-lakes',
    name: 'Cathedral Lakes Trail',
    slug: 'cathedrallakestrail',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'rare',
    difficulty: 2,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 312,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5164635,
    lat: 37.8393004,
  },
  {
    id: 'demo-four-mile',
    name: 'Four Mile Trail to Glacier Point',
    slug: 'fourmiletrailtoglacierpo',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'epic',
    difficulty: 3,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 47,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5164635,
    lat: 37.8393004,
  },
  {
    id: 'demo-clouds-rest',
    name: 'Clouds Rest Trail',
    slug: 'cloudsresttrail',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'epic',
    difficulty: 3,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 21,
    pioneer_cap: 500,
    status: 'seasonal',
    status_note: 'Closed for snow above 8,000 ft; reopens late May.',
    lng: -119.5164635,
    lat: 37.8393004,
  },
  {
    id: 'demo-half-dome',
    name: 'Half Dome via Cables',
    slug: 'halfdomeviacables',
    set_id: 'trail',
    set: 'trail',
    set_key: 'trail',
    set_name: 'Trails',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'legendary',
    difficulty: 4,
    elevation_m: 3026,
    distance_m: 11842,
    pioneer_taken: 498,
    pioneer_cap: 500,
    status: 'open',
    status_note: null,
    lng: -119.5164635,
    lat: 37.8393004,
  },
];

/** Sorted by distance, matching how `locations_near()` returns rows. */
export function demoLocationsNear(radiusM = 12000): NearbyLocation[] {
  return DEMO_LOCATIONS.filter((l) => l.distance_m <= radiusM).sort(
    (a, b) => a.distance_m - b.distance_m,
  );
}

/* -------------------------------------------------------------------------- */
/* Collection                                                                 */
/* -------------------------------------------------------------------------- */
/*
 * Everything below drives the Collect, League and Profile tabs. It is shaped
 * the way the eventual queries will return it (one object per card, counts
 * already aggregated) so those screens change their source and nothing else.
 *
 * The league in particular has no tables yet: it is the one system in the
 * mockup that 0001_init.sql does not cover, so treat these numbers as a
 * specification of what the standings query has to produce.
 */

export const DEMO_COLLECTION = {
  owned: 27,
  total: 71,
  /** Order matters: it is the rarity ladder, and the screen reads down it. */
  byRarity: [
    { rarity: 'common', held: 14 },
    { rarity: 'rare', held: 8 },
    { rarity: 'epic', held: 4 },
    { rarity: 'legendary', held: 1 },
  ] as const,
  pioneerNumbersHeld: 19,
  bestPioneerNumber: { number: 3, location: 'Yosemite Falls Trail' },
  setsCompleted: 2,
  setsTotal: 7,
  titlesUnlocked: 2,
} as const;

/** Ranked by closeness to completion, which is the order that gets people out.
 *  `total` is the real count for that set in the live seed (scripts/seed-csv.mjs's
 *  by-set breakdown); `held` is invented, same as everywhere else here. */
export const DEMO_SET_PROGRESS = [
  { set: 'park', name: 'Parks', held: 18, total: 21 },
  { set: 'coastal', name: 'Coastal', held: 11, total: 15 },
  { set: 'urban', name: 'Urban Trails', held: 40, total: 85 },
  { set: 'trail', name: 'Trails', held: 90, total: 260 },
] as const;

/** `glyph` names an icon in components/icons.tsx; the screen maps it to a node. */
export const DEMO_RECENT_BADGES = [
  { id: 'aconcagua', band: 'Aconcag.', rarity: 'legendary', glyph: 'ridge' },
  { id: 'amalficoastpath', band: 'AmalfiC.', rarity: 'rare', glyph: 'drop' },
  { id: 'mornetroispitonstrail', band: 'MorneTr.', rarity: 'epic', glyph: 'tree' },
] as const;

/** The full badge browser's demo fallback — every held badge, not just the
 *  three-item "Latest" strip DEMO_RECENT_BADGES stands in for elsewhere.
 *  Spans all seven sets, since a held badge carries no proximity claim the
 *  way DEMO_LOCATIONS does — see the file header.
 *
 *  difficulty backs the badge detail view's generic "what was that run
 *  like?" estimate (features/trek/run-stats.ts) — demo mode has no trek to
 *  ask, so every demo badge's stats are that estimate, same as a real badge
 *  whose location never got a distance_m/avg_time_min from the seed. */
export const DEMO_BADGES = [
  { id: 'aconcagua', name: 'Aconcagua', rarity: 'legendary', difficulty: 4, glyph: 'ridge', setName: 'Summits & Volcanoes', pioneerNumber: 214 },
  { id: 'alpamayobasecamptrek', name: 'Alpamayo Base Camp Trek', rarity: 'legendary', difficulty: 4, glyph: 'fort', setName: 'Expeditions', pioneerNumber: 42 },
  { id: 'amalficoastpath', name: 'Amalfi Coast Path', rarity: 'rare', difficulty: 2, glyph: 'drop', setName: 'Coastal', pioneerNumber: 118 },
  { id: 'mornetroispitonstrail', name: 'Morne Trois Pitons Trail', rarity: 'epic', difficulty: 3, glyph: 'tree', setName: 'Parks', pioneerNumber: 89 },
  { id: 'kingscanyonrimwalk', name: 'Kings Canyon Rim Walk', rarity: 'epic', difficulty: 3, glyph: 'ridge', setName: 'Canyon & Desert', pioneerNumber: 156 },
  { id: 'grousegrindtrail', name: 'Grouse Grind Trail', rarity: 'legendary', difficulty: 4, glyph: 'ridge', setName: 'Urban Trails', pioneerNumber: 21 },
  { id: 'cathedrallakestrail', name: 'Cathedral Lakes Trail', rarity: 'rare', difficulty: 2, glyph: 'tree', setName: 'Trails', pioneerNumber: 312 },
] as const;

/* -------------------------------------------------------------------------- */
/* Trek journal                                                               */
/* -------------------------------------------------------------------------- */

/** Real places, invented times and distances — same rule as everywhere else
 *  in this file. Newest first, matching how my_treks() orders. */
export const DEMO_TREKS = [
  {
    id: 'demo-trek-1',
    startedAt: '2026-08-19T07:12:00Z',
    distanceM: 22800,
    movingTimeS: 18300,
    status: 'validated' as const,
    locationName: 'Half Dome via Cables',
    pioneerNumber: 498,
    pointsEarned: 312,
  },
  {
    id: 'demo-trek-2',
    startedAt: '2026-08-16T08:40:00Z',
    distanceM: 11400,
    movingTimeS: 8100,
    status: 'validated' as const,
    locationName: 'Yosemite Falls Trail',
    pioneerNumber: 204,
    pointsEarned: 168,
  },
  {
    id: 'demo-trek-3',
    startedAt: '2026-08-10T06:55:00Z',
    distanceM: 1600,
    movingTimeS: 1200,
    status: 'validated' as const,
    locationName: null,
    pioneerNumber: null,
    pointsEarned: 64,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Wildcard                                                                   */
/* -------------------------------------------------------------------------- */

/** Just the location — queries.ts's demoWildcard() builds a fresh
 *  assigned/expires window around it every time, since a stored one here
 *  would inevitably read as already expired the longer a demo session runs.
 *  A real DEMO_LOCATIONS entry (matching its rarity/difficulty), not an
 *  invented one, same rule as every other demo row that stands in for
 *  something claimable — name/setKey/setName are kept here for that
 *  traceability even though demoWildcard() itself withholds them, the same
 *  way a real unclaimed pick would. */
export const DEMO_WILDCARD_LOCATION = {
  locationId: 'demo-mist-trail',
  name: 'Mist Trail to Vernal & Nevada Falls',
  rarity: 'epic' as const,
  difficulty: 3 as const,
  setKey: 'trail',
  setName: 'Trails',
};

/* -------------------------------------------------------------------------- */
/* Territories — Capture Territory                                           */
/* -------------------------------------------------------------------------- */

/** One territory, in progress. Its four members are the same real Yosemite
 *  cluster DEMO_LOCATIONS already uses elsewhere — geographically close in
 *  reality, not just in this file's invented grouping. */
export const DEMO_TERRITORIES = [
  {
    territoryId: 'demo-territory-yosemite-falls',
    name: 'Yosemite Falls Trail area',
    held: 2,
    total: 4,
    captured: false,
    durationS: null,
    bestDurationS: 5400,
  },
] as const;

export const DEMO_TERRITORY_LOCATIONS: Record<
  string,
  {
    id: string;
    name: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
    difficulty: 1 | 2 | 3 | 4;
    claimed: boolean;
    pioneerNumber: number | null;
    claimedAt: string | null;
  }[]
> = {
  'demo-territory-yosemite-falls': [
    {
      id: 'demo-yosemite-falls',
      name: 'Yosemite Falls Trail',
      rarity: 'epic',
      difficulty: 3,
      claimed: true,
      pioneerNumber: 204,
      claimedAt: '2026-08-16T08:40:00Z',
    },
    {
      id: 'demo-lower-yosemite-fall',
      name: 'Lower Yosemite Fall Trail',
      rarity: 'common',
      difficulty: 1,
      claimed: true,
      pioneerNumber: 421,
      claimedAt: '2026-08-16T09:10:00Z',
    },
    {
      id: 'demo-mariposa-grove',
      name: 'Mariposa Grove Loop',
      rarity: 'common',
      difficulty: 1,
      claimed: false,
      pioneerNumber: null,
      claimedAt: null,
    },
    {
      id: 'demo-mist-trail',
      name: 'Mist Trail to Vernal & Nevada Falls',
      rarity: 'epic',
      difficulty: 3,
      claimed: false,
      pioneerNumber: null,
      claimedAt: null,
    },
  ],
};

export const DEMO_TERRITORY_LEADERBOARD: Record<
  string,
  { rank: number; displayName: string; durationS: number; capturedAt: string; isYou: boolean }[]
> = {
  'demo-territory-yosemite-falls': [
    {
      rank: 1,
      displayName: 'Climber #0089',
      durationS: 5400,
      capturedAt: '2026-08-09T12:00:00Z',
      isYou: false,
    },
    {
      rank: 2,
      displayName: 'Climber #0214',
      durationS: 7920,
      capturedAt: '2026-08-14T15:00:00Z',
      isYou: false,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* League                                                                     */
/* -------------------------------------------------------------------------- */

export const DEMO_LEAGUE = {
  month: 'August league',
  resetsOn: 'Resets 1 September · 15 days',
  tiers: ['Trailhead', 'Foothills', 'Ridgeline', 'Highlands', 'Summit'],
  tierIndex: 2,
  position: 7,
  divisionSize: 42,
  /** Top and bottom eight of forty-two, drawn as rules through the standings. */
  promotionCutoff: 8,
  relegationCutoff: 35,
  pointsToPromotion: 380,
  /** The gap, translated into something you could actually do on a Saturday. */
  promotionInTreks: '≈ one 6 km trek',
} as const;

export type LeagueRow = {
  rank: number;
  name: string;
  initials: string;
  /** Avatar tint. Decorative only: it carries no rarity or set meaning. */
  tint: string;
  points: number;
  treks: number;
  isYou?: boolean;
  /** Only "you" gets a second line, and only because it is worth the space. */
  detail?: string;
};

/**
 * A whole division, not a window around "you". The League screen scrolls every
 * place from #1 to #42 and draws the promotion and relegation boundaries
 * through the list where they actually fall, so demo needs people at every
 * rank for the rules to have something to sit between.
 *
 * The numbers are tuned to agree with DEMO_LEAGUE rather than invented twice:
 * you sit 7th on 6,420, and 8th holds 6,041 — which is exactly the
 * `pointsToPromotion` of 380 the summary card quotes. A demo whose two cards
 * contradict each other teaches whoever is reviewing it to distrust both.
 */
export const DEMO_STANDINGS: LeagueRow[] = (() => {
  const TINTS = ['#7A8D99', '#A65A3A', '#6F8F75', '#1F3D2E', '#4A4740', '#46707F'];
  const NAMES = [
    'Mei Ting', 'Jonas D.', 'Priya R.', 'Kai W.', 'Sofia M.', 'Tomas B.',
    'Aiko N.', 'Marcus L.', 'Elena V.', 'Diego S.', 'Freya H.', 'Omar K.',
  ];

  // Deterministic jitter: stable across renders, unlike Math.random().
  const jitter = (seed: number, span: number) => ((seed * 2654435761) >>> 0) % span;

  // The head is hand-set so the anchors land exactly; the tail decays from
  // just below 8th place into the relegation zone with plausible gaps.
  const HEAD = [12840, 11420, 10610, 9530, 8675, 7045];
  const YOU_RANK = 7;
  const YOU_POINTS = 6420;
  const PROMO_CUTOFF_POINTS = 6041; // 380 behind you, matching pointsToPromotion

  const rows: LeagueRow[] = [];

  for (let rank = 1; rank <= 42; rank += 1) {
    if (rank === YOU_RANK) {
      rows.push({
        rank,
        name: 'You',
        initials: 'A',
        tint: '#DCC6A1',
        points: YOU_POINTS,
        treks: 14,
        isYou: true,
        detail: '14 treks · 62 km',
      });
      continue;
    }

    let points: number;
    let treks: number;
    if (rank < YOU_RANK) {
      points = HEAD[rank - 1];
      // Trek counts slope down towards yours rather than fighting it: a table
      // where 6th walked fewer treks than 7th but sits higher reads as a bug
      // even though distance, not count, is what separates them.
      treks = [19, 17, 16, 15, 15, 14][rank - 1];
    } else if (rank === YOU_RANK + 1) {
      points = PROMO_CUTOFF_POINTS;
      treks = 12;
    } else {
      points = rank === YOU_RANK + 2 ? 5910 : rows[rows.length - 1].points;
      points -= 90 + jitter(rank, 140);
      points = Math.max(240, Math.round(points / 5) * 5);
      treks = Math.max(2, 11 - Math.round((rank - YOU_RANK) / 4) - (jitter(rank, 3) === 0 ? 1 : 0));
    }

    // Real-looking names at the top of the table thin into the default
    // "Climber #NNNN" identity most anonymous accounts actually carry.
    const name =
      rank <= NAMES.length ? NAMES[(rank - 1) % NAMES.length] : `Climber #${((rank * 137) % 700) + 180}`;
    const words = name.replace(/[^a-zA-Z ]/g, '').split(' ').filter(Boolean);
    const initials =
      ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';

    rows.push({
      rank,
      name,
      initials,
      tint: TINTS[rank % TINTS.length],
      points,
      treks,
    });
  }

  return rows;
})();

/** A group row is a league row without the trek count: private leagues score one thing. */
export type GroupRow = Pick<LeagueRow, 'rank' | 'name' | 'initials' | 'tint' | 'points' | 'isYou'>;

export const DEMO_GROUP: {
  name: string;
  memberCount: number;
  endsIn: string;
  scoring: string;
  window: string;
  stake: string;
  inviteCode: string;
  updatedAgo: string;
  gapToFirst: number;
  gapNote: string;
  standings: GroupRow[];
} = {
  name: 'Sunday Walkers',
  memberCount: 6,
  endsIn: 'Ends in 9 days',
  scoring: 'Total points',
  window: '1–31 Aug',
  stake: 'Bragging',
  inviteCode: 'WALK-7QK2',
  updatedAgo: 'updated 8 min ago',
  gapToFirst: 240,
  gapNote:
    'Jonas found two secret spots last weekend. One 4 km trek with a first discovery puts you ahead.',
  standings: [
    { rank: 1, name: 'Jonas D.', initials: 'JD', tint: '#A65A3A', points: 3420 },
    { rank: 2, name: 'You', initials: 'A', tint: '#DCC6A1', points: 3180, isYou: true },
    { rank: 3, name: 'Mei Ting', initials: 'MT', tint: '#7A8D99', points: 2940 },
    { rank: 4, name: 'Priya R.', initials: 'PR', tint: '#6F8F75', points: 2110 },
  ],
};

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export const DEMO_PROFILE = {
  name: 'Aarav',
  initials: 'A',
  // Mechanically derived from the demo set's own name, same rule
  // my_profile() applies server-side now (0022) — every DEMO_LOCATIONS row
  // is in the "Trails" set (see DEMO_LOCATIONS above), so this is what a
  // real profile with that set completed would show.
  title: 'Trails Keeper',
  /** Permanent and per-city, matching profiles.explorer_number in the schema. */
  explorerNumber: 472,
  standing: 'Founding pioneer',
  level: 12,
  xp: 1990,
  xpToNextLevel: 2550,
  counters: [
    { label: 'Badges', value: 27 },
    { label: 'Numbers', value: 19 },
    { label: 'Spots', value: 11 },
    { label: 'Sets', value: 2 },
  ],
  /** Four slots filled, one empty. The empty slot is the invitation. */
  featured: [
    { id: 'grousegrindtrail', band: 'GrouseG.', glyph: 'ridge', tint: '#7A9E4F' },
    { id: 'alpamayobasecamptrek', band: 'Alpamay.', glyph: 'fort', tint: '#6E7B88' },
    { id: 'kingscanyonrimwalk', band: 'KingsCa.', glyph: 'ridge', tint: '#B5651D' },
    { id: 'cathedrallakestrail', band: 'Cathedr.', glyph: 'tree', tint: '#35604A' },
  ],
  treksThisMonth: 14,
} as const;

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

/** One of each status, so the screen's three visual states all have something
 *  to show before a real submission exists. */
export const DEMO_SUGGESTIONS = [
  {
    id: 'demo-suggestion-1',
    name: 'Overlook above Half Dome Village',
    notes: 'Small clearing off the main trail, no sign or marker.',
    status: 'pending' as const,
    reviewNote: null,
    createdAt: '2026-08-20T09:15:00Z',
  },
  {
    id: 'demo-suggestion-2',
    name: 'Tunnel View East Ledge',
    notes: null,
    status: 'approved' as const,
    reviewNote: 'Added to Trails.',
    createdAt: '2026-08-14T16:40:00Z',
  },
  {
    id: 'demo-suggestion-3',
    name: 'Parking Lot Behind Gas Station',
    notes: null,
    status: 'rejected' as const,
    reviewNote: 'Not a walkable destination.',
    createdAt: '2026-08-05T11:02:00Z',
  },
] as const;
