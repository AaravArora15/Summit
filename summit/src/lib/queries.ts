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
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import {
  DEMO_BADGES,
  DEMO_COLLECTION,
  DEMO_GROUP,
  DEMO_LEAGUE,
  DEMO_LOCATIONS,
  DEMO_PROFILE,
  DEMO_RECENT_BADGES,
  DEMO_SET_PROGRESS,
  DEMO_STANDINGS,
  DEMO_SUGGESTIONS,
  DEMO_TERRITORIES,
  DEMO_TERRITORY_LEADERBOARD,
  DEMO_TERRITORY_LOCATIONS,
  DEMO_TREKS,
  DEMO_WILDCARD_LOCATION,
} from '@/lib/demo-data';
import {
  approveSuggestion,
  claimRunStats,
  createGroup,
  groupStandings,
  isSupabaseConfigured,
  leagueStandings,
  myBadges,
  myCollection,
  myGroup,
  myGroupRequest,
  myLeague,
  myProfile,
  myRecentBadges,
  mySetProgress,
  mySuggestions,
  myTerritories,
  myTreks,
  myWildcard,
  pendingJoinRequests,
  pendingSuggestions,
  rejectSuggestion,
  renameDisplay,
  rerollWildcard,
  requestJoinGroup,
  respondJoinRequest,
  setCompleteBonusPoints,
  setLocations,
  territoryLeaderboard,
  territoryLocations,
  type BadgeRow,
  type CollectionRow,
  type GroupStandingRow,
  type LeagueRow,
  type PendingJoinRequestRow,
  type PendingSuggestionRow,
  type ProfileRow,
  type RecentBadgeRow,
  type SetLocationRow,
  type SetProgressRow,
  type StandingRow,
  type SuggestionRow,
  type TerritoryRow,
  type TrekRow,
  type WildcardRow,
} from '@/lib/supabase';
import { estimateRunStats, type RunStats } from '@/features/trek/run-stats';
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
  /** Gates the suggestion-review screen — see settings.tsx and review.tsx. */
  isAdmin: boolean;
  level: number;
  xp: number;
  xpToNextLevel: number;
  counters: { label: string; value: number }[];
  treksThisMonth: number;
};

