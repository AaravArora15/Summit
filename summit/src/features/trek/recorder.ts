/**
 * Trek recording.
 *
 * The one part of the app that has to work with the screen off, in a pocket,
 * under canopy, with no signal. Everything here is built around that.
 *
 * Shape of the loop:
 *   startTrek()  -> create a local trek row, begin background location updates
 *   (OS calls the task) -> append fixes to SQLite, never to memory or network
 *   stopTrek()   -> close the row, hand it to the sync queue
 *
 * Points are buffered locally and uploaded later because the trailhead is
 * exactly where the signal goes. Nothing in this file talks to the network.
 */
import * as Location from 'expo-location';

import { trackDistanceM, type LocalPoint } from '@/features/trek/distance';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';

export const TREK_TASK = 'summit-trek-location';

/** Accuracy is tiered: high only while actually recording. A hiking app that
 *  drains 40% of a battery in two hours does not get a second use. */
const RECORDING_ACCURACY = Location.Accuracy.High;

/**
 * Opened on first use, not at import.
 *
 * This module is pulled in by screens, and expo-sqlite is not available on
 * every platform the dev preview runs on. Opening at module scope would take
 * the whole screen down on import rather than failing at the one call that
 * actually needs storage.
 */
let database: SQLite.SQLiteDatabase | null = null;

function db(): SQLite.SQLiteDatabase {
  database ??= SQLite.openDatabaseSync('summit.db');
  return database;
}

/**
 * Whether local trek storage is usable. Web resolves recorder.web.ts instead of
 * this file, so by the time we are here we are on a device.
 */
export function isTrekStoreAvailable(): boolean {
  try {
    db();
    return true;
  } catch {
    return false;
  }
}

export function initTrekStore() {
  db().execSync(`
    pragma journal_mode = WAL;

    create table if not exists local_treks (
      id          text primary key,
      started_at  integer not null,
      ended_at    integer,
      synced      integer not null default 0
    );

    create table if not exists local_points (
      id          integer primary key autoincrement,
      trek_id     text not null,
      lat         real not null,
      lng         real not null,
      recorded_at integer not null,
      accuracy_m  real,
      is_mocked   integer not null default 0,
      altitude_m          real,
      altitude_accuracy_m real
    );

    create index if not exists local_points_trek
      on local_points (trek_id, recorded_at);
  `);

  // Added after the first release of this schema: where the trek was aimed.
  // Without it, a trek whose first upload was deferred came back as an
  // untargeted walk and its badge was gone for good.
  const columns = db().getAllSync<{ name: string }>('pragma table_info(local_treks)');
  if (!columns.some((c) => c.name === 'target_location_id')) {
    db().execSync('alter table local_treks add column target_location_id text');
  }
}

/** The id of the trek currently recording, or null. Kept in SQLite rather than
 *  memory because the background task runs in a separate JS context that does
 *  not share module state with the UI. */
