/**
 * Active trek session state.
 *
 * Deliberately thin. The database is the source of truth for the track itself
 * (see recorder.ts); this store holds only what the UI needs to render at 1 Hz,
 * so a crash or a backgrounded app loses nothing that matters.
 *
 * Nothing here is authoritative. Distance and elapsed time shown during a trek
 * are display conveniences; the server recomputes both from the submitted
 * track, and its numbers are the ones that count.
 */
import { create } from 'zustand';


import {
  getTrekPoints,
  pauseTrek,
  resumeTrek,
  startTrek,
  stopTrek,
  trackDistanceM,
  type LocalPoint,
} from '@/features/trek/recorder';

export type TrekPhase = 'idle' | 'recording' | 'arrived' | 'submitting';

type TrekState = {
  phase: TrekPhase;
  trekId: string | null;
  targetLocationId: string | null;
  targetName: string | null;
  /** Rarity and glyph off the same `NearbyLocation` row the pin was rendered
   *  from, carried through purely so the arrival screen can draw the actual
   *  badge shield in its reveal rather than a placeholder. Same trust level
   *  as `targetName`: a display convenience, not the source of truth — the
   *  server-issued `pioneer_number`/`edition` in `ClaimResult` remain that.
   *  Null for a secret spot (its fence carries neither) or a free walk. */
  targetRarity: string | null;
  targetGlyph: string | null;
  /** Whether the target is a secret spot, which claim_location() will refuse
   *  without a photo. Known at begin() time: public locations never carry
   *  this true, since locations_near() never sends a secret one to begin with. */
  targetIsSecret: boolean;
  /** Whether the target is today's Wildcard — a real, known location_id (so
   *  claim_location() can still be attempted on arrival) but deliberately no
   *  targetName/targetRarity/targetGlyph/targetLat/targetLng, the same way a
   *  secret spot's real coordinates never reach this store. See live.tsx for
   *  the compass this becomes instead of a distance readout, and
   *  trek/arrival.tsx for how the reveal is fetched fresh via useWildcard()
   *  rather than carried through here. */
  targetIsWildcard: boolean;
  /** Where the target sits, for the live distance readout. For a secret spot
   *  these are the fuzzed fence coordinates, not the real ones, so the live
   *  screen deliberately refuses to show metres for them (see live.tsx). */
  targetLat: number | null;
  targetLng: number | null;
  startedAt: number | null;

  /** Whether recording is currently suspended. See pause()/resume() below. */
  paused: boolean;
  /** Moving time banked from segments already closed by a pause, in ms.
   *  elapsedSeconds() adds the still-open segment (now - segmentStartedAt) to
   *  this, so a pause simply stops that addition rather than resetting it. */
  movingMs: number;
  /** Wall-clock start of the current unpaused segment, or null while paused. */
  segmentStartedAt: number | null;

  /** Refreshed from SQLite on a tick, not accumulated in memory. */
  points: LocalPoint[];
  distanceM: number;

  /** Self-reported, honour system: whether this trek is being walked with
   *  someone else, for the "with one other person" points multiplier. Not
   *  spoof-checked — the same trust level device_integrity already is —
   *  and toggleable mid-walk, since a partner can join partway through. */
  withPartner: boolean;

  /** Omit target for a free walk, aimed at nowhere in particular — see
   *  validate_trek() in 0015_untargeted_trek_scoring.sql for how that still
   *  earns points and counts toward the league without a claim. */
  begin(target?: {
    id: string;
    name?: string;
    isSecret?: boolean;
    isWildcard?: boolean;
    lat?: number;
    lng?: number;
    rarity?: string;
    glyph?: string;
  }): Promise<void>;
  refresh(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  arrive(): void;
  end(): Promise<void>;
  reset(): void;
  setWithPartner(withPartner: boolean): void;
};

export const useTrek = create<TrekState>((set, get) => ({
  phase: 'idle',
  trekId: null,
    targetLocationId: null,
    targetName: null,
    targetRarity: null,
    targetGlyph: null,
    targetIsSecret: false,
    targetIsWildcard: false,
    targetLat: null,
    targetLng: null,
    startedAt: null,
  paused: false,
  movingMs: 0,
  segmentStartedAt: null,
  points: [],
  distanceM: 0,
  withPartner: false,

  async begin(target) {
    const trekId = await startTrek(target?.id ?? null);
    const now = Date.now();
    set({
      phase: 'recording',
      trekId,
      targetLocationId: target?.id ?? null,
      targetName: target?.name ?? null,
      targetRarity: target?.rarity ?? null,
      targetGlyph: target?.glyph ?? null,
      targetIsSecret: Boolean(target?.isSecret),
      targetIsWildcard: Boolean(target?.isWildcard),
      targetLat: target?.lat ?? null,
      targetLng: target?.lng ?? null,
      startedAt: now,
      paused: false,
      movingMs: 0,
      segmentStartedAt: now,
      points: [],
      distanceM: 0,
      withPartner: false,
    });
  },

  /**
   * Pull the track back out of SQLite. Called on a timer by the live screen
   * rather than pushed from the background task, because that task runs in a
   * separate JS context and cannot reach this store.
   */
  refresh() {
    const { trekId } = get();
    if (!trekId) return;
    const points = getTrekPoints(trekId);
    set({ points, distanceM: trackDistanceM(points) });
  },

  /**
   * Suspend recording. Closes the current moving-time segment into `movingMs`
   * and tells the recorder to stop appending fixes, so nothing covered while
   * paused (a car ride, a rest stop) ever reaches the track — see pauseTrek()
   * for why that is the actual anti-cheat, not just a display nicety.
   */
  async pause() {
    const { phase, paused, segmentStartedAt, movingMs } = get();
    if (phase !== 'recording' || paused || segmentStartedAt === null) return;
    set({
      paused: true,
      movingMs: movingMs + (Date.now() - segmentStartedAt),
      segmentStartedAt: null,
    });
    await pauseTrek();
  },

  /** Opens a fresh moving-time segment and asks the recorder to resume fixes
   *  on the same (still-open) trek row. */
  async resume() {
    const { phase, paused } = get();
    if (phase !== 'recording' || !paused) return;
    set({ paused: false, segmentStartedAt: Date.now() });
    await resumeTrek();
  },

  arrive() {
    if (get().phase === 'recording') set({ phase: 'arrived' });
  },

  async end() {
    const { trekId } = get();
    if (trekId) await stopTrek(trekId);
    set({ phase: 'idle' });
  },

  reset() {
    set({
      phase: 'idle',
      trekId: null,
      targetLocationId: null,
      targetName: null,
      targetRarity: null,
      targetGlyph: null,
      targetIsSecret: false,
      targetIsWildcard: false,
      startedAt: null,
      paused: false,
      movingMs: 0,
      segmentStartedAt: null,
      points: [],
      distanceM: 0,
      withPartner: false,
    });
  },

  setWithPartner(withPartner) {
    set({ withPartner });
  },
}));

/**
 * Moving-time elapsed seconds: banked segments plus whatever the still-open
 * one has accrued. Derived rather than stored so it cannot drift, and frozen
 * automatically while paused since `segmentStartedAt` is null then.
 */
export function elapsedSeconds(state: { movingMs: number; segmentStartedAt: number | null }): number {
  const open = state.segmentStartedAt !== null ? Date.now() - state.segmentStartedAt : 0;
  return Math.max(0, Math.floor((state.movingMs + open) / 1000));
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
