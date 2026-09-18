/**
 * Closure alerts: the notification channel behind the onboarding promise in
 * sign-in.tsx's "Four promises" step — "Weather and closure alerts cannot
 * be switched off."
 *
 * This is deliberately just the delivery plumbing today, not the decision
 * logic. Two things are still missing before this promise is fully true:
 *
 *   1. Something that notices a followed/nearby location's status just
 *      changed — a Supabase realtime subscription on `locations.status`, or
 *      a polling job, neither built yet.
 *   2. A weather feed cross-referenced against upcoming/active treks, out of
 *      scope for this pass entirely (see pending.md).
 *
 * `notifyClosure` below is the primitive that work will call once it
 * exists; nothing calls it yet. What this file does today: request the
 * permission (unlike secret-spot alerts in geofence.ts, this one is asked
 * for proactively, right where the promise is made, since it is pitched to
 * the user as always-on rather than an opt-in extra) and set up the Android
 * channel it will deliver through.
 */
import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'closures';

/**
 * Ask for notification permission and set up the Android channel. Called
 * once, from sign-in.tsx's onboarding "agree" step. Safe to call again
 * later (e.g. from settings) — it no-ops once permission is already
 * granted.
 */
export async function prepareClosureAlerts(): Promise<boolean> {
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Closures & weather',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
  });

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** The delivery primitive for #1/#2 above, once either exists. */
export async function notifyClosure(locationName: string, note?: string | null): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${locationName} is closed`,
      body: note ?? 'This location is not accepting claims right now.',
      data: { kind: 'closure', locationName },
    },
    trigger: null, // deliver now
  });
}
