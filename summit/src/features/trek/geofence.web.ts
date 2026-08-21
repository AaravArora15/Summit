/**
 * Web has no geofencing. The Geolocation API cannot wake a closed tab, and
 * there is no browser equivalent of an OS-monitored region.
 *
 * These no-ops exist so the explore and settings screens can call the same
 * functions on every platform rather than branching on Platform.OS. Each
 * returns the same shape the native module would return when the feature is
 * simply unavailable, which callers already have to handle.
 */
export async function prepareNotifications(): Promise<boolean> {
  return false;
}

export async function refreshSecretSpotFences(): Promise<number> {
  return 0;
}

export async function stopSecretSpotFences(): Promise<void> {}

export async function areSecretSpotFencesActive(): Promise<boolean> {
  return false;
}
