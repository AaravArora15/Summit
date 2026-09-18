/**
 * Dev-only shortcut for testing a claim (and the arrival screen's reveal)
 * without walking anywhere.
 *
 * It does not fabricate a result client-side — it builds a stationary,
 * plausible track and uploads it for real, through the same `claim_location`
 * the app always calls. So a fake claim is exactly as honest as a real
 * walk's: the pioneer number, points, and rejection reasons (rate limit,
 * already claimed, secret spot needs a photo) are all the genuine server
 * response, not invented. Only the walking is skipped, by parking every
 * point at the target instead of a real GPS track.
 *
 * `__DEV__`-gated at every call site (see explore.tsx's "Fake claim" button)
 * so this is never reachable in a production build. It still writes to
 * whichever Supabase project `.env` points at and spends a real pioneer
 * number and a real rate-limit slot (5 claims/hour/user) there.
 */
import { deviceIntegrity } from '@/features/trek/integrity';
import type { SyncOutcome } from '@/features/trek/sync';
import { claimLocation, getSupabase, type NearbyLocation } from '@/lib/supabase';

const POINT_COUNT = 12;
const POINT_GAP_S = 5; // 55s total span — clears claim_location's 45s/3-point dwell window

export async function fakeClaimNearby(location: NearbyLocation): Promise<SyncOutcome> {
  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: 'deferred', reason: 'Not signed in' };

  const now = Date.now();
  const startedAt = now - (POINT_COUNT - 1) * POINT_GAP_S * 1000;
  const integrity = await deviceIntegrity();

  const { data: trek, error: trekError } = await supabase
    .from('treks')
    .insert({
      user_id: auth.user.id,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date(now).toISOString(),
      // Comfortably over the 100m/60s thresholds award_trek_activity_points()
      // checks, so a fake claim also exercises XP/league scoring for testing
      // — a display convenience like the rest of this file, not a real track.
      distance_m: 120,
      moving_time_s: (POINT_COUNT - 1) * POINT_GAP_S,
      status: 'submitted',
      device_integrity: integrity,
      with_partner: false,
      // Lets claim_run_stats() (0023) tell the badge browser this trek's
      // distance/time are a shortcut, not a walk, so it estimates instead
      // of showing 120 m in 55 seconds as someone's real pace.
      is_dev_fake: true,
    })
    .select('id')
    .single();
  if (trekError) return { status: 'deferred', reason: trekError.message };

  // Parked at the target with a few centimetres of jitter — inside the 90m
  // arrival radius and far under the 6.0 m/s speed cap over any 5s+ window,
  // the same two checks a real dwell has to pass.
  const points = Array.from({ length: POINT_COUNT }, (_, i) => ({
    trek_id: trek.id,
    geom: `SRID=4326;POINT(${location.lng + (Math.random() - 0.5) * 0.00002} ${location.lat + (Math.random() - 0.5) * 0.00002})`,
    recorded_at: new Date(startedAt + i * POINT_GAP_S * 1000).toISOString(),
    accuracy_m: 8,
    is_mocked: false,
    altitude_m: null,
    altitude_accuracy_m: null,
  }));

  const { error: pointsError } = await supabase.from('trek_points').insert(points);
  if (pointsError) return { status: 'deferred', reason: pointsError.message };

  try {
    const result = await claimLocation({ locationId: location.id, trekId: trek.id });
    return { status: 'claimed', result };
  } catch (error) {
    return { status: 'rejected', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Handoff to the arrival screen: a fake outcome never came from a local
 * SQLite trek, so there is nothing for arrival.tsx's normal syncTrek() call
 * to upload. It checks here first instead — see arrival.tsx's sync effect.
 * A plain module variable is enough: this is a same-process, one-shot
 * handoff between a button press and the screen it navigates to next, not
 * state anything needs to survive a reload or be shared across screens.
 */
let pendingOutcome: SyncOutcome | null = null;

export function stashDevFakeOutcome(outcome: SyncOutcome) {
  pendingOutcome = outcome;
}

export function takeDevFakeOutcome(): SyncOutcome | null {
  const value = pendingOutcome;
  pendingOutcome = null;
  return value;
}
