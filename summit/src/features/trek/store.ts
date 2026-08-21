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
  /** Whether the target is a secret spot, which claim_location() will refuse
   *  without a photo. Known at begin() time: public locations never carry
   *  this true, since locations_near() never sends a secret one to begin with. */
  targetIsSecret: boolean;
  startedAt: number | null;

  /** Refreshed from SQLite on a tick, not accumulated in memory. */
  points: LocalPoint[];
  distanceM: number;

  /** Self-reported, honour system: whether this trek is being walked with
   *  someone else, for the "with one other person" points multiplier. Not
   *  spoof-checked — the same trust level device_integrity already is —
   *  and toggleable mid-walk, since a partner can join partway through. */
  withPartner: boolean;

  begin(target: { id: string; name: string; isSecret?: boolean }): Promise<void>;
  refresh(): void;
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
  targetIsSecret: false,
  startedAt: null,
  points: [],
  distanceM: 0,
  withPartner: false,

  async begin(target) {
    const trekId = await startTrek();
    set({
      phase: 'recording',
      trekId,
      targetLocationId: target.id,
      targetName: target.name,
      targetIsSecret: Boolean(target.isSecret),
      startedAt: Date.now(),
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
      targetIsSecret: false,
      startedAt: null,
      points: [],
      distanceM: 0,
      withPartner: false,
    });
  },

  setWithPartner(withPartner) {
    set({ withPartner });
  },
}));

/** Elapsed seconds, derived rather than stored so it cannot drift. */
export function elapsedSeconds(startedAt: number | null): number {
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
