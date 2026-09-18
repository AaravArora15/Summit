/**
 * Profile, screen 26 of the v4 mockup.
 *
 * The passport: every scarce thing the climber owns in one frame. The four
 * counters underneath are deliberately the four systems the product runs —
 * badges, pioneer numbers, secret spots, sets — so the screen is a summary of
 * the whole game rather than a settings page with a photo on it.
 *
 * "XP never resets" is printed next to the level bar on purpose. It is the
 * sentence that lets the monthly league exist without anxiety, and it belongs
 * on the surface it reassures about.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import { TrophyRoad } from '@/components/trophy-road';
import { CalendarIcon, ChevronIcon, PlusIcon, SettingsIcon } from '@/components/icons';
import { Avatar, Card, Chip, Data, H2, H3, IconButton, Label, Small } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { useProfile, useRecentBadges } from '@/lib/queries';
import { colour, rarityColour, size, space } from '@/theme/tokens';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: profile, isLoading: profileLoading } = useProfile();
  // Four slots, and the fifth is left empty on purpose: an empty space is a
  // question, a locked badge is an invitation.
  const { data: featured, isLoading: featuredLoading } = useRecentBadges(4);
  const { level, xp, xpToNextLevel } = profile;
  const progress = xpToNextLevel > 0 ? xp / xpToNextLevel : 0;

  return (
    <View style={styles.screen}>
      {/* A sage wash behind the passport head, fading into the page. It is the
          only gradient in the app: the passport is the one screen that is about
          a person rather than a place. */}
      <LinearGradient
        colors={['#E7EEE4', colour.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.wash}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 8, paddingBottom: size.tabBar + 24 },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Label>Explorer passport</Label>
          <IconButton label="Settings" onPress={() => router.push('/settings')}>
            <SettingsIcon size={18} color={colour.ink} />
          </IconButton>
        </View>

        {profileLoading ? (
          <ProfileIdentitySkeleton />
        ) : (
          <>
            {/* The rust ring around the avatar marks a founding pioneer. It is
                the one decoration on the screen and it is earned. */}
            <View style={styles.identity}>
              <View style={profile.isFounding ? styles.avatarRing : styles.avatarPlain}>
                <Avatar initials={profile.initials} size={84} />
              </View>
              <H2 style={{ marginTop: 9 }}>{profile.name}</H2>
              {profile.title ? <Chip label={profile.title} small tone="ink" /> : null}
              <Data style={styles.passportNumber}>
                {profile.explorerNumber !== null
                  ? `Explorer #${String(profile.explorerNumber).padStart(4, '0')} · ${profile.standing}`
                  : profile.standing}
              </Data>
            </View>

            <Card style={{ padding: 14, paddingVertical: 13 }}>
              <View style={[styles.row, { marginBottom: 13 }]}>
                <H3>Explorer Level {level}</H3>
                <Data style={{ fontSize: 13, color: colour.ok }}>{Math.round(progress * 100)}%</Data>
              </View>
              <TrophyRoad level={level} progress={progress} />
              <View style={[styles.row, { marginTop: 13 }]}>
                <Label>
                  {xp.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP
                </Label>
                <Label>XP never resets</Label>
              </View>
            </Card>

            {/* Four systems, four counters. */}
            <View style={styles.counters}>
              {profile.counters.map((counter) => (
                <Card key={counter.label} style={styles.counter}>
                  <Data style={{ fontSize: 18 }}>{counter.value}</Data>
                  <Label style={{ letterSpacing: 0.57 }}>{counter.label}</Label>
                </Card>
              ))}
            </View>
          </>
        )}

        {/* The empty slot is the invitation, so it stays visible. */}
        <View style={styles.section}>
          <Label>Featured</Label>
          <View style={styles.badgeRow}>
            {featuredLoading
              ? Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} width={52} height={64} radius={10} />
                ))
              : [
                  ...featured.map((badge) => (
                    <Pressable
                      key={badge.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${badge.band} badge. Show on map`}
                      onPress={() =>
                        router.navigate({ pathname: '/explore', params: { location: badge.locationId } })
                      }
                      style={({ pressed }) => pressed && { opacity: 0.6 }}>
                      <Badge band={badge.band} tint={rarityColour[badge.rarity]} glyph={badge.glyph} />
                    </Pressable>
                  )),
                  /* The empty slot is the invitation, so at least one always shows. */
                  ...Array.from({ length: Math.max(1, 5 - featured.length) }, (_, i) => (
                    <Badge key={`empty-${i}`} band="Empty" state="locked" />
                  )),
                ]}
          </View>
        </View>

        <Pressable accessibilityRole="button" onPress={() => router.push('/treks')}>
          {({ pressed }) => (
            <Card variant="flat" style={[styles.journal, pressed && { opacity: 0.8 }]}>
              <View style={styles.journalLabel}>
                <CalendarIcon size={16} color={colour.forest} />
                <Small style={{ color: colour.ink }}>
                  Trek journal · {profile.treksThisMonth} this month
                </Small>
              </View>
              <ChevronIcon size={15} color={colour.muted} />
            </Card>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/suggestions')}
          style={{ marginTop: 9 }}>
          {({ pressed }) => (
            <Card variant="flat" style={[styles.journal, pressed && { opacity: 0.8 }]}>
              <View style={styles.journalLabel}>
                <PlusIcon size={16} color={colour.forest} />
                <Small style={{ color: colour.ink }}>My suggestions</Small>
              </View>
              <ChevronIcon size={15} color={colour.muted} />
            </Card>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ProfileIdentitySkeleton() {
  return (
    <>
      <View style={styles.identity}>
        <Skeleton width={84} height={84} radius={42} />
        <View style={{ marginTop: 11 }}>
          <Skeleton height={17} width={130} radius={4} />
        </View>
        <View style={{ marginTop: 8 }}>
          <Skeleton height={10} width={170} radius={4} />
        </View>
      </View>

      <Card style={{ padding: 14, paddingVertical: 13 }}>
        <View style={[styles.row, { marginBottom: 13 }]}>
          <Skeleton height={15} width={130} radius={4} />
          <Skeleton height={13} width={30} radius={4} />
        </View>
        <Skeleton height={10} width="100%" radius={99} />
        <View style={[styles.row, { marginTop: 13 }]}>
          <Skeleton height={9} width={90} radius={4} />
          <Skeleton height={9} width={80} radius={4} />
        </View>
      </Card>

      <View style={styles.counters}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} style={styles.counter}>
            <Skeleton height={17} width={24} radius={4} />
            <View style={{ marginTop: 6 }}>
              <Skeleton height={8} width={44} radius={4} />
            </View>
          </Card>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 270, pointerEvents: 'none' },
  content: { paddingHorizontal: space.screenX, gap: 11 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  identity: { alignItems: 'center', gap: 4 },
  avatarRing: {
    borderWidth: 2.5,
    borderColor: colour.rust,
    borderRadius: 99,
    padding: 5,
  },
  // Same box without the ring, so losing the founding mark does not shift the
  // avatar up the screen by seven and a half pixels.
  avatarPlain: {
    borderWidth: 2.5,
    borderColor: 'transparent',
    borderRadius: 99,
    padding: 5,
  },
  passportNumber: {
    fontSize: 12,
    color: colour.muted,
    marginTop: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  counters: { flexDirection: 'row', gap: 9 },
  counter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 11,
  },

  section: { gap: 8 },
  badgeRow: { flexDirection: 'row', gap: 8 },

  journal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  journalLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
