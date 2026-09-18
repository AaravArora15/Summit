/**
 * Shared "begin a trek session" flow: request location permission, run the
 * caller's `begin()` (whatever sets up the target in the trek store), and
 * report whether it's safe to move on to trek/live.
 *
 * Pulled out of explore.tsx (the only place this used to live) once a
 * second screen — Home's Wildcard hunt — needed the exact same permission
 * request, platform-specific denial copy, and error handling. Screens still
 * own their own "starting…" loading flag and the actual navigation; this is
 * only the part that must not drift between call sites.
 */
import { Platform } from 'react-native';

import { requestTrekPermissions } from '@/features/trek/recorder';
import { alertUser } from '@/lib/alert';

export async function beginTrekSession(begin: () => Promise<void>): Promise<boolean> {
  try {
    const permission = await requestTrekPermissions();
    if (!permission.ok) {
      // Web's recorder is a deliberate stub (see recorder.web.ts) that always
      // denies here, since there is no background-location task to start —
      // a distinct message rather than the native "enable it in Settings"
      // one, which would send someone hunting for a setting that does not
      // exist on this platform.
      alertUser(
        Platform.OS === 'web' ? 'Phone app needed' : 'Location access needed',
        Platform.OS === 'web'
          ? 'Recording a trek needs GPS and background location, which this web preview cannot do. Open Summit on your phone to trek.'
          : 'Summit needs your location to record a trek. Enable it for Summit in your device settings and try again.',
      );
      return false;
    }

    await begin();
    return true;
  } catch (error) {
    alertUser('Could not start trekking', error instanceof Error ? error.message : String(error));
    return false;
  }
}