export function useProfile(): Live<ProfileView> {
  return useLive<ProfileRow | null, ProfileView>(
    'profile',
    myProfile,
    (row) =>
      row && {
        name: row.display_name,
        shortName: row.display_name.split(' ')[0] || row.display_name,
        initials: row.initials || 'C',
        // Earned by finishing a whole set — the name of the most recently
        // completed one, e.g. "Trails Keeper" — computed server-side in
        // my_profile() (0022), not derived here. Null until one is earned,
        // and the chip is then not drawn at all: a filler title devalues the
        // ones that cost something.
        title: row.title,
        explorerNumber: row.explorer_number,
        isFounding: row.is_founding,
        isAdmin: row.is_admin,
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
      isAdmin: false,
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
        tint: r.colour || setColour[r.key as keyof typeof setColour] || setColour.trail,
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
  /** The place the badge is for, so a tap can open it on the map. */
  locationId: string;
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
  summit: 'ridge',
  trail: 'tree',
  expedition: 'fort',
  coastal: 'drop',
  canyon: 'ridge',
  park: 'tree',
  urban: 'ridge',
};

export function useRecentBadges(limit = 3): Live<RecentBadgeView[]> {
  return useLive<RecentBadgeRow[], RecentBadgeView[]>(
    'recent-badges',
    () => myRecentBadges(limit),
    (rows) =>
      rows.map((r) => ({
        id: r.claim_id,
        locationId: r.location_id,
        band: shortBand(r.name),
        rarity: r.rarity,
        glyph: (r.set_key && SET_GLYPH[r.set_key]) || 'ridge',
      })),
    DEMO_RECENT_BADGES.map((b) => ({ ...b, locationId: b.id })),
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
 *
 * Exported because the Groups panel asks the same question of its own
 * gap-to-first, and the answer should not fork.
 */
export function gapInTreks(points: number): string {
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

/**
 * The whole division, #1 to #42.
 *
 * Used to be a window of you-plus-two, on the argument that forty-two rows is
 * a scroll nobody reads. The screen now draws the promotion and relegation
 * boundaries through the list where they fall, which needs every row between
 * you and the line to make the scroll mean something: the point of the full
 * board is seeing how far the gap runs, not just that it exists.
 *
 * `p_around` above the division size (42 is the cap) returns everything.
 */
export function useStandings(): Live<StandingView[]> {
  return useLive<StandingRow[], StandingView[]>(
    'standings',
    () => leagueStandings(999),
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
/* -------------------------------------------------------------------------- */
/* Groups                                                                     */
/* -------------------------------------------------------------------------- */

export type GroupView = {
  groupId: string;
  name: string;
  inviteCode: string;
  memberCount: number;
  isLeader: boolean;
};

export type GroupStandingView = {
  rank: number;
  name: string;
  initials: string;
  tint: string;
  points: number;
  isYou?: boolean;
  isLeader?: boolean;
};

export type GroupRequestView = {
  requestId: string;
  groupName: string;
  leaderName: string;
  status: 'pending' | 'rejected';
};

export type JoinRequestView = {
  id: string;
  name: string;
  initials: string;
  tint: string;
  /** ISO timestamp; the screen renders it as "asked 5m ago". */
  createdAt: string;
};

function demoGroup(): GroupView {
  return {
    groupId: 'demo',
    name: DEMO_GROUP.name,
    inviteCode: DEMO_GROUP.inviteCode,
    memberCount: DEMO_GROUP.memberCount,
    isLeader: true,
  };
}

/**
 * Your group, or the absence of one.
 *
 * Not built on `useLive`, for a reason stated in this file's header but worth
 * repeating here: useLive treats "the query came back and there is no row" as
 * an anomaly. For groups it is the ordinary state -- most accounts have never
 * joined one -- so null is passed through as a real answer, and demo stands in
 * only while there is nobody to ask (or the ask failed).
 *
 * Polls at thirty seconds because acceptance happens on someone else's device:
 * the moment a leader lets you in, the empty state should become your group
 * without anyone pulling to refresh.
 */
export function useMyGroup(): { group: GroupView | null; isDemo: boolean; isLoading: boolean } {
  const session = useSession();
  const enabled = isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: ['my-group', session.status === 'signed-in' ? session.userId : null],
    queryFn: myGroup,
    enabled,
    refetchInterval: 30_000,
  });

  const mapped: GroupView | null =
    query.isSuccess && query.data
      ? {
          groupId: query.data.group_id,
          name: query.data.name,
          inviteCode: query.data.invite_code,
          memberCount: query.data.member_count,
          // leader_id compared against the session rather than trusted to a
          // boolean column, so there is one fewer fact that can drift.
          isLeader:
            session.status === 'signed-in' && query.data.leader_id === session.userId,
        }
      : null;

  if (!enabled) return { group: demoGroup(), isDemo: true, isLoading: false };
  if (query.isPending) return { group: null, isDemo: false, isLoading: true };
  if (query.isError) return { group: demoGroup(), isDemo: true, isLoading: false };
  return { group: mapped, isDemo: false, isLoading: false };
}

/** Standings inside the caller's group. Only fetched when a group exists. */
export function useGroupStandings(enabled: boolean): { data: GroupStandingView[] } {
  const session = useSession();
  const live = enabled && isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: ['group-standings', session.status === 'signed-in' ? session.userId : null],
    queryFn: groupStandings,
    enabled: live,
    refetchInterval: 30_000,
  });

  const data = query.isSuccess
    ? query.data.map((r: GroupStandingRow) => ({
        rank: r.rank,
        name: r.is_you ? 'You' : r.name,
        initials: r.initials || '?',
        tint: r.is_you ? '#DCC6A1' : tintFor(r.user_id),
        points: r.points,
        isYou: r.is_you,
        isLeader: r.is_leader,
      }))
    : DEMO_GROUP.standings.map((row) => ({
        rank: row.rank,
        name: row.name,
        initials: row.initials,
        tint: row.tint,
        points: row.points,
        isYou: row.isYou ?? false,
        isLeader: row.rank === 1,
      }));

  return { data };
}

/** The caller's most recent outgoing join request that still means something. */
export function useMyGroupRequest(enabled: boolean): { request: GroupRequestView | null } {
  const session = useSession();
  const live = enabled && isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: ['my-group-request', session.status === 'signed-in' ? session.userId : null],
    queryFn: myGroupRequest,
    enabled: live,
    refetchInterval: 20_000,
  });

  const request =
    query.isSuccess && query.data
      ? {
          requestId: query.data.request_id,
          groupName: query.data.group_name,
          leaderName: query.data.leader_name,
          status: query.data.status,
        }
      : null;

  return { request };
}

/**
 * The leader's inbox, polled every fifteen seconds. This polling IS the ping:
 * there is no push infrastructure behind a join request, so the badge on the
 * Groups segment and the card at the top of its panel are fed by the same
 * timer, and a request surfaces within seconds of being asked.
 */
export function usePendingJoinRequests(enabled: boolean): { data: JoinRequestView[] } {
  const session = useSession();
  const live = enabled && isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: ['group-join-requests', session.status === 'signed-in' ? session.userId : null],
    queryFn: pendingJoinRequests,
    enabled: live,
    refetchInterval: 15_000,
  });

  return {
    data: query.isSuccess
      ? query.data.map((r: PendingJoinRequestRow) => ({
          id: r.request_id,
          name: r.name,
          initials: r.initials || '?',
          tint: tintFor(r.user_id),
          createdAt: r.created_at,
        }))
      : [],
  };
}

