import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

/** The client, created on first use. Throws only if actually called unconfigured. */
export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  client ??= createClient(url!, anonKey!, {
    auth: {
      storage: AsyncStorage,
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
  level: number;
  xp_into_level: number;
  xp_for_level: number;
  total_xp: number;
  badges: number;
  numbers: number;
  spots: number;
  sets_completed: number;
  treks_this_month: number;
};

export const myProfile = () => rpcRow<ProfileRow>('my_profile');

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


export type SetLocationRow = {
  id: string;
  name: string;
  slug: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  pioneer_taken: number;
  pioneer_cap: number;
  claimed: boolean;
  pioneer_number: number | null;
  claimed_at: string | null;
};

/** Every open, public location in a set, held or not, claimed-first. */
export const setLocations = (setId: string) => rpcRows<SetLocationRow>('set_locations', { p_set_id: setId });

/** The points a finished set pays, read from the same source award_claim_points() writes from. */
export async function setCompleteBonusPoints(): Promise<number> {
  const { data, error } = await getSupabase().rpc('set_complete_bonus_points');
  if (error) throw new Error(error.message);
  return data as number;
}
