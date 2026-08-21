/**
 * Track geometry. Pure functions, no platform dependencies.
 *
 * Lives apart from recorder.ts so both the native recorder and the web stub can
 * share it without either pulling in expo-sqlite.
 */

export type LocalPoint = {
  lat: number;
  lng: number;
  recorded_at: number;
  accuracy_m: number | null;
  is_mocked: number;
  /** Device-reported altitude in metres, or null when the fix carried none.
   *  Compared server-side against the DEM height of the place being claimed. */
  altitude_m: number | null;
  altitude_accuracy_m: number | null;
};

/**
 * Haversine, used purely to show a number on the live trek screen.
 *
 * The server recomputes distance from the submitted track and that figure is
 * the one that counts. This is a display convenience, never a claim.
 */
export function trackDistanceM(points: LocalPoint[]): number {
  const R = 6_371_000;
  let total = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;

    const h =
      Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    total += 2 * R * Math.asin(Math.sqrt(h));
  }

  return total;
}

/**
 * Great-circle distance between two points, in metres.
 *
 * Same formula as trackDistanceM above but for two standalone points rather
 * than a track, used to match public locations against fuzzed secret-spot
 * fences on the Explore map: both are display-only, never a claim input.
 */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
