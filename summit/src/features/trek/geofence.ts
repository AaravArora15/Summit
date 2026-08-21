/**
 * Secret spot proximity, while the app is closed.
 *
 * Geofencing is an OS service, not a loop we run. We hand iOS or Android a list
 * of circles and the system wakes the app when the phone crosses into one. It
 * costs almost nothing in battery because the OS is already watching cell and
 * wifi transitions for its own reasons, which is the entire reason to use it
 * rather than polling location ourselves.
 *
 * Two constraints shape everything here.
 *
 * 1. iOS monitors at most 20 regions per app, across the whole app, not per
 *    call. So we register the nearest 20 and re-register as the user moves.
 *    Going over the limit does not error loudly, it silently drops regions,
 *    which would look like "the feature just does not work sometimes".
 *
 * 2. A secret spot's real coordinates must never reach the phone, or the hunt
 *    is over before it starts. The server therefore hands out a deliberately
 *    coarse circle: a centre snapped to a ~300 m grid, with a 400 m radius. The
 *    phone learns "something is around here", which is exactly the nudge the
 *    hunt screen promises, and never learns where to stand. See
 *    secret_spots_near() in supabase/migrations/0002_osm_elevation.sql.
 */
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { secretSpotsNear, type SecretSpotFence } from '@/lib/supabase';

const FENCE_TASK = 'summit-secret-spot-fence';

/** iOS caps monitored regions at 20 per app. Android's limit is 100. */
const MAX_REGIONS = 20;

/** Re-register once the user has moved far enough that the set would change. */
const REREGISTER_AFTER_M = 5000;

let lastRegisteredAt: { lat: number; lng: number } | null = null;

/* -------------------------------------------------------------------------- */
/* The task                                                                   */
/* -------------------------------------------------------------------------- */

TaskManager.defineTask(FENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[fence] task error', error.message);
    return;
  }

  const { eventType, region } = (data ?? {}) as {
    eventType?: Location.GeofencingEventType;
    region?: Location.LocationRegion;
  };

  // Exit events are registered only so the OS keeps the region warm. Telling
  // someone they have left a place they never found is noise.
  if (eventType !== Location.GeofencingEventType.Enter || !region) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'A secret spot is near',
      // Deliberately vague. Naming it, or saying how far, would hand over the
      // answer the hunt is built on.
      body: 'Somewhere within a few minutes of here. Open Summit for the clue.',
      data: { kind: 'secret-spot', regionId: region.identifier },
    },
    trigger: null, // deliver now
  });
});

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Ask for notification permission and set up the Android channel.
 *
 * Called at the point the user turns secret spot alerts on, not at launch. A
 * permission prompt with no context attached is the one most likely to be
 * denied, and Android 13+ gives no second chance.
 */
export async function prepareNotifications(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync('secret-spots', {
    name: 'Secret spots',
    importance: Notifications.AndroidImportance.DEFAULT,
    // No sound. This fires while someone is out walking, and a place that will
    // still be there tomorrow has not earned an interruption.
    sound: null,
  });

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Register the nearest secret spots as geofences.
 *
 * Safe to call often: it no-ops unless the user has moved far enough for the
 * nearest-20 set to have plausibly changed.
 */
export async function refreshSecretSpotFences(
  lat: number,
  lng: number,
  opts: { force?: boolean } = {},
): Promise<number> {
  if (!opts.force && lastRegisteredAt && metresBetween(lastRegisteredAt, { lat, lng }) < REREGISTER_AFTER_M) {
    return 0;
  }

  // Background permission is what makes this work with the app closed. Without
  // it the OS accepts the regions and never delivers an event, so bail rather
  // than pretend the feature is on.
  const { granted } = await Location.getBackgroundPermissionsAsync();
  if (!granted) return 0;

  let spots: SecretSpotFence[];
  try {
    spots = await secretSpotsNear(lat, lng);
  } catch (error) {
    // Offline at a trailhead is the normal case, not an error worth surfacing.
    console.warn('[fence] could not fetch secret spots', error);
    return 0;
  }

  if (spots.length === 0) {
    await stopSecretSpotFences();
    return 0;
  }

  await Location.startGeofencingAsync(
    FENCE_TASK,
    spots.slice(0, MAX_REGIONS).map((s) => ({
      identifier: s.id,
      latitude: s.fuzzed_lat,
      longitude: s.fuzzed_lng,
      radius: s.fence_radius,
      notifyOnEnter: true,
      // Exit events cost nothing and keep the region active on iOS, which
      // otherwise treats a device already inside a region as having no
      // transition to report.
      notifyOnExit: true,
    })),
  );

  lastRegisteredAt = { lat, lng };
  return Math.min(spots.length, MAX_REGIONS);
}

export async function stopSecretSpotFences() {
  if (await Location.hasStartedGeofencingAsync(FENCE_TASK)) {
    await Location.stopGeofencingAsync(FENCE_TASK);
  }
  lastRegisteredAt = null;
}

export async function areSecretSpotFencesActive(): Promise<boolean> {
  return Location.hasStartedGeofencingAsync(FENCE_TASK);
}

/* -------------------------------------------------------------------------- */

function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