function activeTrekId(): string | null {
  const row = db().getFirstSync<{ id: string }>(
    'select id from local_treks where ended_at is null order by started_at desc limit 1',
  );
  return row?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Database helpers                                                           */
/* -------------------------------------------------------------------------- */

function recordLocationFixes(trekId: string, locations: Location.LocationObject[]): void {
  if (!locations.length) return;

  try {
    db().withTransactionSync(() => {
      for (const fix of locations) {
        const timestamp = Math.round(fix.timestamp);

        // Prevent duplicate insertion if the same timestamp was already recorded
        // by either the foreground watcher or background task.
        const existing = db().getFirstSync<{ count: number }>(
          'select count(*) as count from local_points where trek_id = ? and recorded_at = ?',
          [trekId, timestamp],
        );
        if (existing && existing.count > 0) continue;

        db().runSync(
          `insert into local_points
             (trek_id, lat, lng, recorded_at, accuracy_m, is_mocked,
              altitude_m, altitude_accuracy_m)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            trekId,
            fix.coords.latitude,
            fix.coords.longitude,
            timestamp,
            fix.coords.accuracy ?? null,
            // Android only. iOS never reports this, so its absence proves nothing.
            (fix as { mocked?: boolean }).mocked ? 1 : 0,
            // Altitude is frequently null indoors and under heavy canopy, which
            // is fine: the server skips the elevation check when it is missing
            // rather than treating absence as failure.
            fix.coords.altitude ?? null,
            fix.coords.altitudeAccuracy ?? null,
          ],
        );
      }
    });
  } catch (error) {
    // A write that fails silently looks identical to a GPS that never fired,
    // which cost us a real debugging session. Say something.
    console.warn('[trek] could not persist fix', error);
  }
}

/* -------------------------------------------------------------------------- */
/* The background task & foreground watcher                                   */
/* -------------------------------------------------------------------------- */

let foregroundSubscription: Location.LocationSubscription | null = null;
let foregroundPollTimer: ReturnType<typeof setInterval> | null = null;

/** Poll cadence for the stillness fallback. See beginForegroundPolling(). */
const POLL_INTERVAL_MS = 4_000;

TaskManager.defineTask(TREK_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[trek] location task error', error.message);
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locations?.length) return;

  const trekId = activeTrekId();
  if (!trekId) return; // updates arrived after the trek ended; drop them

  recordLocationFixes(trekId, locations);
});

async function beginForegroundUpdates(trekId: string): Promise<void> {
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }

  try {
    let count = 0;
    foregroundSubscription = await Location.watchPositionAsync(
      {
        accuracy: RECORDING_ACCURACY,
        // Time-only on purpose. Adding distanceInterval would make Android
        // require movement before every update, so standing still -- which is
        // exactly what proving you visited a place requires -- produced zero
        // fixes and every claim died as "did not dwell".
        timeInterval: 2_000,
      },
      (fix) => {
        count += 1;
        if (count === 1 || count % 25 === 0) {
          console.warn(
            `[trek] fix #${count}, accuracy ${fix.coords.accuracy ?? '?'}m`,
          );
        }
        const current = activeTrekId();
        if (current === trekId) {
          recordLocationFixes(trekId, [fix]);
        }
      },
    );
    beginForegroundPolling(trekId);
  } catch (error) {
    console.warn('[trek] could not start foreground location updates', error);
  }
}

/**
 * A slow polling loop alongside the watcher. Some devices go quiet on the
 * fused provider when the phone is motionless, which starves the dwell check
 * of the very fixes it exists to count; a 4-second one-shot ask cannot be
 * suppressed that way. The watcher stays primary (fresher, cheaper); this is
 * redundancy for stillness, and the timestamp dedupe in recordLocationFixes()
 * makes overlap harmless.
 */
function beginForegroundPolling(trekId: string): void {
  stopForegroundPolling();
  foregroundPollTimer = setInterval(() => {
    const current = activeTrekId();
    if (current !== trekId) return;
    Location.getCurrentPositionAsync({ accuracy: RECORDING_ACCURACY })
      .then((fix) => {
        if (activeTrekId() === trekId) recordLocationFixes(trekId, [fix]);
      })
      .catch(() => {
        // Missed poll. The watcher or the next tick covers it.
      });
  }, POLL_INTERVAL_MS);
}

function stopForegroundPolling(): void {
  if (foregroundPollTimer) {
    clearInterval(foregroundPollTimer);
    foregroundPollTimer = null;
  }
}

function stopForegroundUpdates(): void {
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }
  stopForegroundPolling();
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export type PermissionOutcome =
  | { ok: true; background: boolean }
  | { ok: false; reason: 'foreground-denied' | 'background-denied' };

/**
 * Ask for location permission in two stages.
 *
 * Foreground is requested during onboarding. Background is only requested at
 * the moment the first trek starts, with the reason on screen. Asking for
 * "always" cold on the welcome screen gets denied, and on iOS there is no
 * second chance: the OS will not re-prompt.
 */
export async function requestTrekPermissions(): Promise<PermissionOutcome> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, reason: 'foreground-denied' };

  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    // A denied background permission is not fatal. The trek still records while
    // the app is open via the foreground watcher, so degrade rather than block.
    return { ok: true, background: bg.granted };
  } catch {
    return { ok: true, background: false };
  }
}

/** Shared by startTrek() and resumeTrek(): begins the background task that
 *  appends fixes to SQLite. Only called when background permission is held,
 *  since that is the only API this recorder uses to get fixes at all. */
async function beginLocationUpdates(): Promise<void> {
  try {
    await Location.startLocationUpdatesAsync(TREK_TASK, {
      accuracy: RECORDING_ACCURACY,
      // Same reasoning as the foreground watcher: a distance threshold would
      // silence the task whenever the user is standing still, and stillness
      // inside the arrival circle is precisely what claim_location() checks.
      timeInterval: 5_000,
      // Without this iOS shows no indicator and users reasonably assume the app
      // stopped recording when they locked the phone.
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Summit is recording your trek',
        notificationBody: 'Tap to return to the app.',
        notificationColor: '#1F3D2E',
      },
      // Do not let the OS pause updates on our behalf: a paused trek looks
      // identical to a finished one in the data, and we lose the tail.
      pausesUpdatesAutomatically: false,
    });
  } catch (error) {
    console.warn('[trek] could not start background location task', error);
  }
}

