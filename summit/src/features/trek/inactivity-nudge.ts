/**
 * Inactivity nudge: "haven't trekked in a while" — a single local
 * notification, always rescheduled to fire NUDGE_AFTER_DAYS after the most
 * recent walk, and pushed further out every time a new one lands.
 *
 * Same pattern as geofence.ts (secret spots) and closure-alerts.ts
 * (closures): its own Android channel, its own lazy permission request. One
 * difference from both: this is the only one of the three that schedules a
 * real future delivery rather than firing immediately, so it needs a stable
 * `identifier` — cancel-then-reschedule on every trek is how "still going
 * strong" keeps pushing the reminder back rather than stacking duplicates.
 *
 * "Last trek" has no server-side field anywhere (no `last_trek_at` column,
 * no streak counter — see my_profile()/my_treks()), so this tracks it
 * locally in AsyncStorage, updated the moment a trek finishes syncing (see
 * the call in features/trek/sync.ts). A fresh install/reinstall has no local
 * history to work from; bootstrapInactivityNudge() below covers that one
 * case by asking the server for the most recent trek, once, at sign-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { isSupabaseConfigured, myTreks } from '@/lib/supabase';

const CHANNEL_ID = 'inactivity-nudge';
const NOTIFICATION_ID = 'summit-inactivity-nudge';
/** Keyed per user, not a single global key — a device that switches
 *  accounts (sign out, sign back in as someone else) must not carry the
 *  previous account's last-trek time into the new one's schedule. */
const lastTrekKey = (userId: string) => `@summit/last_trek_at:${userId}`;

/** How long a silence has to run before the reminder fires. Not a stated
 *  product number — a judgement call, cheap to retune later. */
const NUDGE_AFTER_DAYS = 4;

/**
 * Ask for notification permission and set up the Android channel. Called
 * once from _layout.tsx's AuthGate, the moment a session exists — unlike
 * secret-spot alerts (opt-in, asked for at the point the user turns them
 * on), this one is scheduled unconditionally, so the permission it needs
 * has to be requested unconditionally too.
 */
export async function prepareInactivityNudges(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Trek reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
  });

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Call once a trek finishes syncing (see sync.ts's `syncTrek()`) — any
 * outcome that means a walk genuinely happened, claimed or not. Records
 * "now" as the last trek and pushes the reminder NUDGE_AFTER_DAYS out from
 * there.
 */
export async function recordTrekActivity(userId: string): Promise<void> {
  const now = new Date();
  try {
    await AsyncStorage.setItem(lastTrekKey(userId), now.toISOString());
  } catch (error) {
    console.warn('[inactivity-nudge] could not persist last trek time', error);
  }
  await scheduleFrom(now);
}

/**
 * Call once at app boot, after a session is known — see AuthGate. Reads the
 * local last-trek time if one exists; on a fresh install with no local
 * history but a real account, asks the server once (my_treks(1)) so a
 * reinstall doesn't silently lose the schedule. A brand-new account with no
 * treks at all schedules nothing — there is no silence to measure yet.
 */
export async function bootstrapInactivityNudge(userId: string): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(lastTrekKey(userId));
    if (stored) {
      await scheduleFrom(new Date(stored));
      return;
    }

    if (!isSupabaseConfigured) return;

    const [mostRecent] = await myTreks(1);
    if (!mostRecent) return;

    const startedAt = new Date(mostRecent.started_at);
    await AsyncStorage.setItem(lastTrekKey(userId), startedAt.toISOString());
    await scheduleFrom(startedAt);
  } catch (error) {
    // Best-effort: a missed reminder is a much smaller loss than a boot
    // sequence that throws over it.
    console.warn('[inactivity-nudge] bootstrap failed', error);
  }
}

async function scheduleFrom(lastTrekAt: Date): Promise<void> {
  await prepareInactivityNudges();

  const target = new Date(lastTrekAt.getTime() + NUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  // Already overdue (e.g. the app was closed for a week and just reopened):
  // fire soon rather than silently let the moment pass, but not instantly —
  // give the app a beat before reminding someone to go back out.
  const fireAt = target.getTime() > Date.now() ? target : new Date(Date.now() + 60 * 60 * 1000);

  await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: {
      title: 'A trail is waiting',
      body: "It's been a few days since your last trek — Summit's still here whenever you are.",
      data: { kind: 'inactivity-nudge' },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt, channelId: CHANNEL_ID },
  });
}
