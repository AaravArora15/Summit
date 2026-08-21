/**
 * The screens' data layer.
 *
 * Every hook here returns the shape the screen already renders, so switching a
 * tab from placeholder to live is a change of source and nothing else. That is
 * the promise lib/demo-data.ts was written to keep, and this is where it gets
 * kept.
 *
 * Two rules hold throughout:
 *
 * **Demo data is the fallback, not the default.** When Supabase is
 * unconfigured, or the session has not resolved yet, the hook returns the demo
 * row and reports `isDemo`. The app stays reviewable without a backend, which
 * is what makes the design inspectable, and no screen has to know about it.
 *
 * **A failed fetch is not an empty screen.** react-query holds the last good
 * value and these hooks fall back to demo rather than to zeros, because the
 * trail is where this app is used and the trail has no signal. A collection
 * that reads "0 of 163" because a request timed out is worse than one that is
 * briefly stale.
 *
 * The distinction those two rules turn on: "there is no backend to ask" and
 * "the backend says you have none" are different answers and must not share a
 * fallback. A new account holds no badges, and filling its Latest strip with
 * three invented ones is not a graceful degradation, it is a lie. So demo data
 * stands in only while there is nobody to ask; once a query succeeds, its
 * answer is used even when the answer is empty, and the screen shows the empty
 * state it was designed with.
 */
import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import {
  DEMO_COLLECTION,
  DEMO_LEAGUE,
  DEMO_LOCATIONS,
  DEMO_PROFILE,
  DEMO_RECENT_BADGES,
  DEMO_SET_PROGRESS,
  DEMO_STANDINGS,
} from '@/lib/demo-data';
import {
  isSupabaseConfigured,
  leagueStandings,
  myCollection,
  myLeague,
  myProfile,
  myRecentBadges,
  mySetProgress,
  setCompleteBonusPoints,
  setLocations,
  type CollectionRow,
  type LeagueRow,
  type ProfileRow,
  type RecentBadgeRow,
  type SetLocationRow,
  type SetProgressRow,
  type StandingRow,
} from '@/lib/supabase';
import { setColour } from '@/theme/tokens';

export type Live<T> = {
  data: T;
  /** True when `data` came from demo-data.ts rather than the database. */
  isDemo: boolean;
  isLoading: boolean;
};

/**
 * Runs `fetcher` when there is a session to run it under, and hands back `demo`
 * until there is one.
 *
 * `map` may return null, which means "the query came back but there is no row
 * here" — a profile that does not exist, a league not yet joined. That is an
 * anomaly rather than an empty state, so it falls back to demo. An empty
 * *list*, by contrast, is a real answer and is passed straight through: see
 * the note at the top of this file for why that distinction matters.
 */
function useLive<Row, T>(
  key: string,
  fetcher: () => Promise<Row>,
  map: (row: Row) => T | null,
  demo: T,
): Live<T> {
  const session = useSession();
  const enabled = isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: [key, session.status === 'signed-in' ? session.userId : null],
    queryFn: fetcher,
    enabled,
  });

  const mapped = query.isSuccess ? map(query.data) : null;

  return {
    data: mapped ?? demo,
    isDemo: mapped === null,
    isLoading: enabled && query.isLoading,
  };
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                    */
/* -------------------------------------------------------------------------- */

export type ProfileView = {
  name: string;
  /**
   * What a greeting calls you. The first word of the display name, because
   * "Good evening, Climber #0003" wraps onto two lines and reads like a
   * receipt, while "Good evening, Climber" reads like a greeting.
   */
  shortName: string;
  initials: string;
  title: string | null;
  explorerNumber: number | null;
  standing: string;
  /** Drives the rust ring on the passport avatar, which is earned, not decoration. */
  isFounding: boolean;
  level: number;
  xp: number;
  xpToNextLevel: number;
  counters: { label: string; value: number }[];
  treksThisMonth: number;
};

/**
 * Titles are earned by finishing sets, one per set. There is no titles table:
 * a set completion is already the achievement, and a second table that only
 * ever mirrors it would be two things to keep in step.
 *
 * Null until one is earned, and the chip is then not drawn at all. The
 * alternative was a filler title, which put "Founding Climber" in a chip
 * directly above a line already reading "Founding pioneer" — the same fact
 * twice, and a title that costs nothing devalues the ones that do.
 */
function titleFor(setsCompleted: number): string | null {
  if (setsCompleted >= 6) return 'Keeper of Stones';
  if (setsCompleted >= 3) return 'Set Collector';
  if (setsCompleted >= 1) return 'Completionist';
  return null;
}

