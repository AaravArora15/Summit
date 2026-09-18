/**
 * Home, screen 05 of the v4 mockup.
 *
 * The screen reads top to bottom as one sentence: here's today's one thing
 * to go do, you are N points off promotion, one badge finishes a set, and
 * there is a secret spot on a route you already walk. Reasons to leave the
 * house, ranked by how little they ask.
 *
 * The league standing, the closest set and the explorer level are live. The
 * nearby secret-spot count is not: it has no table yet, and is a scheduling
 * system rather than a query over one.
 *
 * Today's Wildcard sits above all three: it is the only one of the four that
 * answers "where do I go today" with an actual single place, rather than a
 * standing or a percentage — see useWildcard() (queries.ts) and
 * my_wildcard() (0024).
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
  Button,
  Card,
  Chip,
  Data,
  Difficulty,
  H1,
  H2,
  Label,
  ProgressBar,
  Small,
} from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { beginTrekSession } from '@/features/trek/start';
import { useTrek } from '@/features/trek/store';
import { alertUser } from '@/lib/alert';
import { useLeague, useProfile, useRerollWildcard, useSetProgress, useWildcard } from '@/lib/queries';
import { colour, font, rarityColour, size, space } from '@/theme/tokens';

/** "Ends in 6h", the way a countdown reads without a ticking clock — good
 *  enough for a number that only needs to be roughly right on each render,
 *  not a live timer. */
function timeLeftLabel(expiresAt: string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return 'Ending soon';
  const hours = Math.ceil(msLeft / (60 * 60 * 1000));
  return hours <= 1 ? 'Ends within the hour' : `Ends in ${hours}h`;
}

/** "Saturday · 16 August", the way the header in the mockup reads. */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
 * Morning, afternoon or evening. Trivial, and the reason the screen does not
 * greet someone with "Good morning" at nine at night, which is the kind of
 * detail that decides whether an app feels made or generated.
 */
/**
 * The database constrains difficulty to 1-4, but the type coming back over the
 * wire is a plain number. Clamping rather than casting means a seed that ever
 * violates the constraint renders a chevron count instead of crashing the tab.
 */
