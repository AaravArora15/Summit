import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getCurrentCountryCode } from '@/features/geo/country';

/**
 * Supabase client.
 *
 * The anon key is public by design: it identifies the project, it does not
 * grant access. Every table has RLS, and anything a user would benefit from
 * lying about (pioneer numbers, points, league standing) is written only by
 * SECURITY DEFINER functions. See supabase/migrations/0001_init.sql.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether the project is configured. Screens use this to decide whether to
 * attempt a query at all.
 *
 * Deliberately not a module-scope throw: this file is imported by screens, and
 * throwing here takes the entire app down on a missing .env rather than
 * degrading the one feature that needs the network. Fail at the call, not at
 * the import.
 */
export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Session storage: AsyncStorage, not SecureStore.
 *
 * SecureStore is the more secure option and was the first choice here, but iOS
 * caps a keychain value at 2048 bytes and a Supabase session (access JWT plus
 * refresh token plus user payload) routinely exceeds that. The failure mode is
 * the worst kind: it works in testing with a small token and silently drops the
 * session in production.
 *
 * The accepted tradeoff is that the refresh token sits in the app sandbox
 * rather than the keychain, so it is readable on a rooted or jailbroken device.
 * If that becomes a real concern, the fix is to chunk the session across
 * SecureStore keys rather than to raise the limit, which is not possible.
 */
let client: SupabaseClient | null = null;

/**
 * Web: one session per browser tab.
 *
 * The default web behaviour sinks cross-user testing. AsyncStorage is
 * localStorage there, which every tab of the origin shares, and supabase-js
 * also relays auth events across tabs through a BroadcastChannel named after
 * the storage key -- so signing out in one window signed out all of them, and
 * two people could never be signed in side by side to test a join request
 * travelling between them.
 *
 * Both links are cut. Sessions go in sessionStorage (per tab by definition,
 * survives reloads), under a storage key suffixed with an id minted into that
 * same sessionStorage, so each tab's channel and tokens are its own. A new
 * window starts signed out and becomes whoever you sign in as there; "duplicate
 * tab" clones the id and therefore the account, which is occasionally exactly
 * what you want anyway. Native keeps AsyncStorage and the default key: one app
 * install is one person, and that assumption runs deeper than this file.
 */
function webAuthOptions() {
  const KEY = 'summit-tab-id';
  let tabId = window.sessionStorage.getItem(KEY);
  if (!tabId) {
    tabId = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(KEY, tabId);
  }

  return {
    storageKey: `sb-summit-auth-${tabId}`,
    storage: {
      getItem: (key: string) => Promise.resolve(window.sessionStorage.getItem(key)),
      setItem: (key: string, value: string) =>
        Promise.resolve(window.sessionStorage.setItem(key, value)),
      removeItem: (key: string) => Promise.resolve(window.sessionStorage.removeItem(key)),
    },
  };
}

/** The client, created on first use. Throws only if actually called unconfigured. */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client ??= createClient(url!, anonKey!, {
    auth: {
      ...(Platform.OS === 'web' ? webAuthOptions() : { storage: AsyncStorage }),
      autoRefreshToken: true,
      persistSession: true,
      // No URL session detection: this is a native app, not a browser.
      detectSessionInUrl: false,
    },
  });

  return client;
}

/* -------------------------------------------------------------------------- */
/* Typed RPC wrappers                                                         */
/* -------------------------------------------------------------------------- */

export type ClaimResult = {
  claim_id: string;
  pioneer_number: number | null;
  edition: 'pioneer' | 'explorer';
};

/**
 * Claim a location. The server validates the trek and allocates the number;
 * this call cannot influence which number comes back.
 *
 * Throws with the Postgres message on rejection, which is deliberately
 * human-readable ("did not dwell at the location") so the UI can show it.
 */
