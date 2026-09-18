/**
 * "What was that run like?" for a badge whose claim carries no genuine
 * walked track — a demo badge (no backend at all, see demo-data.ts) or one
 * claimed through the dev-only fake-claim shortcut (dev-fake-claim.ts parks
 * every GPS point on the pin, so its trek row's own numbers are a shortcut,
 * not a hike). claim_run_stats() (0023) already tells the caller which case
 * it is; this is only the estimate math for when it says "neither".
 *
 * locations.avg_time_min is the schema's own "generic runtime of a hike"
 * field (compared against a real walk elsewhere, e.g. award_claim_points()'s
 * beat_average bonus) but is null for nearly every seeded location — the CSV
 * importer (scripts/seed-csv.mjs) never populates it. So the estimate falls
 * through, in order: the location's own avg_time_min if it has one, else a
 * pace derived from its difficulty tier applied to its own distance_m, else
 * a generic distance for that tier too when even distance_m is missing.
 */
export type RunStats = {
  distanceM: number;
  movingTimeS: number;
  /** True whenever this is not a real walked track — see file header. */
  isEstimated: boolean;
};

type Difficulty = 1 | 2 | 3 | 4;

/** A plausible round-trip distance for a tier with no seeded distance_m. */
const DEFAULT_DISTANCE_M: Record<Difficulty, number> = {
  1: 3000,
  2: 5000,
  3: 8000,
  4: 12000,
};

/** Minutes per km, generic hiking pace by difficulty: flatter, easier trails
 *  walk faster, harder ones slow down for terrain and elevation. */
const PACE_MIN_PER_KM: Record<Difficulty, number> = {
  1: 12,
  2: 14.5,
  3: 18,
  4: 23,
};

export function estimateRunStats(
  difficulty: Difficulty,
  locationDistanceM?: number | null,
  locationAvgTimeMin?: number | null,
): RunStats {
  const distanceM = locationDistanceM || DEFAULT_DISTANCE_M[difficulty];
  const movingTimeS = locationAvgTimeMin
    ? locationAvgTimeMin * 60
    : Math.round((distanceM / 1000) * PACE_MIN_PER_KM[difficulty] * 60);
  return { distanceM, movingTimeS, isEstimated: true };
}

/** Minutes'seconds per km — same formula trek/live.tsx's live pace stat uses. */
export function formatPace(seconds: number, metres: number): string {
  if (metres <= 0) return '--';
  const secondsPerKm = seconds / (metres / 1000);
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
