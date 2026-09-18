/**
 * Collect, screen 13 of the v4 mockup.
 *
 * The tab deliberately does not open on a wall of tiles. It opens on the four
 * numbers that decide whether you go out this weekend: how much of the map you
 * hold, how many pioneer numbers you own, which sets are nearly done, and what
 * you last earned.
 *
 * The ring reads "27 of 71", never "38%". A fraction implies remaining work; a
 * percentage implies a score, and this screen is meant to send you outside.
 *
 * Data comes from my_collection(), my_set_progress() and my_recent_badges(),
 * falling back to lib/demo-data.ts when there is no backend to ask. See
 * lib/queries.ts for why the fallback is demo rather than zeros.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import { ChevronIcon, SearchIcon } from '@/components/icons';
import {
  Card,
  Data,
  H2,
  IconButton,
  Label,
  ProgressBar,
  ProgressRing,
  Small,
  Stripe,
} from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { formatDuration } from '@/features/trek/store';
import { useCollection, useRecentBadges, useSetProgress, useTerritories } from '@/lib/queries';
import { colour, font, rarityColour, size, space, type } from '@/theme/tokens';

export default function CollectScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: collection, isLoading: collectionLoading } = useCollection();
  const { data: sets, isLoading: setsLoading } = useSetProgress();
  const { data: badges, isLoading: badgesLoading } = useRecentBadges();
  const { data: territories, isLoading: territoriesLoading } = useTerritories();
  const { owned, total, byRarity, bestPioneerNumber } = collection;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: size.tabBar + 24 },
      ]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label>Your collection</Label>
          <H2 style={{ marginTop: 1 }}>Badge dashboard</H2>
        </View>
        <IconButton label="Search your badges" onPress={() => router.push('/badges')}>
          <SearchIcon size={18} color={colour.ink} />
        </IconButton>
      </View>

      {/* Held against findable, plus the rarity split beside it. The two
          together answer "how much is left" and "how much of it is hard". */}
      <Card style={styles.ringCard}>
        {collectionLoading ? (
          <>
            <Skeleton width={64} height={64} radius={32} />
            <View style={styles.rarityList}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.row}>
                  <Skeleton height={11} width={60} radius={4} />
                  <Skeleton height={11} width={16} radius={4} />
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <ProgressRing value={owned / total}>
              <Data style={{ fontSize: 19, lineHeight: 21 }}>{owned}</Data>
              <Label style={styles.ringDenominator}>of {total}</Label>
            </ProgressRing>

            <View style={styles.rarityList}>
              {byRarity.map(({ rarity, held }) => (
                <View key={rarity} style={styles.row}>
                  <Small style={{ textTransform: 'capitalize' }}>{rarity}</Small>
                  <Data style={{ fontSize: 12.5 }}>{held}</Data>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      {/* Pioneer numbers are a stat in their own right. They are the only thing
          in the product that cannot be earned twice. */}
      <View style={styles.pair}>
        <Card variant="dark" style={styles.tile}>
          {collectionLoading ? (
            <>
              <Skeleton height={9} width={100} radius={4} />
              <View style={{ marginTop: 6 }}>
                <Skeleton height={19} width={30} radius={4} />
              </View>
              <View style={{ marginTop: 6 }}>
                <Skeleton height={9} width={110} radius={4} />
              </View>
            </>
          ) : (
            <>
              <Label style={{ color: 'rgba(242,242,238,0.6)' }}>Pioneer numbers held</Label>
              <Data style={{ fontSize: 20, color: colour.sand, marginTop: 2 }}>
                {collection.pioneerNumbersHeld}
              </Data>
              <Small style={{ color: 'rgba(242,242,238,0.72)', marginTop: 2 }}>
                {/* Before the first claim there is no best number, and "Best: #0000"
                    would be a number nobody holds. */}
                {bestPioneerNumber
                  ? `Best: #${String(bestPioneerNumber.number).padStart(4, '0')} ${bestPioneerNumber.location}`
                  : 'Claim a place to take your first'}
              </Small>
            </>
          )}
        </Card>

        <Card style={styles.tile}>
          {collectionLoading ? (
            <>
              <Skeleton height={9} width={90} radius={4} />
              <View style={{ marginTop: 6 }}>
                <Skeleton height={19} width={30} radius={4} />
              </View>
              <View style={{ marginTop: 6 }}>
                <Skeleton height={9} width={80} radius={4} />
              </View>
            </>
          ) : (
            <>
              <Label>Sets completed</Label>
              <Data style={{ fontSize: 20, marginTop: 2 }}>
                <Data style={{ color: colour.ok }}>{collection.setsCompleted}</Data>
                <Data style={{ color: colour.dim }}> / {collection.setsTotal}</Data>
              </Data>
              <Small style={{ marginTop: 2 }}>
                {collection.titlesUnlocked} title{collection.titlesUnlocked === 1 ? '' : 's'} unlocked
              </Small>
            </>
          )}
        </Card>
      </View>

      {/* Sets ranked by closeness, not alphabetically: the one you can finish
          this weekend belongs at the top. Each row opens set/[id], the same
          screen Home's closest-set card opens: every badge in the set,
          collected first, the missing ones faded. */}
      <View style={styles.section}>
        <Label>Set progress</Label>
        <Card style={{ padding: 13, paddingVertical: 12 }}>
          {setsLoading ? (
            <View style={{ gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.setRow}>
                  <Skeleton width={5} height={20} radius={99} />
                  <View style={styles.setBody}>
                    <View style={styles.row}>
                      <Skeleton height={11} width={100} radius={4} />
                      <Skeleton height={11} width={30} radius={4} />
                    </View>
                    <View style={{ marginTop: 6 }}>
                      <Skeleton height={5} width="100%" radius={99} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {sets.map((set) => {
                const tint = set.tint;
                return (
                  <Pressable
                    key={set.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${set.name}, ${set.held} of ${set.total} collected. Open set`}
                    onPress={() => router.push(`/set/${set.setId}`)}
                    style={({ pressed }) => [styles.setRow, pressed && { opacity: 0.6 }]}>
                    <Stripe tint={tint} height={20} width={5} />
                    <View style={styles.setBody}>
                      <View style={styles.row}>
                        <Small style={styles.setName}>{set.name}</Small>
                        <Data style={{ fontSize: 12 }}>
                          <Data style={{ color: colour.ok }}>{set.held}</Data>
                          <Data style={{ color: colour.dim }}> / {set.total}</Data>
                        </Data>
                      </View>
                      <ProgressBar value={set.held / set.total} tint={tint} />
                    </View>
                    <ChevronIcon size={16} color={colour.dim} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </Card>
      </View>

      {/* Capture Territory: unlike a set (thematic, can span continents), a
          territory is a small real-world cluster of 3-4 nearby locations —
          claim every one and it's captured, with a banked time and a
          leaderboard behind it. See territory/[id].tsx. Dropped entirely
          once loaded if none exist yet, same as an empty city's set list
          would be — this is deployment state, not a user state. */}
      {territoriesLoading || territories.length > 0 ? (
        <View style={styles.section}>
          <Label>Territories</Label>
          <Card style={{ padding: 13, paddingVertical: 12 }}>
            {territoriesLoading ? (
              <View style={{ gap: 12 }}>
                {[0, 1].map((i) => (
                  <View key={i} style={styles.setRow}>
                    <Skeleton width={5} height={20} radius={99} />
                    <View style={styles.setBody}>
                      <View style={styles.row}>
                        <Skeleton height={11} width={100} radius={4} />
                        <Skeleton height={11} width={30} radius={4} />
                      </View>
                      <View style={{ marginTop: 6 }}>
                        <Skeleton height={5} width="100%" radius={99} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {territories.map((t) => (
                  <Pressable
                    key={t.territoryId}
                    accessibilityRole="button"
                    accessibilityLabel={`${t.name}, ${t.held} of ${t.total} claimed${t.captured ? ', captured' : ''}. Open territory`}
                    onPress={() => router.push(`/territory/${t.territoryId}`)}
                    style={({ pressed }) => [styles.setRow, pressed && { opacity: 0.6 }]}>
                    <Stripe tint={t.captured ? colour.ok : colour.forest} height={20} width={5} />
                    <View style={styles.setBody}>
                      <View style={styles.row}>
                        <Small style={styles.setName}>{t.name}</Small>
                        {t.captured && t.durationS !== null ? (
                          <Data style={{ fontSize: 12, color: colour.ok }}>
                            {formatDuration(t.durationS)}
                          </Data>
                        ) : (
                          <Data style={{ fontSize: 12 }}>
                            <Data style={{ color: colour.ok }}>{t.held}</Data>
                            <Data style={{ color: colour.dim }}> / {t.total}</Data>
                          </Data>
                        )}
                      </View>
                      <ProgressBar
                        value={t.held / t.total}
                        tint={t.captured ? colour.ok : colour.forest}
                      />
                    </View>
                    <ChevronIcon size={16} color={colour.dim} />
                  </Pressable>
                ))}
              </View>
            )}
          </Card>
        </View>
      ) : null}

      {/* The locked slot is left in on purpose. An empty space is a question;
          a locked badge is an invitation. */}
      <View style={styles.section}>
        <Label>Latest</Label>
        <View style={styles.badgeRow}>
          {badgesLoading
            ? Array.from({ length: 4 }, (_, i) => (
                <View key={i} style={{ alignItems: 'center' }}>
                  <Skeleton width={52} height={64} radius={10} />
                </View>
              ))
            : [
                ...badges.map((badge) => (
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
                /* Always one locked slot past whatever is held. Before the first
                   claim that is the whole row, which is the correct picture:
                   the shape of the thing is visible and none of it is yours
                   yet. */
                ...Array.from({ length: Math.max(1, 4 - badges.length) }, (_, i) => (
                  <Badge key={`locked-${i}`} band="Locked" state="locked" />
                )),
              ]}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  content: { paddingHorizontal: space.screenX, gap: 11 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },

  ringCard: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  ringDenominator: { fontSize: 8, letterSpacing: 0.8, color: colour.dim },

  rarityList: { flex: 1, minWidth: 0, gap: 6 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  pair: { flexDirection: 'row', gap: 9 },
  tile: { flex: 1, minWidth: 0, padding: 12 },

  section: { gap: 8 },

  setRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  setBody: { flex: 1, minWidth: 0, gap: 5 },
  setName: { ...type.xs, fontFamily: font.uiSemi, color: colour.ink },

  badgeRow: { flexDirection: 'row', gap: 10 },
});