export async function claimLocation(args: {
  locationId: string;
  trekId: string;
  photoPath?: string;
}): Promise<ClaimResult> {
  const { data, error } = await getSupabase()
    .rpc('claim_location', {
      p_location_id: args.locationId,
      p_trek_id: args.trekId,
      p_photo_path: args.photoPath ?? null,
    })
    .single();

  if (error) throw new Error(error.message);
  return data as ClaimResult;
}

export type ClaimPointsRow = {
  source:
    | 'distance'
    | 'moving_time'
    | 'badge'
    | 'new_route'
    | 'difficulty'
    | 'secret_spot'
    | 'beat_average'
    | 'set_complete'
    | 'wildcard';
  amount: number;
};

/** The XP breakdown behind one claim's total — the same permanent number
 *  `points_earned` sums on `NearbyLocation`, itemized by source. See
 *  claim_points_breakdown() in 0021: it's the permanent total on purpose,
 *  not the monthly league figure. */
export const claimPointsBreakdown = (claimId: string) =>
  rpcRows<ClaimPointsRow>('claim_points_breakdown', { p_claim_id: claimId });

export type NearbyLocation = {
  id: string;
  name: string;
  slug: string;
  lng: number;
  lat: number;
  set_id: string | null;
  set_key: string | null;
  set_name: string | null;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  distance_m: number;
  /** SRTM 30m, same source difficulty is graded from. Null for the rare place
   *  the DEM lookup missed. */
  elevation_m: number | null;
  pioneer_taken: number;
  pioneer_cap: number;
  status: string;
  /** Why, when status isn't 'open' — "Closed for the monsoon", say. Null for
   *  an open location, and sometimes for a closed one too: not every closure
   *  has a note attached. */
  status_note: string | null;
  /** Whether the caller already holds this location. False when signed out. */
  claimed: boolean;
  /** Set only alongside `claimed`. Null, never invented, before that. */
  pioneer_number: number | null;
  /** What this specific claim paid, summed from points_ledger. Null until claimed:
   *  distance and time both feed the total, so there is nothing honest to show
   *  before the walk happens. */
  points_earned: number | null;
};

