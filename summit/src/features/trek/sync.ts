/**
 * Getting a finished trek from the phone to the server.
 *
 * This runs at the trailhead, in a car park, or the next morning on wifi. It
 * never runs during the walk. The rules that follow from that:
 *
 *   - Nothing is deleted locally until the server has confirmed it.
 *   - A failed sync is normal, not exceptional. It retries later.
 *   - The pioneer number is whatever the server says, including null. The
 *     client never guesses one to show early, because a number shown and then
 *     withdrawn is worse than a number that arrives late.
 */
import {
  getPendingTreks,
  getTrekPoints,
  markTrekSynced,
  trackDistanceM,
  type LocalPoint,
} from '@/features/trek/recorder';
import { deviceIntegrity } from '@/features/trek/integrity';
import { recordTrekActivity } from '@/features/trek/inactivity-nudge';
import {
  claimLocation,
  getSupabase,
  isSupabaseConfigured,
  validateTrek,
  type ClaimResult,
} from '@/lib/supabase';

export type SyncOutcome =
  | { status: 'claimed'; result: ClaimResult }
  /** No target was ever attempted — see validate_trek(). Distinct from
   *  'rejected' (a claim was refused) and 'deferred' (network trouble, will
   *  retry): this walk is done and fully uploaded, it just never aimed at
   *  anywhere to claim. */
  | { status: 'recorded' }
  | { status: 'rejected'; reason: string }
  | { status: 'deferred'; reason: string };

/**
 * Upload one trek and attempt the claim. The two halves are separate on
 * purpose: a trek is worth keeping even if the claim is refused, since the
 * walk still counts for distance, time, and the league.
 */
async function syncTrekInner(args: {
  /** The local trek row to upload. */
  localTrekId: string;
  /** Where the trek was aimed, or null for a free walk. Persisted with the
   *  local row, so deferred retries still claim (see syncPendingTreks). */
  locationId: string | null;
  /** A local file (or blob/data) URI from the picker. Uploaded to the
   *  claim-photos bucket once the trek row exists, since the storage path is
   *  keyed on the trek id. Omit for a claim that carries no photo. */
  photoUri?: string;
  /** From the picker result, so the upload's extension and Content-Type match
   *  what was actually captured instead of assuming JPEG. */
  photoMimeType?: string;
  /** Self-reported, for the "with one other person" points multiplier.
   *  Not persisted locally, so a deferred retry uploads as solo. */
  withPartner?: boolean;
}): Promise<SyncOutcome> {
  if (!isSupabaseConfigured) {
    return { status: 'deferred', reason: 'Supabase is not configured' };
  }

  const points = getTrekPoints(args.localTrekId);
  if (points.length === 0) {
    // The single most useful fact when someone reports "no badge": the map dot
    // follows the OS regardless of this app, so a green dot and an empty
    // track are fully compatible. Say which one happened.
    return {
      status: 'rejected',
      reason:
        'No track was recorded — the phone never saved a GPS fix to this trek. Check location permission and try a short walk.',
    };
  }

  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { status: 'deferred', reason: 'Not signed in' };
  }

  const startedAt = points[0].recorded_at;
  const endedAt = points[points.length - 1].recorded_at;

  const integrity = await deviceIntegrity();

  try {
    // 1. The trek itself. Check for an existing row first: if the network
    //    failed after the server inserted the trek but before the response
    //    reached the client, syncPendingTreks() retries with the same local
    //    data. Without this check a duplicate trek row is created, which can
    //    lead to duplicate league points for free walks. The treks table has
    //    no unique constraint, so the guard is here instead.
    const startedAtISO = new Date(startedAt).toISOString();
    const { data: existing } = await supabase
      .from('treks')
      .select('id')
      .eq('user_id', auth.user.id)
      .eq('started_at', startedAtISO)
      .maybeSingle();

    let trek: { id: string };
    if (existing) {
      trek = existing;
    } else {
      const { data: inserted, error: trekError } = await supabase
        .from('treks')
        .insert({
          user_id: auth.user.id,
          started_at: startedAtISO,
          ended_at: new Date(endedAt).toISOString(),
          distance_m: Math.round(trackDistanceM(points)),
          moving_time_s: movingTimeSeconds(points),
          status: 'submitted',
          device_integrity: integrity,
          with_partner: args.withPartner ?? false,
        })
        .select('id')
        .single();

      if (trekError) return { status: 'deferred', reason: trekError.message };
      trek = inserted!;
    }

    // 2. The track. Chunked because a long walk is thousands of rows and a
    //    single oversized request is the thing most likely to fail on a weak
    //    connection, which is exactly where this runs.
    for (const chunk of chunked(points, 500)) {
      const { error } = await supabase.from('trek_points').insert(
        chunk.map((p) => ({
          trek_id: trek.id,
          geom: `SRID=4326;POINT(${p.lng} ${p.lat})`,
          recorded_at: new Date(p.recorded_at).toISOString(),
          accuracy_m: p.accuracy_m,
          is_mocked: Boolean(p.is_mocked),
          altitude_m: p.altitude_m,
          altitude_accuracy_m: p.altitude_accuracy_m,
        })),
      );
      if (error) return { status: 'deferred', reason: error.message };
    }

    // 3. No target: validate the walk on its own honesty rather than
    //    attempting a claim there is nothing to aim at.
    if (!args.locationId) {
      try {
        const result = await validateTrek(trek.id);
        markTrekSynced(args.localTrekId);
        return result.status === 'validated'
          ? { status: 'recorded' }
          : { status: 'rejected', reason: result.reason ?? 'Not counted' };
      } catch (error) {
        // The trek and track are already uploaded; only validation itself
        // failed to reach the server. Retryable, same as any other deferral.
        return { status: 'deferred', reason: messageOf(error) };
      }
    }

    let photoPath: string | undefined;
    if (args.photoUri) {
      try {
        photoPath = await uploadClaimPhoto(
          supabase,
          auth.user.id,
          trek.id,
          args.photoUri,
          args.photoMimeType,
        );
      } catch (uploadError) {
        // The trek and track are already saved. A photo that fails to upload
        // should not lose either: fall through with no photo, and let
        // claim_location() give its normal, readable refusal if the target
        // needed one ("secret spots require a photo").
        console.warn('[sync] photo upload failed', messageOf(uploadError));
      }
    }

    console.warn(
      `[sync] claiming ${args.locationId} with ${points.length} points, photo: ${photoPath ? 'yes' : 'no'}`,
    );

    try {
      const result = await claimLocation({
        locationId: args.locationId,
        trekId: trek.id,
        photoPath,
      });
      markTrekSynced(args.localTrekId);
      return { status: 'claimed', result };
    } catch (claimError) {
      // The trek uploaded fine; only the claim was refused. A refused claim
      // never marks the trek validated on its own (claim_location() only does
      // that on success), so without this the "still counts for distance,
      // time, and your league" line below would be false — best-effort here,
      // same trust level the photo-upload fallback above already is: the
      // claim's own rejection reason is what surfaces either way.
      try {
        await validateTrek(trek.id);
      } catch (validateError) {
        console.warn('[sync] validating the rejected-claim trek failed', messageOf(validateError));
      }
      markTrekSynced(args.localTrekId);
      return { status: 'rejected', reason: messageOf(claimError) };
    }
  } catch (error) {
    return { status: 'deferred', reason: messageOf(error) };
  }
}

