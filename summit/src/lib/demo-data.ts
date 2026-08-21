/**
 * Demo data.
 *
 * Used when Supabase is not configured, so the app is presentable without a
 * backend. Every row matches the shape returned by `locations_near()` exactly,
 * which means the switch to live data is a change of source and nothing else.
 *
 * These are real places in Singapore with real coordinates, so the map, the
 * distances, and the sets all line up with somewhere you could actually walk.
 * The pioneer counts are invented.
 *
 * This is demo scaffolding, not seed data. When the database is live, seed it
 * from a migration rather than from here.
 */
import type { NearbyLocation } from '@/lib/supabase';

/** Central Singapore. Distances below are measured from here. */
export const DEMO_CENTRE: [number, number] = [103.8198, 1.3521];

type DemoLocation = NearbyLocation & {
  /** The demo rows predate set_key/set_name; this is the field screens key art off. */
  set: 'rainforest' | 'reservoir' | 'coastal' | 'heritage' | 'urban' | 'islands';
};

export const DEMO_LOCATIONS: DemoLocation[] = [
  {
    id: 'demo-macritchie',
    name: 'MacRitchie Treetop',
    slug: 'macritchie',
    set_id: 'rainforest',
    set: 'rainforest',
    set_key: 'rainforest',
    set_name: 'Rainforest',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'rare',
    difficulty: 3,
    elevation_m: 60,
    distance_m: 4200,
    pioneer_taken: 47,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.8256,
    lat: 1.3438,
  },
  {
    id: 'demo-upper-peirce',
    name: 'Upper Peirce Reservoir',
    slug: 'upperpeirce',
    set_id: 'reservoir',
    set: 'reservoir',
    set_key: 'reservoir',
    set_name: 'Reservoir',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'common',
    difficulty: 2,
    elevation_m: 30,
    distance_m: 5100,
    pioneer_taken: 312,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.8043,
    lat: 1.3742,
  },
  {
    id: 'demo-bukit-timah',
    name: 'Bukit Timah Summit',
    slug: 'bukittimah',
    set_id: 'rainforest',
    set: 'rainforest',
    set_key: 'rainforest',
    set_name: 'Rainforest',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'legendary',
    difficulty: 4,
    elevation_m: 163,
    distance_m: 6200,
    pioneer_taken: 498,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.7764,
    lat: 1.3546,
  },
  {
    id: 'demo-southern-ridges',
    name: 'Henderson Waves',
    slug: 'henderson',
    set_id: 'urban',
    set: 'urban',
    set_key: 'urban',
    set_name: 'Urban',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'common',
    difficulty: 2,
    elevation_m: 35,
    distance_m: 3400,
    pioneer_taken: 204,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.8184,
    lat: 1.2795,
  },
  {
    id: 'demo-rail-corridor',
    name: 'Rail Corridor North',
    slug: 'railcorridor',
    set_id: 'urban',
    set: 'urban',
    set_key: 'urban',
    set_name: 'Urban',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'common',
    difficulty: 1,
    elevation_m: 12,
    distance_m: 900,
    pioneer_taken: 312,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.7754,
    lat: 1.3312,
  },
  {
    id: 'demo-fort-siloso',
    name: 'Fort Siloso',
    slug: 'fortsiloso',
    set_id: 'heritage',
    set: 'heritage',
    set_key: 'heritage',
    set_name: 'Heritage',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'epic',
    difficulty: 2,
    elevation_m: 40,
    distance_m: 8400,
    pioneer_taken: 89,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.8093,
    lat: 1.2588,
  },
  {
    id: 'demo-coney',
    name: 'Coney Island Boardwalk',
    slug: 'coney',
    set_id: 'islands',
    set: 'islands',
    set_key: 'islands',
    set_name: 'Islands',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'rare',
    difficulty: 2,
    elevation_m: 8,
    distance_m: 11200,
    pioneer_taken: 21,
    pioneer_cap: 500,
    status: 'open',
    lng: 103.9226,
    lat: 1.4106,
  },
  {
    id: 'demo-labrador',
    name: 'Labrador Nature Reserve',
    slug: 'labrador',
    set_id: 'coastal',
    set: 'coastal',
    set_key: 'coastal',
    set_name: 'Coastal',
    claimed: false,
    pioneer_number: null,
    points_earned: null,
    rarity: 'common',
    difficulty: 1,
    elevation_m: 10,
    distance_m: 7300,
    pioneer_taken: 156,
    pioneer_cap: 500,
    status: 'seasonal',
    lng: 103.8021,
    lat: 1.2662,
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
  bestPioneerNumber: { number: 3, location: 'Rail Corridor' },
  setsCompleted: 2,
  setsTotal: 6,
  titlesUnlocked: 2,
} as const;

/** Ranked by closeness to completion, which is the order that gets people out. */
export const DEMO_SET_PROGRESS = [
  { set: 'reservoir', name: 'Reservoir Ring', held: 3, total: 4 },
  { set: 'rainforest', name: 'Rainforest', held: 4, total: 5 },
  { set: 'coastal', name: 'Coastal', held: 2, total: 6 },
  { set: 'heritage', name: 'Heritage', held: 6, total: 6 },
] as const;

/** `glyph` names an icon in components/icons.tsx; the screen maps it to a node. */
export const DEMO_RECENT_BADGES = [
  { id: 'hiddenforest', band: 'Hiddenf.', rarity: 'rare', glyph: 'ridge' },
  { id: 'railcorridor', band: 'Railcor.', rarity: 'common', glyph: 'tree' },
  { id: 'fortsiloso', band: 'Siloso', rarity: 'epic', glyph: 'fort' },
] as const;

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

export const DEMO_STANDINGS: LeagueRow[] = [
  { rank: 5, name: 'Mei Ting', initials: 'MT', tint: '#7A8D99', points: 7140, treks: 18 },
  { rank: 6, name: 'Jonas D.', initials: 'JD', tint: '#A65A3A', points: 6800, treks: 15 },
  {
    rank: 7,
    name: 'You',
    initials: 'A',
    tint: '#DCC6A1',
    points: 6420,
    treks: 14,
    isYou: true,
    detail: '14 treks · 62 km',
  },
  { rank: 8, name: 'Priya R.', initials: 'PR', tint: '#6F8F75', points: 6105, treks: 12 },
  { rank: 9, name: 'Kai W.', initials: 'KW', tint: '#1F3D2E', points: 5940, treks: 11 },
];

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
  title: 'Keeper of Stones',
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
    { id: 'singapore', band: 'Singapore', glyph: 'summit', tint: '#1A1A1A' },
    { id: 'heritage', band: 'Heritage', glyph: 'fort', tint: '#4A4740' },
    { id: 'week32', band: 'Wk 32', glyph: 'drop', tint: '#A65A3A' },
    { id: 'hiddenforest', band: 'Hiddenf.', glyph: 'ridge', tint: '#7A8D99' },
  ],
  treksThisMonth: 14,
} as const;