export async function locationsNear(
  lat: number,
  lng: number,
  radiusM = 5000,
): Promise<NearbyLocation[]> {
  const { data, error } = await getSupabase().rpc('locations_near', {
    p_lat: lat,
    p_lng: lng,
    p_radius: radiusM,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as NearbyLocation[];
}

export type SecretSpotFence = {
  id: string;
  name: string;
  /** Snapped to a ~300 m grid server-side. Never the real coordinate. */
  fuzzed_lat: number;
  fuzzed_lng: number;
  fence_radius: number;
};

/**
 * Coarse circles for the secret spots nearest a point, for geofencing.
 *
 * The server decides how vague these are, and the client cannot ask for better.
 * Capped at 20 because that is what iOS will monitor at once.
 */
export async function secretSpotsNear(
  lat: number,
  lng: number,
  radiusM = 20000,
): Promise<SecretSpotFence[]> {
  const { data, error } = await getSupabase().rpc('secret_spots_near', {
    p_lat: lat,
    p_lng: lng,
    p_radius: radiusM,
    p_limit: 20,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as SecretSpotFence[];
}

/* -------------------------------------------------------------------------- */
/* Read API                                                                   */
/* -------------------------------------------------------------------------- */
/*
 * One call per card-group on a screen, matching the functions in
 * supabase/migrations/0006_read_api.sql. The aggregation is deliberately on
 * the server: the alternative is four round trips and a join done in
 * JavaScript over a connection that, on a trail, may not exist.
 *
 * None of these take a user id. They read auth.uid() server-side, so there is
 * no version of this API where a caller reads someone else's collection by
 * guessing a uuid.
 */

/** Postgres `returns table` with one row arrives as a one-element array. */
async function rpcRow<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as T[];
  return rows[0] ?? null;
}

async function rpcRows<T>(fn: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export type ProfileRow = {
  user_id: string;
  display_name: string;
  initials: string;
  explorer_number: number | null;
  city_name: string | null;
  is_founding: boolean;
  is_admin: boolean;
  level: number;
  xp_into_level: number;
  xp_for_level: number;
  total_xp: number;
  badges: number;
  numbers: number;
  spots: number;
  sets_completed: number;
  /** The most recently completed set's own name, e.g. "Trails Keeper" — see
   *  my_profile() (0022). Null until a whole set is held. */
  title: string | null;
  treks_this_month: number;
};

export const myProfile = () => rpcRow<ProfileRow>('my_profile');

/**
 * Renames the caller. Returns the name as actually stored: the server trims
 * and collapses whitespace, so what comes back is the truth every other screen
 * will render, not necessarily what was typed.
 */
export async function renameDisplay(name: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('rename_display_name', { p_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}

export type CollectionRow = {
  owned: number;
  total: number;
  common_held: number;
  rare_held: number;
  epic_held: number;
  legendary_held: number;
  numbers_held: number;
  best_number: number | null;
  best_number_location: string | null;
  sets_completed: number;
  sets_total: number;
};

export const myCollection = () => rpcRow<CollectionRow>('my_collection');

export type SetProgressRow = {
  set_id: string;
  key: string;
  name: string;
  colour: string;
  held: number;
  total: number;
  next_location_id: string | null;
  next_location_name: string | null;
  next_location_difficulty: number | null;
};

export const mySetProgress = () => rpcRows<SetProgressRow>('my_set_progress');

export type RecentBadgeRow = {
  claim_id: string;
  location_id: string;
  slug: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  set_key: string | null;
  set_colour: string | null;
  pioneer_number: number | null;
  claimed_at: string;
};

export const myRecentBadges = (limit = 3) =>
  rpcRows<RecentBadgeRow>('my_recent_badges', { p_limit: limit });

export type LeagueRow = {
  league_id: string;
  period: string;
  tier: string;
  tier_name: string;
  /** 1-based, matching league_tiers.sort_order. */
  tier_index: number;
  tier_count: number;
  rank: number;
  division_size: number;
  points: number;
  treks: number;
  distance_m: number;
  promotion_cutoff: number;
  relegation_cutoff: number;
  points_to_promotion: number;
  points_to_safety: number;
  resets_on: string;
  days_left: number;
};

export const myLeague = () => rpcRow<LeagueRow>('my_league');

export type StandingRow = {
  rank: number;
  user_id: string;
  name: string;
  initials: string;
  points: number;
  treks: number;
  distance_m: number;
  is_you: boolean;
};

/** You, plus `around` either side. Not the whole division: see the function. */
export const leagueStandings = (around = 2) =>
  rpcRows<StandingRow>('league_standings', { p_around: around });

/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Private leagues behind an invite code. Everything here routes through one
 * SECURITY DEFINER function per action (0016_groups.sql): joining is a request
 * the leader answers, never a write, so there is no client path that seats
 * someone directly.
 */

export type GroupInfoRow = {
  group_id: string;
  name: string;
  invite_code: string;
  leader_id: string;
  member_count: number;
  created_at: string;
};

/** Creates the group and seats the caller as leader and first member. */
export async function createGroup(name: string): Promise<GroupInfoRow> {
  const row = await rpcRow<GroupInfoRow>('create_group', { p_name: name });
  if (!row) throw new Error('The group could not be created');
  return row;
}

/** The caller's group, or null. Most accounts have never joined one, so an
 *  empty answer here is real and must survive to the screen as such. */
export const myGroup = () => rpcRow<GroupInfoRow>('my_group');

export type GroupStandingRow = {
  rank: number;
  user_id: string;
  name: string;
  initials: string;
  /** This month's monthly points, summed month-to-date from the ledger. */
  points: number;
  treks: number;
  distance_m: number;
  is_you: boolean;
  is_leader: boolean;
};

export const groupStandings = () => rpcRows<GroupStandingRow>('group_standings');

/** Asks to join by invite code. Codes compare dash-stripped and case-insensitively,
 *  so whatever a pasted message did to the formatting still finds the group. */
export async function requestJoinGroup(code: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('request_join_group', { p_code: code });
  if (error) throw new Error(error.message);
  return data as string;
}

export type MyGroupRequestRow = {
  request_id: string;
  group_id: string;
  group_name: string;
  leader_name: string;
  status: 'pending' | 'rejected';
  created_at: string;
};

export const myGroupRequest = () => rpcRow<MyGroupRequestRow>('my_group_request');

export type PendingJoinRequestRow = {
  request_id: string;
  user_id: string;
  name: string;
  initials: string;
  created_at: string;
};

/** The leader's inbox. Empty for anyone who does not lead a group. */
export const pendingJoinRequests = () =>
  rpcRows<PendingJoinRequestRow>('pending_join_requests');

/** Answers a request. Returns false when someone else already answered it,
 *  which is how a double-tap on a slow connection resolves rather than errors. */
export async function respondJoinRequest(requestId: string, accept: boolean): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('respond_join_request', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}


export type SetLocationRow = {
  id: string;
  name: string;
  slug: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  pioneer_taken: number;
  pioneer_cap: number;
  status: string;
  status_note: string | null;
  claimed: boolean;
  pioneer_number: number | null;
  claimed_at: string | null;
};

/** Every public location in a set, held or not, claimed-first — closed and
 *  seasonal locations included, same "known place, not been there" treatment
 *  as any other missing badge. */
export const setLocations = (setId: string) => rpcRows<SetLocationRow>('set_locations', { p_set_id: setId });

/** The points a finished set pays, read from the same source award_claim_points() writes from. */
export async function setCompleteBonusPoints(): Promise<number> {
  const { data, error } = await getSupabase().rpc('set_complete_bonus_points');
  if (error) throw new Error(error.message);
  return data as number;
}

/* -------------------------------------------------------------------------- */
/* Badge browser / trek journal                                              */
/* -------------------------------------------------------------------------- */

export type BadgeRow = {
  claim_id: string;
  location_id: string;
  slug: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  set_key: string | null;
  set_name: string | null;
  set_colour: string | null;
  pioneer_number: number | null;
  claimed_at: string;
};

/** Every badge the caller holds, most recent first. No limit: bounded by
 *  how many open locations exist in the city, same as my_collection()'s total. */
export const myBadges = () => rpcRows<BadgeRow>('my_badges');

export type ClaimRunStatsRow = {
  claimed_at: string;
  /** The trek's own real numbers — null whenever there is no genuine walked
   *  track behind this claim (no trek, or a dev-fake-claim.ts shortcut), in
   *  which case the caller estimates from the location_* columns instead.
   *  See claim_run_stats() (0023) and features/trek/run-stats.ts. */
  distance_m: number | null;
  moving_time_s: number | null;
  location_distance_m: number | null;
  location_avg_time_min: number | null;
  difficulty: 1 | 2 | 3 | 4;
};

/** The walk behind one held badge, for the badge browser's detail view. */
export const claimRunStats = (claimId: string) =>
  rpcRow<ClaimRunStatsRow>('claim_run_stats', { p_claim_id: claimId });

export type TrekRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  distance_m: number | null;
  moving_time_s: number | null;
  status: 'recording' | 'submitted' | 'validated' | 'rejected';
  /** "Secret spot" rather than the real name when the claim was one — same
   *  rule as everywhere else in the app that could otherwise leak one. */
  location_name: string | null;
  pioneer_number: number | null;
  points_earned: number | null;
};

export const myTreks = (limit = 30) => rpcRows<TrekRow>('my_treks', { p_limit: limit });

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Submit a place someone found that is not in the collection yet. Lands in
 * `location_suggestions`, not `locations` — nothing here is claimable until a
 * human reviews it (see 0014_location_suggestions.sql). Anonymous sessions
 * may call this, same bar as claiming.
 */
export async function suggestLocation(args: {
  name: string;
  lat: number;
  lng: number;
  notes?: string;
  photoPath?: string;
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('suggest_location', {
    p_name: args.name,
    p_lat: args.lat,
    p_lng: args.lng,
    p_notes: args.notes ?? null,
    p_photo_path: args.photoPath ?? null,
  });

  if (error) throw new Error(error.message);
  return data as string;
}

export type SuggestionRow = {
  id: string;
  name: string;
  notes: string | null;
  lat: number;
  lng: number;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  created_at: string;
};

/** Every suggestion the caller has submitted, most recent first. Never
 *  anyone else's, same rule as every other function in the read API. */
export const mySuggestions = () => rpcRows<SuggestionRow>('my_location_suggestions');

/**
 * Same bucket and path convention as uploadClaimPhoto in features/trek/sync.ts
 * (`<user-id>/...`, enforced by the storage policy in 0004_storage.sql) — a
 * `suggestion-` prefix on the filename just keeps it apart from trek photos
 * sharing the same folder.
 */
export async function uploadSuggestionPhoto(
  userId: string,
  uri: string,
  mimeType?: string,
): Promise<string> {
  const contentType = mimeType ?? 'image/jpeg';
  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const path = `${userId}/suggestion-${Date.now()}.${ext}`;

  const response = await fetch(uri);
  const bytes = await response.arrayBuffer();

  const { error } = await getSupabase()
    .storage.from('claim-photos')
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message);

  return path;
}

/* -------------------------------------------------------------------------- */
/* Suggestion review — admin only                                            */
/* -------------------------------------------------------------------------- */

export type PendingSuggestionRow = {
  id: string;
  user_id: string;
  submitter: string;
  name: string;
  notes: string | null;
  lat: number;
  lng: number;
  has_photo: boolean;
  created_at: string;
};

/** Every pending suggestion, any submitter — not just the caller's own, the
 *  way my_location_suggestions() is. Silently empty for a non-admin rather
 *  than an error: see pending_location_suggestions() (0022). */
export const pendingSuggestions = () =>
  rpcRows<PendingSuggestionRow>('pending_location_suggestions');

/** Turns one suggestion into a real, claimable location. Throws with the
 *  server's message ("not authorized", "suggestion already reviewed") on
 *  refusal. */
export async function approveSuggestion(args: {
  suggestionId: string;
  slug: string;
  setId?: string | null;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('approve_location_suggestion', {
    p_suggestion_id: args.suggestionId,
    p_slug: args.slug,
    p_set_id: args.setId ?? null,
    p_rarity: args.rarity,
    p_difficulty: args.difficulty,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function rejectSuggestion(args: {
  suggestionId: string;
  reviewNote?: string;
}): Promise<void> {
  const { error } = await getSupabase().rpc('reject_location_suggestion', {
    p_suggestion_id: args.suggestionId,
    p_review_note: args.reviewNote ?? null,
  });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/* Wildcard                                                                   */
/* -------------------------------------------------------------------------- */

export type WildcardRow = {
  wildcard_id: string;
  location_id: string;
  /** Real hints, sent every call: rarity/difficulty narrow the hunt down
   *  ("Epic, Difficulty 3") without saying where. */
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  /** The actual answer — null until `claimed`, at which point it's the
   *  reveal. See my_wildcard() (0024). */
  slug: string | null;
  name: string | null;
  set_key: string | null;
  set_name: string | null;
  assigned_at: string;
  expires_at: string;
  rerolled: boolean;
  claimed: boolean;
};

/** Today's pick, assigning one on first call of the day if there isn't one
 *  yet. Null when there is nothing left to pick — every open, non-secret
 *  location already claimed, or (0026) nothing open in the caller's own
 *  country. See my_wildcard() (0024, 0026). p_country_code is only consulted
 *  on the first call of a given day, when the assignment is actually made
 *  (see getCurrentCountryCode() in features/geo/country.ts). */
export const myWildcard = async () => {
  const countryCode = await getCurrentCountryCode();
  return rpcRow<WildcardRow>('my_wildcard', { p_country_code: countryCode });
};

/** Swaps today's pick for a different one, still restricted to the caller's
 *  own country (0026). Throws with the server's message ("already rerolled
 *  today's wildcard", "today's wildcard is already claimed", "nothing else to
 *  reroll to") on refusal. */
export async function rerollWildcard(): Promise<void> {
  const countryCode = await getCurrentCountryCode();
  const { error } = await getSupabase().rpc('reroll_wildcard', { p_country_code: countryCode });
  if (error) throw new Error(error.message);
}

export type WildcardBearingRow = {
  distance_m: number;
  /** Degrees clockwise from true north, 0-360. Null only when standing
   *  essentially on top of the target (points coincident) — see
   *  wildcard_bearing() (0024). */
  bearing_deg: number | null;
};

/** Live distance + direction toward today's (still-unclaimed) Wildcard pick
 *  from wherever the caller says they are right now. The real coordinates
 *  never come back — only this. Null once there is nothing left to find
 *  (no pick assigned, or today's is already claimed). Meant to be polled
 *  every few seconds while walking, not cached — pass the caller's own
 *  device coordinates, never a stored or demo value. */
export const wildcardBearing = (lat: number, lng: number) =>
  rpcRow<WildcardBearingRow>('wildcard_bearing', { p_lat: lat, p_lng: lng });

/* -------------------------------------------------------------------------- */
/* Territories — Capture Territory                                          */
/* -------------------------------------------------------------------------- */

export type TerritoryRow = {
  territory_id: string;
  name: string;
  held: number;
  total: number;
  captured: boolean;
  /** This caller's own capture time, seconds. Null until `captured`. */
  duration_s: number | null;
  /** The fastest capture by anyone, for bragging-rights context next to
   *  your own time — null until at least one person has captured it. */
  best_duration_s: number | null;
};

/** Every territory that exists, closest-to-captured first — same ordering
 *  rule my_set_progress() already uses. See my_territories() (0025). */
export const myTerritories = () => rpcRows<TerritoryRow>('my_territories');

export type TerritoryLocationRow = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  claimed: boolean;
  pioneer_number: number | null;
  claimed_at: string | null;
};

/** Every member location of one territory, held or not. */
export const territoryLocations = (territoryId: string) =>
  rpcRows<TerritoryLocationRow>('territory_locations', { p_territory_id: territoryId });

export type TerritoryLeaderboardRow = {
  rank: number;
  display_name: string;
  duration_s: number;
  captured_at: string;
  is_you: boolean;
};

/** The fastest captures of one territory, fastest first. Public the same
 *  way league standings already name other users. */
export const territoryLeaderboard = (territoryId: string, limit = 20) =>
  rpcRows<TerritoryLeaderboardRow>('territory_leaderboard', {
    p_territory_id: territoryId,
    p_limit: limit,
  });

/* -------------------------------------------------------------------------- */
/* Untargeted treks                                                          */
/* -------------------------------------------------------------------------- */

export type ValidateTrekResult = {
  status: 'validated' | 'rejected';
  reason: string | null;
};

/**
 * For a trek with no claim to attempt: the honesty checks claim_location()
 * would otherwise run (min track length, no mocked fixes, no implausible
 * speed) minus the ones that need a target to check against, then marks the
 * trek validated so it earns its distance/moving_time points and counts
 * toward the league — see 0015_untargeted_trek_scoring.sql. Idempotent: a
 * retried call after a flaky connection returns the same decision rather
 * than re-running the checks.
 */
export async function validateTrek(trekId: string): Promise<ValidateTrekResult> {
  const { data, error } = await getSupabase()
    .rpc('validate_trek', { p_trek_id: trekId })
    .single();

  if (error) throw new Error(error.message);
  return data as ValidateTrekResult;
}