export function useProfile(): Live<ProfileView> {
  return useLive<ProfileRow | null, ProfileView>(
    'profile',
    myProfile,
    (row) =>
      row && {
        name: row.display_name,
        shortName: row.display_name.split(' ')[0] || row.display_name,
        initials: row.initials || 'C',
        title: titleFor(row.sets_completed),
        explorerNumber: row.explorer_number,
        isFounding: row.is_founding,
        standing: row.is_founding
          ? 'Founding pioneer'
          : row.city_name
            ? `Climber in ${row.city_name}`
            : 'Climber',
        level: row.level,
        xp: row.xp_into_level,
        xpToNextLevel: row.xp_for_level,
        counters: [
          { label: 'Badges', value: row.badges },
          { label: 'Numbers', value: row.numbers },
          { label: 'Spots', value: row.spots },
          { label: 'Sets', value: row.sets_completed },
        ],
        treksThisMonth: row.treks_this_month,
      },
    {
      name: DEMO_PROFILE.name,
      shortName: DEMO_PROFILE.name.split(' ')[0],
      initials: DEMO_PROFILE.initials,
      title: DEMO_PROFILE.title,
      explorerNumber: DEMO_PROFILE.explorerNumber,
      isFounding: true,
      standing: DEMO_PROFILE.standing,
      level: DEMO_PROFILE.level,
      xp: DEMO_PROFILE.xp,
      xpToNextLevel: DEMO_PROFILE.xpToNextLevel,
      counters: [...DEMO_PROFILE.counters],
      treksThisMonth: DEMO_PROFILE.treksThisMonth,
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Collection                                                                 */
/* -------------------------------------------------------------------------- */

export type CollectionView = {
  owned: number;
  total: number;
  byRarity: { rarity: string; held: number }[];
  pioneerNumbersHeld: number;
  bestPioneerNumber: { number: number; location: string } | null;
  setsCompleted: number;
  setsTotal: number;
  titlesUnlocked: number;
};

export function useCollection(): Live<CollectionView> {
  return useLive<CollectionRow | null, CollectionView>(
    'collection',
    myCollection,
    (row) =>
      row && {
        owned: row.owned,
        // A denominator of zero would divide the progress ring by nothing.
        total: Math.max(1, row.total),
        byRarity: [
          { rarity: 'common', held: row.common_held },
          { rarity: 'rare', held: row.rare_held },
          { rarity: 'epic', held: row.epic_held },
          { rarity: 'legendary', held: row.legendary_held },
        ],
        pioneerNumbersHeld: row.numbers_held,
        bestPioneerNumber:
          row.best_number !== null
            ? {
                number: row.best_number,
                location: row.best_number_location ?? '',
              }
            : null,
        setsCompleted: row.sets_completed,
        setsTotal: row.sets_total,
        titlesUnlocked: row.sets_completed,
      },
    {
      owned: DEMO_COLLECTION.owned,
      total: DEMO_COLLECTION.total,
      byRarity: DEMO_COLLECTION.byRarity.map((r) => ({ ...r })),
      pioneerNumbersHeld: DEMO_COLLECTION.pioneerNumbersHeld,
      bestPioneerNumber: { ...DEMO_COLLECTION.bestPioneerNumber },
      setsCompleted: DEMO_COLLECTION.setsCompleted,
      setsTotal: DEMO_COLLECTION.setsTotal,
      titlesUnlocked: DEMO_COLLECTION.titlesUnlocked,
    },
  );
}

export type SetProgressView = {
  /** The set's real uuid when live, or its demo `key` as a stand-in when not
   *  (set/[id].tsx tells the two apart with a uuid-shape check). Either way,
   *  it is what a set card should pass as the route param to open it. */
  setId: string;
  key: string;
  name: string;
  held: number;
  total: number;
  tint: string;
  nextLocationName: string | null;
  /** 1 to 4, matching locations.difficulty. Null when the set is complete. */
  nextLocationDifficulty: number | null;
};

export function useSetProgress(): Live<SetProgressView[]> {
  return useLive<SetProgressRow[], SetProgressView[]>(
    'set-progress',
    mySetProgress,
    (rows) =>
      rows.map((r) => ({
        setId: r.set_id,
        key: r.key,
        name: r.name,
        held: r.held,
        // Guards the progress bar: a set with no open locations in it yet
        // is a seeding state, not a completed set.
        total: Math.max(1, r.total),
        // The set's colour comes from the database, because the sets board
        // is the one place a colour carries meaning and it has to agree
        // with what the server thinks the set is. The token is the
        // fallback for a set seeded without one.
        tint: r.colour || setColour[r.key as keyof typeof setColour] || setColour.rainforest,
        nextLocationName: r.next_location_name,
        nextLocationDifficulty: r.next_location_difficulty,
      })),
    DEMO_SET_PROGRESS.map((s) => ({
      setId: s.set,
      key: s.set,
      name: s.name,
      held: s.held,
      total: s.total,
      tint: setColour[s.set],
      nextLocationName: null,
      nextLocationDifficulty: null,
    })),
  );
}

export type RecentBadgeView = {
  id: string;
  band: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  glyph: string;
};

/** The badge band is a short name: the tile is 62 px and the full one will not fit. */
export function shortBand(name: string): string {
  const compact = name.replace(/\s+/g, '');
  return compact.length <= 8 ? compact : `${compact.slice(0, 7)}.`;
}

/**
 * Which glyph a badge wears. Keyed off the set rather than the location, so a
 * newly seeded location gets a sensible icon without a per-location asset.
 */
export const SET_GLYPH: Record<string, string> = {
  rainforest: 'tree',
  reservoir: 'drop',
  coastal: 'drop',
  heritage: 'fort',
  urban: 'ridge',
  islands: 'ridge',
};

export function useRecentBadges(limit = 3): Live<RecentBadgeView[]> {
  return useLive<RecentBadgeRow[], RecentBadgeView[]>(
    'recent-badges',
    () => myRecentBadges(limit),
    (rows) =>
      rows.map((r) => ({
        id: r.claim_id,
        band: shortBand(r.name),
        rarity: r.rarity,
        glyph: (r.set_key && SET_GLYPH[r.set_key]) || 'ridge',
      })),
    DEMO_RECENT_BADGES.map((b) => ({ ...b })),
  );
}

/* -------------------------------------------------------------------------- */
/* League                                                                     */
/* -------------------------------------------------------------------------- */

export type LeagueView = {
  month: string;
  resetsOn: string;
  /** Just the date, for prose that has to name the day the wipe happens. */
  resetsOnLabel: string;
  tiers: string[];
  /** Zero-based index into `tiers`, which is what the tier meter wants. */
  tierIndex: number;
  rank: number;
  divisionSize: number;
  points: number;
  promotionCutoff: number;
  relegationCutoff: number;
  pointsToPromotion: number;
  promotionInTreks: string;
  daysLeft: number;
};

const TIER_NAMES = ['Trailhead', 'Foothills', 'Ridgeline', 'Highlands', 'Summit'];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The gap, translated into something you could do on a Saturday.
 *
 * A points number is not actionable on its own: nobody knows what 380 points
 * is. Distance is the only currency everyone already has an instinct for, so
 * the gap is divided by the distance rate (1 point per 100 m) and rounded to
 * something you would actually say out loud.
 */
function gapInTreks(points: number): string {
  // Empty when there is no gap. The card that renders this says "holding a
  // promotion place" on its other half, and printing the same fact twice in
  // one row is how a card stops being read at all.
  if (points <= 0) return '';
  const km = Math.max(1, Math.round((points * 100) / 1000));
  if (km <= 12) return `≈ one ${km} km trek`;
  return `≈ ${Math.ceil(km / 8)} good treks`;
}

export function useLeague(): Live<LeagueView> {
  return useLive<LeagueRow | null, LeagueView>(
    'league',
    myLeague,
    (row) => {
      if (!row) return null;
      const period = new Date(`${row.period}T00:00:00Z`);
      const reset = new Date(`${row.resets_on}T00:00:00Z`);
      const resetsOnLabel = `${reset.getUTCDate()} ${MONTHS[reset.getUTCMonth()]}`;
      return {
        month: `${MONTHS[period.getUTCMonth()]} league`,
        resetsOn: `Resets ${resetsOnLabel} · ${row.days_left} day${row.days_left === 1 ? '' : 's'}`,
        resetsOnLabel,
        tiers: TIER_NAMES,
        tierIndex: Math.max(0, row.tier_index - 1),
        rank: row.rank,
        divisionSize: row.division_size,
        points: row.points,
        promotionCutoff: row.promotion_cutoff,
        relegationCutoff: row.relegation_cutoff,
        pointsToPromotion: row.points_to_promotion,
        promotionInTreks: gapInTreks(row.points_to_promotion),
        daysLeft: row.days_left,
      };
    },
    {
      month: DEMO_LEAGUE.month,
      resetsOn: DEMO_LEAGUE.resetsOn,
      resetsOnLabel: '1 September',
      tiers: [...DEMO_LEAGUE.tiers],
      tierIndex: DEMO_LEAGUE.tierIndex,
      rank: DEMO_LEAGUE.position,
      divisionSize: DEMO_LEAGUE.divisionSize,
      points: 6420,
      promotionCutoff: DEMO_LEAGUE.promotionCutoff,
      relegationCutoff: DEMO_LEAGUE.relegationCutoff,
      pointsToPromotion: DEMO_LEAGUE.pointsToPromotion,
      promotionInTreks: DEMO_LEAGUE.promotionInTreks,
      daysLeft: 15,
    },
  );
}

export type StandingView = {
  rank: number;
  name: string;
  initials: string;
  tint: string;
  points: number;
  treks: number;
  isYou?: boolean;
  detail?: string;
};

/**
 * Avatar tints. Decorative only: they carry no rarity or set meaning, so they
 * are assigned from the user id rather than from anything about the person.
 * Stable across renders and across devices, which a random pick would not be.
 */
const TINTS = ['#7A8D99', '#A65A3A', '#6F8F75', '#1F3D2E', '#4A4740', '#46707F'];

function tintFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

export function useStandings(around = 2): Live<StandingView[]> {
  return useLive<StandingRow[], StandingView[]>(
    'standings',
    () => leagueStandings(around),
    (rows) =>
      rows.map((r) => ({
        rank: r.rank,
        name: r.is_you ? 'You' : r.name,
        initials: r.initials || '?',
        tint: r.is_you ? '#DCC6A1' : tintFor(r.user_id),
        points: r.points,
        treks: r.treks,
        isYou: r.is_you,
        // Only "you" gets a second line, and only because it is worth the
        // space: it is the one row where the trek count means something
        // you can act on.
        detail: r.is_you
          ? `${r.treks} trek${r.treks === 1 ? '' : 's'} · ${Math.round(
              Number(r.distance_m) / 1000,
            )} km`
          : undefined,
      })),
    DEMO_STANDINGS.map((r) => ({ ...r })),
  );
}

/* -------------------------------------------------------------------------- */
/* Set detail                                                                 */
/* -------------------------------------------------------------------------- */

/** A uuid, roughly. Enough to tell a real set_id from a demo `key` like "reservoir". */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SetLocationView = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  claimed: boolean;
  pioneerNumber: number | null;
};

/**
 * Every open location in one set, held or not.
 *
 * Not built on `useLive`: that helper's `enabled` only ever depends on the
 * session, and this query also has to skip itself when `setId` is a demo key
 * rather than a real uuid, so a signed-in user tapping into a demo set (which
 * cannot happen from a live screen, but this hook has no way to know that)
 * does not send a garbage uuid to Postgres.
 */
export function useSetLocations(setId: string): Live<SetLocationView[]> {
  const session = useSession();
  const isLiveId = UUID_RE.test(setId);
  const enabled = isSupabaseConfigured && session.status === 'signed-in' && isLiveId;

  const query = useQuery({
    queryKey: ['set-locations', setId],
    queryFn: () => setLocations(setId),
    enabled,
  });

  const mapped = query.isSuccess
    ? query.data.map((r: SetLocationRow) => ({
        id: r.id,
        name: r.name,
        rarity: r.rarity,
        difficulty: r.difficulty,
        claimed: r.claimed,
        pioneerNumber: r.pioneer_number,
      }))
    : null;

  const demo = DEMO_LOCATIONS.filter((l) => l.set === setId).map((l) => ({
    id: l.id,
    name: l.name,
    rarity: l.rarity,
    difficulty: l.difficulty,
    claimed: l.claimed, // always false in demo-data.ts, so never a real number either
    pioneerNumber: null,
  }));

  return {
    data: mapped ?? demo,
    isDemo: mapped === null,
    isLoading: enabled && query.isLoading,
  };
}

/** The points a finished set pays. 750 matches set_complete_bonus_points() as
 *  it stands today; the fallback is a value, not a guess, but it can drift if
 *  that function's constant ever changes without this one following. */
export function useSetCompleteBonus(): Live<number> {
  const session = useSession();
  const enabled = isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: ['set-complete-bonus'],
    queryFn: setCompleteBonusPoints,
    enabled,
    staleTime: Infinity, // a fixed rule, not something that changes mid-session
  });

  const mapped = query.isSuccess ? query.data : null;

  return {
    data: mapped ?? 750,
    isDemo: mapped === null,
    isLoading: enabled && query.isLoading,
  };
}