function invalidateGroups(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: ['my-group'] });
  queryClient.invalidateQueries({ queryKey: ['group-standings'] });
  queryClient.invalidateQueries({ queryKey: ['my-group-request'] });
  queryClient.invalidateQueries({ queryKey: ['group-join-requests'] });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createGroup(name),
    onSuccess: () => invalidateGroups(queryClient),
  });
}

export function useRequestToJoin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => requestJoinGroup(code),
    onSuccess: () => invalidateGroups(queryClient),
  });
}

export function useRespondToJoinRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, accept }: { requestId: string; accept: boolean }) =>
      respondJoinRequest(requestId, accept),
    onSuccess: () => invalidateGroups(queryClient),
  });
}

/**
 * A rename is not a profile-screen fact. The display_name flows into the
 * league card and standings, the group header and standings, join-request
 * inboxes -- every cache holding a name must be allowed to go stale at once,
 * or the app briefly disagrees with itself about who you are.
 */
export function useRename() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => renameDisplay(name),
    onSuccess: () => {
      for (const key of ['profile', 'league', 'standings']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      invalidateGroups(queryClient);
    },
  });
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
  status: string;
  statusNote: string | null;
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
        status: r.status,
        statusNote: r.status_note,
      }))
    : null;

  const demo = DEMO_LOCATIONS.filter((l) => l.set === setId).map((l) => ({
    id: l.id,
    name: l.name,
    rarity: l.rarity,
    difficulty: l.difficulty,
    claimed: l.claimed, // always false in demo-data.ts, so never a real number either
    pioneerNumber: null,
    status: l.status,
    statusNote: l.status_note,
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

/* -------------------------------------------------------------------------- */
/* Badge browser                                                              */
/* -------------------------------------------------------------------------- */

export type BadgeView = {
  id: string;
  /** The place the badge is for, so a tap can open it on the map. */
  locationId: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  glyph: string;
  setName: string | null;
  pioneerNumber: number | null;
};

export function useBadges(): Live<BadgeView[]> {
  return useLive<BadgeRow[], BadgeView[]>(
    'badges',
    myBadges,
    (rows) =>
      rows.map((r) => ({
        id: r.claim_id,
        locationId: r.location_id,
        name: r.name,
        rarity: r.rarity,
        difficulty: r.difficulty,
        glyph: (r.set_key && SET_GLYPH[r.set_key]) || 'ridge',
        setName: r.set_name,
        pioneerNumber: r.pioneer_number,
      })),
    DEMO_BADGES.map((b) => ({
      id: b.id,
      locationId: b.id,
      name: b.name,
      rarity: b.rarity,
      difficulty: b.difficulty,
      glyph: b.glyph,
      setName: b.setName,
      pioneerNumber: b.pioneerNumber,
    })),
  );
}

/**
 * The run behind one held badge, for the badge browser's detail view (see
 * badges.tsx). Not built on useLive() above: that helper is one query per
 * screen, keyed by session id, while this is one query per *badge* — the
 * claim id changes every time a different shield is tapped.
 *
 * Live and demo both resolve to the same RunStats shape (features/trek/
 * run-stats.ts), which already carries its own `isEstimated`: a real trek's
 * own numbers when claim_run_stats() found one that was not a
 * dev-fake-claim.ts shortcut, otherwise a generic estimate built from the
 * location's own distance_m/avg_time_min/difficulty. Demo mode has no
 * backend to ask at all, so every demo badge is the estimate — same honesty
 * rule as everywhere else demo data stands in for a live read.
 */
export function useBadgeRunStats(
  badge: BadgeView | null,
  isDemoBadge: boolean,
): { data: RunStats | null; isLoading: boolean } {
  const session = useSession();
  const enabled = !isDemoBadge && isSupabaseConfigured && session.status === 'signed-in' && badge !== null;

  const query = useQuery({
    queryKey: ['claim-run-stats', badge?.id ?? null],
    queryFn: () => claimRunStats(badge!.id),
    enabled,
  });

  if (!badge) return { data: null, isLoading: false };
  if (!enabled) return { data: estimateRunStats(badge.difficulty), isLoading: false };
  if (!query.data) return { data: null, isLoading: query.isLoading };

  const row = query.data;
  const data =
    row.distance_m !== null && row.moving_time_s !== null
      ? { distanceM: row.distance_m, movingTimeS: row.moving_time_s, isEstimated: false }
      : estimateRunStats(row.difficulty, row.location_distance_m, row.location_avg_time_min);

  return { data, isLoading: false };
}

/* -------------------------------------------------------------------------- */
/* Trek journal                                                               */
/* -------------------------------------------------------------------------- */

export type TrekView = {
  id: string;
  /** "16 Aug", matching how the rest of the app writes a short date. */
  dateLabel: string;
  distanceKm: number;
  movingTimeS: number;
  status: TrekRow['status'];
  locationName: string | null;
  pioneerNumber: number | null;
  pointsEarned: number;
};

const TREK_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function trekDateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${TREK_MONTHS[d.getMonth()]}`;
}

export function useTreks(limit = 30): Live<TrekView[]> {
  return useLive<TrekRow[], TrekView[]>(
    'treks',
    () => myTreks(limit),
    (rows) =>
      rows.map((r) => ({
        id: r.id,
        dateLabel: trekDateLabel(r.started_at),
        distanceKm: (r.distance_m ?? 0) / 1000,
        movingTimeS: r.moving_time_s ?? 0,
        status: r.status,
        locationName: r.location_name,
        pioneerNumber: r.pioneer_number,
        pointsEarned: r.points_earned ?? 0,
      })),
    DEMO_TREKS.map((t) => ({
      id: t.id,
      dateLabel: trekDateLabel(t.startedAt),
      distanceKm: t.distanceM / 1000,
      movingTimeS: t.movingTimeS,
      status: t.status,
      locationName: t.locationName,
      pioneerNumber: t.pioneerNumber,
      pointsEarned: t.pointsEarned,
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Wildcard — "where do I go today?"                                         */
/* -------------------------------------------------------------------------- */

/**
 * `{ kind: 'none' }` is a real, valid answer here — every open, non-secret
 * location already claimed — not the "nothing to show, fall back to demo"
 * signal useLive()'s own `map` convention normally reads a bare `null` as.
 * So the map below never returns `null` itself; it returns this instead,
 * and useLive()'s ordinary null-check keeps working for its actual job
 * (falling back to demo when there is no backend to ask at all).
 */
export type WildcardView =
  | { kind: 'none' }
  | {
      kind: 'active';
      id: string;
      locationId: string;
      /** Real hints, always present: rarity/difficulty narrow the hunt down
       *  without saying where. */
      rarity: 'common' | 'rare' | 'epic' | 'legendary';
      difficulty: 1 | 2 | 3 | 4;
      /** The actual answer — null until `claimed`, at which point it's the
       *  reveal (see badges.tsx's own claimed-badge detail for the same
       *  pattern: nothing here lies about what is known yet). */
      name: string | null;
      glyph: string | null;
      setName: string | null;
      assignedAt: string;
      expiresAt: string;
      rerolled: boolean;
      claimed: boolean;
    };

/** A fresh 24-hour window every time this is actually used — demo mode has
 *  no stored "assigned at" to read back, so it presents as if today's pick
 *  just landed, same as a real one freshly assigned would. Withholds name
 *  the same way a real fresh pick would: a first-time real user sees
 *  exactly this shape, not a "found" state most users won't reach today. */
function demoWildcard(): WildcardView {
  const now = Date.now();
  return {
    kind: 'active',
    id: 'demo-wildcard',
    locationId: DEMO_WILDCARD_LOCATION.locationId,
    rarity: DEMO_WILDCARD_LOCATION.rarity,
    difficulty: DEMO_WILDCARD_LOCATION.difficulty,
    name: null,
    glyph: null,
    setName: null,
    assignedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    rerolled: false,
    claimed: false,
  };
}

export function useWildcard(): Live<WildcardView> {
  return useLive<WildcardRow | null, WildcardView>(
    'wildcard',
    myWildcard,
    (row): WildcardView =>
      row
        ? {
            kind: 'active',
            id: row.wildcard_id,
            locationId: row.location_id,
            rarity: row.rarity,
            difficulty: row.difficulty,
            name: row.name,
            glyph: row.set_key ? (SET_GLYPH[row.set_key] ?? 'ridge') : null,
            setName: row.set_name,
            assignedAt: row.assigned_at,
            expiresAt: row.expires_at,
            rerolled: row.rerolled,
            claimed: row.claimed,
          }
        : { kind: 'none' },
    demoWildcard(),
  );
}

/** Throws with the server's message ("already rerolled...", "already
 *  claimed...", "nothing else to reroll to") on refusal — the card shows it
 *  rather than silently doing nothing. */
export function useRerollWildcard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rerollWildcard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wildcard'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Territories — Capture Territory                                           */
/* -------------------------------------------------------------------------- */

export type TerritoryView = {
  territoryId: string;
  name: string;
  held: number;
  total: number;
  captured: boolean;
  durationS: number | null;
  bestDurationS: number | null;
};

/** Every territory that exists, closest-to-captured first — same ordering
 *  my_set_progress() already uses for sets. */
export function useTerritories(): Live<TerritoryView[]> {
  return useLive<TerritoryRow[], TerritoryView[]>(
    'territories',
    myTerritories,
    (rows) =>
      rows.map((r) => ({
        territoryId: r.territory_id,
        name: r.name,
        held: r.held,
        total: r.total,
        captured: r.captured,
        durationS: r.duration_s,
        bestDurationS: r.best_duration_s,
      })),
    DEMO_TERRITORIES.map((t) => ({ ...t })),
  );
}

export type TerritoryLocationView = {
  id: string;
  name: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  difficulty: 1 | 2 | 3 | 4;
  claimed: boolean;
  pioneerNumber: number | null;
  claimedAt: string | null;
};

/** Every member location of one territory. Not built on useLive() — same
 *  reason useSetLocations() (below) isn't: a demo territory id is a string
 *  key, not a uuid, and this has to skip the live query rather than send a
 *  garbage uuid to Postgres for it. */
export function useTerritoryLocations(territoryId: string): Live<TerritoryLocationView[]> {
  const session = useSession();
  const isLiveId = UUID_RE.test(territoryId);
  const enabled = isSupabaseConfigured && session.status === 'signed-in' && isLiveId;

  const query = useQuery({
    queryKey: ['territory-locations', territoryId],
    queryFn: () => territoryLocations(territoryId),
    enabled,
  });

  const mapped = query.isSuccess
    ? query.data.map((r) => ({
        id: r.id,
        name: r.name,
        rarity: r.rarity,
        difficulty: r.difficulty,
        claimed: r.claimed,
        pioneerNumber: r.pioneer_number,
        claimedAt: r.claimed_at,
      }))
    : null;

  return {
    data: mapped ?? (DEMO_TERRITORY_LOCATIONS[territoryId] ?? []),
    isDemo: mapped === null,
    isLoading: enabled && query.isLoading,
  };
}

export type TerritoryLeaderboardView = {
  rank: number;
  displayName: string;
  durationS: number;
  capturedAt: string;
  isYou: boolean;
};

/** The fastest captures of one territory, fastest first. */
export function useTerritoryLeaderboard(territoryId: string): Live<TerritoryLeaderboardView[]> {
  const session = useSession();
  const isLiveId = UUID_RE.test(territoryId);
  const enabled = isSupabaseConfigured && session.status === 'signed-in' && isLiveId;

  const query = useQuery({
    queryKey: ['territory-leaderboard', territoryId],
    queryFn: () => territoryLeaderboard(territoryId),
    enabled,
  });

  const mapped = query.isSuccess
    ? query.data.map((r) => ({
        rank: r.rank,
        displayName: r.display_name,
        durationS: r.duration_s,
        capturedAt: r.captured_at,
        isYou: r.is_you,
      }))
    : null;

  return {
    data: mapped ?? (DEMO_TERRITORY_LEADERBOARD[territoryId] ?? []),
    isDemo: mapped === null,
    isLoading: enabled && query.isLoading,
  };
}

/* -------------------------------------------------------------------------- */
/* Suggestions                                                                */
/* -------------------------------------------------------------------------- */

export type SuggestionView = {
  id: string;
  name: string;
  notes: string | null;
  status: SuggestionRow['status'];
  reviewNote: string | null;
  dateLabel: string;
};

export function useSuggestions(): Live<SuggestionView[]> {
  return useLive<SuggestionRow[], SuggestionView[]>(
    'suggestions',
    mySuggestions,
    (rows) =>
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        notes: r.notes,
        status: r.status,
        reviewNote: r.review_note,
        dateLabel: trekDateLabel(r.created_at),
      })),
    DEMO_SUGGESTIONS.map((s) => ({
      id: s.id,
      name: s.name,
      notes: s.notes,
      status: s.status,
      reviewNote: s.reviewNote,
      dateLabel: trekDateLabel(s.createdAt),
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* Suggestion review — admin only                                            */
/* -------------------------------------------------------------------------- */

export type PendingSuggestionView = {
  id: string;
  submitter: string;
  name: string;
  notes: string | null;
  lat: number;
  lng: number;
  hasPhoto: boolean;
  dateLabel: string;
};

/**
 * No demo fallback: reviewing is never something a signed-out or demo
 * session can do, so unlike every other hook in this file there is no
 * "presentable without a backend" case to cover here — see
 * pending_location_suggestions() (0022), which is silently empty for a
 * non-admin rather than an error, and this hook stays disabled until both a
 * session and the RPC exist to ask.
 */
export function usePendingSuggestions(): { data: PendingSuggestionView[]; isLoading: boolean } {
  const session = useSession();
  const enabled = isSupabaseConfigured && session.status === 'signed-in';

  const query = useQuery({
    queryKey: ['pending-suggestions'],
    queryFn: pendingSuggestions,
    enabled,
  });

  const data: PendingSuggestionView[] = query.isSuccess
    ? query.data.map((r: PendingSuggestionRow) => ({
        id: r.id,
        submitter: r.submitter,
        name: r.name,
        notes: r.notes,
        lat: r.lat,
        lng: r.lng,
        hasPhoto: r.has_photo,
        dateLabel: trekDateLabel(r.created_at),
      }))
    : [];

  return { data, isLoading: enabled && query.isLoading };
}

export function useApproveSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: approveSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-suggestions'] });
    },
  });
}

export function useRejectSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rejectSuggestion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-suggestions'] });
    },
  });
}