export async function startTrek(targetLocationId: string | null = null): Promise<string> {
  const existing = activeTrekId();
  if (existing) {
    await beginForegroundUpdates(existing);
    const canBackground = (await Location.getBackgroundPermissionsAsync()).granted;
    if (canBackground) await beginLocationUpdates();
    return existing;
  }

  const id = `trek_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  db().runSync(
    'insert into local_treks (id, started_at, target_location_id) values (?, ?, ?)',
    [id, Date.now(), targetLocationId],
  );

  // 1. Capture an immediate initial fix so distance tracking starts with a
  //    baseline. Raced against a short timeout: cold GPS can take minutes to
  //    produce a first High-accuracy lock, and startTrek() must not hang the
  //    UI on it. The watchers pick the slack up.
  try {
    const initialFix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: RECORDING_ACCURACY }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (initialFix) {
      recordLocationFixes(id, [initialFix]);
      console.warn(
        `[trek] initial fix saved, accuracy ${initialFix.coords.accuracy ?? '?'}m`,
      );
    } else {
      console.warn('[trek] initial fix timed out after 10s, continuing without it');
    }
  } catch (error) {
    console.warn('[trek] initial position fix skipped', error);
  }

  // 2. Start responsive foreground watcher for immediate live updates on screen.
  await beginForegroundUpdates(id);

  // 3. Start background location updates if permission is held. When it is
  //    not, say so: without this line, "the counter froze the moment I locked
  //    my phone" arrives as a mystery instead of a diagnosis.
  try {
    const canBackground = (await Location.getBackgroundPermissionsAsync()).granted;
    if (canBackground) {
      await beginLocationUpdates();
    } else {
      console.warn(
        '[trek] background permission not granted - recording runs only while the app is open on screen',
      );
    }
  } catch {
    // Non-fatal; foreground tracking remains active.
    console.warn('[trek] background availability check failed');
  }

  return id;
}

export async function stopTrek(trekId: string) {
  stopForegroundUpdates();
  try {
    if (await TaskManager.isTaskRegisteredAsync(TREK_TASK)) {
      await Location.stopLocationUpdatesAsync(TREK_TASK);
    }
  } catch (error) {
    console.warn('[trek] stopLocationUpdatesAsync error', error);
  }
  db().runSync('update local_treks set ended_at = ? where id = ?', [Date.now(), trekId]);
}

/**
 * Stop appending fixes without ending the trek. The row stays open (`ended_at`
 * is still null) so `activeTrekId()` keeps finding it; only the recording
 * stops. This is the actual anti-cheat mechanism for a pause: a person
 * who drives somewhere while paused leaves no fixes behind for that stretch,
 * so there is nothing for `trackDistanceM` to add and nothing for the
 * server's speed check to see as part of the walk.
 */
export async function pauseTrek(): Promise<void> {
  stopForegroundUpdates();
  try {
    if (await TaskManager.isTaskRegisteredAsync(TREK_TASK)) {
      await Location.stopLocationUpdatesAsync(TREK_TASK);
    }
  } catch (error) {
    console.warn('[trek] pauseTrek error', error);
  }
}

/** Resume fixes on the still-open trek row. Mirrors startTrek()'s flow. */
export async function resumeTrek(): Promise<void> {
  const trekId = activeTrekId();
  if (trekId) {
    await beginForegroundUpdates(trekId);
  }
  try {
    const canBackground = (await Location.getBackgroundPermissionsAsync()).granted;
    if (canBackground) {
      await beginLocationUpdates();
    } else {
      console.warn(
        '[trek] background permission not granted - recording runs only while the app is open on screen',
      );
    }
  } catch {
    // Non-fatal; foreground tracking remains active.
  }
}

export function getTrekPoints(trekId: string): LocalPoint[] {
  return db().getAllSync<LocalPoint>(
    `select lat, lng, recorded_at, accuracy_m, is_mocked,
            altitude_m, altitude_accuracy_m
       from local_points where trek_id = ? order by recorded_at`,
    [trekId],
  );
}

/** Treks that finished but have not reached the server yet. The claim target
 *  travels with the row, so a retry aims where the walk actually went. A trek
 *  with zero points can never be accepted, so it is dropped on sight instead
 *  of being retried forever. */
export function getPendingTreks() {
  db().runSync(
    'delete from local_treks where ended_at is not null and synced = 0 and not exists (select 1 from local_points p where p.trek_id = local_treks.id)',
  );
  return db().getAllSync<{
    id: string;
    started_at: number;
    ended_at: number;
    target_location_id: string | null;
  }>(
    'select id, started_at, ended_at, target_location_id from local_treks where ended_at is not null and synced = 0',
  );
}

export function markTrekSynced(trekId: string) {
  db().runSync('update local_treks set synced = 1 where id = ?', [trekId]);
}

export { trackDistanceM };
export type { LocalPoint };
