/**
 * Trek recorder, web stub.
 *
 * Metro resolves this instead of recorder.ts on web, which keeps expo-sqlite
 * out of the web dependency graph entirely.
 *
 * A guarded `require('expo-sqlite')` was not enough: Metro still follows the
 * static edge when bundling, so the web export failed on an unresolvable
 * `wa-sqlite.wasm` and produced no bundle at all. A platform variant removes
 * the edge rather than trying to survive it.
 *
 * Recording a walk is a device concern. Nothing here pretends otherwise: the
 * functions exist so screens can import them unconditionally, and they refuse
 * clearly rather than silently doing nothing that looks like success.
 */
import { trackDistanceM, type LocalPoint } from '@/features/trek/distance';

export { trackDistanceM };
export type { LocalPoint };

export const TREK_TASK = 'summit-trek-location';

export type PermissionOutcome =
  | { ok: true; background: boolean }
  | { ok: false; reason: 'foreground-denied' | 'background-denied' };

const UNSUPPORTED = 'Trek recording needs the phone app.';

/** Always false on web, so callers skip the whole trek path. */
export function isTrekStoreAvailable(): boolean {
  return false;
}

export function initTrekStore(): void {
  // Nothing to initialise.
}

export async function requestTrekPermissions(): Promise<PermissionOutcome> {
  return { ok: false, reason: 'foreground-denied' };
}

export async function startTrek(): Promise<string> {
  throw new Error(UNSUPPORTED);
}

export async function stopTrek(_trekId: string): Promise<void> {
  // No recording was started, so there is nothing to stop.
}

export function getTrekPoints(_trekId: string): LocalPoint[] {
  return [];
}

export function getPendingTreks(): { id: string; started_at: number; ended_at: number }[] {
  return [];
}

export function markTrekSynced(_trekId: string): void {
  // No local rows exist to mark.
}
