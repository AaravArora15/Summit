/**
 * Home, screen 05 of the v4 mockup.
 *
 * The screen reads top to bottom as one sentence: you are N points off
 * promotion, one badge finishes a set, and there is a secret spot on a route
 * you already walk. Three different reasons to leave the house, ranked by how
 * little they ask.
 *
 * The league standing, the closest set and the explorer level are live. The
 * nearby secret-spot count is not: it has no table yet, and is a scheduling
 * system rather than a query over one.
 */
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
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
import { useLeague, useProfile, useSetProgress } from '@/lib/queries';
import { colour, font, size, space } from '@/theme/tokens';

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
  const { data: profile } = useProfile();
  const { data: league } = useLeague();
  const { data: sets } = useSetProgress();

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

      {/* League standing */}
      <Card variant="dark">
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
      </Card>

      {/* Closest set. The stripe is the set's colour, which appears nowhere
          else in the app, so it means exactly one thing. */}
      {closest ? (
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
              <Label>Explorer level {profile.level}</Label>
              <Data style={{ fontSize: 22, marginTop: 3 }}>{Math.round(xpProgress * 100)}%</Data>
              <View style={{ marginTop: 8 }}>
                <ProgressBar value={xpProgress} />
              </View>
              <Label style={{ marginTop: 6 }}>
                {(profile.xpToNextLevel - profile.xp).toLocaleString()} XP to {profile.level + 1}
              </Label>
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