function difficulty(value: number | null): 1 | 2 | 3 | 4 {
  return Math.min(4, Math.max(1, Math.round(value ?? 1))) as 1 | 2 | 3 | 4;
}

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: league, isLoading: leagueLoading } = useLeague();
  const { data: sets, isLoading: setsLoading } = useSetProgress();
  const { data: wildcard, isLoading: wildcardLoading } = useWildcard();
  const reroll = useRerollWildcard();
  const [startingHunt, setStartingHunt] = useState(false);

  async function handleReroll() {
    if (reroll.isPending) return;
    try {
      await reroll.mutateAsync();
    } catch (error) {
      alertUser('Could not reroll', error instanceof Error ? error.message : String(error));
    }
  }

  /** Same as any other trek: a real location_id goes to the store so
   *  claim_location() can still be attempted on arrival, but never the
   *  name/rarity/glyph — those stay whatever my_wildcard() is already
   *  withholding, so the hunt is real all the way down, not just at this
   *  one screen. See features/trek/store.ts's targetIsWildcard. */
  async function handleStartHunt() {
    if (wildcard.kind !== 'active' || startingHunt) return;
    setStartingHunt(true);
    try {
      const locationId = wildcard.locationId;
      const ok = await beginTrekSession(() =>
        useTrek.getState().begin({ id: locationId, isWildcard: true }),
      );
      if (ok) router.push('/trek/live');
    } finally {
      setStartingHunt(false);
    }
  }

  const now = useMemo(() => new Date(), []);
  const dateLine = `${DAYS[now.getDay()]} · ${now.getDate()} ${MONTHS[now.getMonth()]}`;

  // my_set_progress() already returns closest-to-completion first, so the set
  // worth walking to this weekend is simply the first row. Prefer one already
  // started: a set you hold three of is a better reason to go out than a set
  // you have never heard of.
  //
  // Undefined only when the city has no sets seeded at all, which is a
  // deployment state rather than a user state, so the card is dropped rather
  // than shown empty.
  const closest = sets.find((set) => set.held > 0 && set.held < set.total) ?? sets[0];
  const xpProgress = profile.xpToNextLevel > 0 ? profile.xp / profile.xpToNextLevel : 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: size.tabBar + 24 },
      ]}
      showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label>{dateLine}</Label>
          <H1 style={{ marginTop: 2 }}>
            {greeting(now.getHours())}, {profile.shortName}
          </H1>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
          onPress={() => router.navigate('/profile')}
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.75 }]}>
          <Data style={{ color: colour.n50, fontSize: 13 }}>{profile.initials}</Data>
        </Pressable>
      </View>

      {/* Today's Wildcard. wildcard.kind === 'none' (every open, non-secret
          location already claimed) drops the card the same way an
          undefined `closest` set does below — a real empty state, not an
          error, and not worth a card of its own. */}
      {wildcardLoading ? (
        <Card variant="tint">
          <View style={styles.row}>
            <Skeleton height={9} width={110} radius={4} />
            <Skeleton height={9} width={60} radius={4} />
          </View>
          <View style={{ marginTop: 8 }}>
            <Skeleton height={17} width="60%" radius={4} />
          </View>
        </Card>
      ) : wildcard.kind === 'active' ? (
        <Card variant="tint">
          <View style={styles.row}>
            <Label style={{ color: colour.forest }}>{"Today's Wildcard"}</Label>
            {!wildcard.claimed ? (
              <Small style={{ color: colour.ink2 }}>{timeLeftLabel(wildcard.expiresAt)}</Small>
            ) : null}
          </View>
          {wildcard.claimed ? (
            <>
              <H2 style={{ marginTop: 3, fontSize: 16 }}>{wildcard.name}</H2>
              <Small style={{ marginTop: 4 }}>Claimed — bonus points already in your total.</Small>
            </>
          ) : (
            <>
              {/* The only clues: rarity and difficulty, same as Wordle's own
                  tile colours narrow a guess without ever being the answer.
                  Not the name, not the map — that's what "Start hunting"
                  turns into a live compass for, see trek/live.tsx. */}
              <View style={[styles.row, { marginTop: 6, justifyContent: 'flex-start', gap: 10 }]}>
                <Chip
                  label={wildcard.rarity[0].toUpperCase() + wildcard.rarity.slice(1)}
                  small
                  colour={rarityColour[wildcard.rarity]}
                />
                <Difficulty level={wildcard.difficulty} />
              </View>
              <Small style={{ marginTop: 8 }}>
                Somewhere out there. Find it and claim it today for bonus points.
              </Small>
              <View style={[styles.row, { marginTop: 10, justifyContent: 'flex-start', gap: 8 }]}>
                <Button label="Start hunting" small loading={startingHunt} onPress={handleStartHunt} />
                {!wildcard.rerolled ? (
                  <Button label="Reroll" variant="ghost" small loading={reroll.isPending} onPress={handleReroll} />
                ) : null}
              </View>
            </>
          )}
        </Card>
      ) : null}

      {/* League standing */}
      <Card variant="dark">
        {leagueLoading ? (
          <>
            <View style={styles.row}>
              <Skeleton height={10} width={90} radius={4} />
              <Skeleton height={18} width={64} radius={99} />
            </View>
            <View style={{ marginTop: 10 }}>
              <Skeleton height={24} width={120} radius={5} />
            </View>
            <View style={{ marginTop: 8 }}>
              <Skeleton height={10} width="70%" radius={4} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.row}>
              <Label style={{ color: 'rgba(242,242,238,0.6)' }}>{league.month}</Label>
              <Chip label={league.tiers[league.tierIndex]} small colour={colour.sand} onDark />
            </View>
            <View style={[styles.row, { marginTop: 6, alignItems: 'flex-end' }]}>
              <Data style={{ fontSize: 26, color: colour.n50 }}>#{league.rank}</Data>
              <Data style={{ fontSize: 17, color: colour.sand }}>
                {league.points.toLocaleString()} pts
              </Data>
            </View>
            <Small style={{ color: 'rgba(242,242,238,0.72)', marginTop: 4 }}>
              {league.pointsToPromotion > 0
                ? `${league.pointsToPromotion.toLocaleString()} pts to promotion · ${league.resetsOn.replace('Resets ', 'resets ')}`
                : `Promotion place held · ${league.resetsOn.replace('Resets ', 'resets ')}`}
            </Small>
          </>
        )}
      </Card>

      {/* Closest set. The stripe is the set's colour, which appears nowhere
          else in the app, so it means exactly one thing. */}
      {setsLoading ? (
        <Card>
          <View style={styles.row}>
            <View style={styles.setHeading}>
              <Skeleton width={4} height={30} radius={99} />
              <View style={{ gap: 5 }}>
                <Skeleton height={9} width={70} radius={4} />
                <Skeleton height={15} width={110} radius={4} />
              </View>
            </View>
            <Skeleton height={17} width={40} radius={4} />
          </View>
          <View style={styles.dots}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} width={size.progressDot} height={size.progressDot} radius={99} />
            ))}
          </View>
        </Card>
      ) : closest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${closest.name} set`}
          onPress={() => router.push(`/set/${closest.setId}`)}>
          {({ pressed }) => (
            <Card style={pressed && { opacity: 0.85 }}>
              <View style={styles.row}>
                <View style={styles.setHeading}>
                  <View style={[styles.stripe, { backgroundColor: closest.tint }]} />
                  <View>
                    <Label>Closest set</Label>
                    <H2 style={{ marginTop: 1 }}>{closest.name}</H2>
                  </View>
                </View>
                <Data style={{ fontSize: 17 }}>
                  {closest.held} <Small style={{ color: colour.dim }}>/ {closest.total}</Small>
                </Data>
              </View>

              {/* One dot per location in the set. Capped at twelve: past that the
                dots stop being countable and become a texture. */}
              <View style={styles.dots}>
                {Array.from({ length: Math.min(closest.total, 12) }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          i <
                          Math.round((closest.held / closest.total) * Math.min(closest.total, 12))
                            ? closest.tint
                            : colour.n200,
                      },
                    ]}
                  />
                ))}
              </View>

              <View style={[styles.row, { marginTop: 10 }]}>
                <Small style={{ color: colour.ink }}>
                  {closest.nextLocationName ? (
                    <>
                      {closest.total - closest.held === 1 ? 'One left: ' : 'Next: '}
                      <Small style={{ fontFamily: font.uiSemi }}>
                        {closest.nextLocationName}
                      </Small>
                    </>
                  ) : (
                    'Set complete'
                  )}
                </Small>
                <Difficulty level={difficulty(closest.nextLocationDifficulty)} />
              </View>
            </Card>
          )}
        </Pressable>
      ) : null}

      {/* Two reasons side by side */}
      <View style={styles.pair}>
        <Card variant="sandy" style={{ flex: 1, minWidth: 0 }}>
          <Label>Secret spot</Label>
          <H2 style={{ marginTop: 3, fontSize: 16 }}>1 unfound nearby</H2>
          <Body style={{ marginTop: 4 }}>On the Southern Ridges route you already walk.</Body>
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your level progress"
          onPress={() => router.navigate('/profile')}
          style={{ flex: 1, minWidth: 0 }}>
          {({ pressed }) => (
            <Card style={[{ flex: 1, minWidth: 0 }, pressed && { opacity: 0.85 }]}>
              {profileLoading ? (
                <>
                  <Skeleton height={9} width={90} radius={4} />
                  <View style={{ marginTop: 6 }}>
                    <Skeleton height={19} width={44} radius={4} />
                  </View>
                  <View style={{ marginTop: 10 }}>
                    <Skeleton height={6} width="100%" radius={99} />
                  </View>
                  <View style={{ marginTop: 8 }}>
                    <Skeleton height={9} width={80} radius={4} />
                  </View>
                </>
              ) : (
                <>
                  <Label>Explorer level {profile.level}</Label>
                  <Data style={{ fontSize: 22, marginTop: 3 }}>{Math.round(xpProgress * 100)}%</Data>
                  <View style={{ marginTop: 8 }}>
                    <ProgressBar value={xpProgress} />
                  </View>
                  <Label style={{ marginTop: 6 }}>
                    {(profile.xpToNextLevel - profile.xp).toLocaleString()} XP to {profile.level + 1}
                  </Label>
                </>
              )}
            </Card>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  content: { paddingHorizontal: space.screenX, gap: 10 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colour.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  setHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stripe: { width: 4, height: 30, borderRadius: 99 },

  dots: { flexDirection: 'row', gap: 5, marginTop: 10 },
  dot: { width: size.progressDot, height: size.progressDot, borderRadius: 99 },

  pair: { flexDirection: 'row', gap: 9 },
});
