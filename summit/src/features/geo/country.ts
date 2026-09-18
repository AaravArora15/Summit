/**
 * Best-effort ISO 3166-1 alpha-2 country code for wherever the device
 * currently is, used to keep the daily Wildcard (see queries.ts's
 * useWildcard()) from ever picking a location the person has no realistic
 * way to reach today. Locations are scattered worldwide (scripts/seed-csv.mjs)
 * so an unfiltered pick can land on a different continent from the caller.
 *
 * Never throws: permission denial, no fix, and a reverse-geocode miss all
 * resolve to null, the same "can't tell, so don't guess" signal. my_wildcard()
 * treats a null country the same as a country with nothing left to pick,
 * rather than falling back to a worldwide draw, since a wrong-country pick is
 * worse than no pick at all.
 *
 * Modeled on useDeviceCentre() in app/(tabs)/explore.tsx: check the existing
 * permission before prompting, race a cold GPS fix against a timeout, and
 * fall back to the OS's last known position rather than giving up immediately.
 */
import * as Location from 'expo-location';

export async function getCurrentCountryCode(): Promise<string | null> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    const granted = existing.granted ? existing : await Location.requestForegroundPermissionsAsync();
    if (!granted.granted) return null;

    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    const coords = fix?.coords ?? (await Location.getLastKnownPositionAsync({ maxAge: 300_000 }))?.coords;
    if (!coords) return null;

    const [place] = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
    return place?.isoCountryCode?.toUpperCase() ?? null;
  } catch (error) {
    console.warn('[wildcard] could not resolve device country', error);
    return null;
  }
}
