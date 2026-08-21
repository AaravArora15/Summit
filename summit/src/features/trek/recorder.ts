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
/* The background task                                                        */
/* -------------------------------------------------------------------------- */

TaskManager.defineTask(TREK_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[trek] location task error', error.message);
    return;
  }

  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  if (!locations?.length) return;

  const trekId = activeTrekId();
  if (!trekId) return; // updates arrived after the trek ended; drop them

  // The OS delivers fixes in batches, so this writes several rows per call.
  // One transaction for the batch rather than an implicit one per statement:
  // each commit is an fsync, and this runs while the user is walking with the
  // screen off, where wasted wakeups are wasted battery.
  db().withTransactionSync(() => {
    for (const fix of locations) {
      db().runSync(
        `insert into local_points
           (trek_id, lat, lng, recorded_at, accuracy_m, is_mocked,
            altitude_m, altitude_accuracy_m)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          trekId,
          fix.coords.latitude,
          fix.coords.longitude,
          Math.round(fix.timestamp),
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
});

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

  const bg = await Location.requestBackgroundPermissionsAsync();
  // A denied background permission is not fatal. The trek still records while
  // the app is open, so degrade rather than block.
  return { ok: true, background: bg.granted };
}

export async function startTrek(): Promise<string> {
  const existing = activeTrekId();
  if (existing) return existing;

  const id = `trek_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  db().runSync('insert into local_treks (id, started_at) values (?, ?)', [id, Date.now()]);

  const canBackground = (await Location.getBackgroundPermissionsAsync()).granted;

  if (canBackground) {
    await Location.startLocationUpdatesAsync(TREK_TASK, {
      accuracy: RECORDING_ACCURACY,
      timeInterval: 5_000,
      distanceInterval: 10,
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
  }

  return id;
}

export async function stopTrek(trekId: string) {
  if (await TaskManager.isTaskRegisteredAsync(TREK_TASK)) {
    await Location.stopLocationUpdatesAsync(TREK_TASK);
  }
  db().runSync('update local_treks set ended_at = ? where id = ?', [Date.now(), trekId]);
}

export function getTrekPoints(trekId: string): LocalPoint[] {
  return db().getAllSync<LocalPoint>(
    `select lat, lng, recorded_at, accuracy_m, is_mocked,
            altitude_m, altitude_accuracy_m
       from local_points where trek_id = ? order by recorded_at`,
    [trekId],
  );
}

/** Treks that finished but have not reached the server yet. */
export function getPendingTreks() {
  return db().getAllSync<{ id: string; started_at: number; ended_at: number }>(
    'select id, started_at, ended_at from local_treks where ended_at is not null and synced = 0',
  );
}

export function markTrekSynced(trekId: string) {
  db().runSync('update local_treks set synced = 1 where id = ?', [trekId]);
}

export { trackDistanceM };
export type { LocalPoint };