/**
 * The exported entry point. One line in the Metro logs per finished trek --
 * target, point count, how it ended -- because when a badge "did not happen",
 * this is where the answer lives and nobody is attached to a debugger on a
 * trailhead.
 */
export async function syncTrek(args: Parameters<typeof syncTrekInner>[0]): Promise<SyncOutcome> {
  const outcome = await syncTrekInner(args);
  console.warn(
    '[sync] outcome',
    JSON.stringify({
      trek: args.localTrekId,
      target: args.locationId ?? 'none',
      points: getTrekPoints(args.localTrekId).length,
      status: outcome.status,
      detail: 'result' in outcome ? outcome.result : ('reason' in outcome ? outcome.reason : ''),
    }),
  );
  // Anything but 'deferred' means a walk genuinely happened, claimed or not —
  // same test syncPendingTreks() below already uses for its own "synced"
  // count. Pushes the inactivity reminder out from today. getSession() here
  // rather than getUser() (already called inside syncTrekInner, for a
  // network-verified identity): this one is best-effort and local-only is
  // fine, so it isn't worth a second round trip.
  if (outcome.status !== 'deferred') {
    const { data } = await getSupabase().auth.getSession();
    const userId = data.session?.user.id;
    if (userId) void recordTrekActivity(userId);
  }
  return outcome;
}

/** Drain anything left over from previous walks. Safe to call on app start. */
export async function syncPendingTreks(): Promise<number> {
  if (!isSupabaseConfigured) return 0;

  let synced = 0;
  for (const trek of getPendingTreks()) {
    // The claim target is persisted with the trek row, so a retry still aims
    // where the walk actually went. This used to upload everything as an
    // untargeted walk -- which quietly turned "network died at the trailhead"
    // into "the badge I earned yesterday never existed".
    const outcome = await syncTrek({
      localTrekId: trek.id,
      locationId: trek.target_location_id ?? null,
    });
    if (outcome.status !== 'deferred') synced += 1;
  }
  return synced;
}

/**
 * Upload one claim photo and return its storage path.
 *
 * Path is `<user-id>/<trek-id>.<ext>`, matching the prefix the bucket's RLS
 * policies check (see migrations/0004_storage.sql) so the client is never free
 * to write into another user's folder.
 *
 * `fetch` on a `file://` URI is the documented way to turn an Expo ImagePicker
 * result into bytes on both native and web; native support for it is built
 * into Expo's polyfilled fetch, not the platform one.
 */
async function uploadClaimPhoto(
  supabase: ReturnType<typeof getSupabase>,
  userId: string,
  trekId: string,
  uri: string,
  mimeType?: string,
): Promise<string> {
  const contentType = mimeType ?? 'image/jpeg';
  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const path = `${userId}/${trekId}.${ext}`;

  const response = await fetch(uri);
  const bytes = await response.arrayBuffer();

  const { error } = await supabase.storage
    .from('claim-photos')
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(error.message);

  return path;
}

/* -------------------------------------------------------------------------- */

/**
 * Time spent actually moving, excluding long stationary gaps.
 *
 * A gap larger than the threshold is treated as a rest rather than walking, so
 * a lunch stop does not inflate the pace the league is scored on.
 */
function movingTimeSeconds(points: LocalPoint[]): number {
  const MAX_GAP_S = 90;
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const gap = (points[i].recorded_at - points[i - 1].recorded_at) / 1000;
    if (gap > 0 && gap <= MAX_GAP_S) total += gap;
  }

  return Math.round(total);
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
