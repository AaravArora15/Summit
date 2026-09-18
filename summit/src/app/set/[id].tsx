/**
 * Set detail, screen 15 of the v4 mockup.
 *
 * Collected and missing are split rather than mixed into one grid, so the
 * last badges get a section to itself. One deliberate departure from the
 * mockup: a missing badge is a dimmed copy of the real thing — true glyph,
 * true rarity colour, real name — not the generic locked triangle used
 * elsewhere for a slot with no known contents. See the `faded` state on
 * <Badge> for why those two are not the same claim.
 *
 * Reached from Home's closest-set card and from every row of Collect's
 * set-progress list.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import { BackIcon } from '@/components/icons';
import { Skeleton } from '@/components/skeleton';
import { Card, Data, H1, H2, IconButton, Label, ProgressBar, Small, Stripe } from '@/components/ui';
import { SET_GLYPH, shortBand, useSetCompleteBonus, useSetLocations, useSetProgress } from '@/lib/queries';
import { colour, rarityColour, space } from '@/theme/tokens';

export default function SetDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // useSetProgress() already fetches every set the climber has, in one call;
  // this screen reuses it rather than adding a second query just to learn the
  // set's own name, colour and key, all of which that call already has.
  const { data: sets } = useSetProgress();
  const set = sets.find((s) => s.setId === id);

  const { data: locations, isLoading } = useSetLocations(id ?? '');
  const { data: bonus } = useSetCompleteBonus();

  const held = locations.filter((l) => l.claimed);
  const missing = locations.filter((l) => !l.claimed);
  const glyph = (set && SET_GLYPH[set.key]) || 'ridge';
  const tint = set?.tint ?? colour.forest;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => router.back()}>
          <BackIcon size={18} color={colour.ink} />
        </IconButton>
      </View>

      {!set ? (
        <Card>
          <Small style={{ textAlign: 'center' }}>
            {isLoading ? 'Loading…' : 'This set could not be found.'}
          </Small>
        </Card>
      ) : (
        <>
          <Card style={styles.summary}>
            <View style={styles.summaryTop}>
              <View style={styles.summaryHeading}>
                <Stripe tint={tint} height={30} width={4} />
                <View>
                  <Label>Badge set</Label>
                  <H1 style={{ marginTop: 1, fontSize: 20 }}>{set.name}</H1>
                </View>
              </View>
              <Data style={{ fontSize: 21 }}>
                {set.held} <Small style={{ color: colour.dim }}>/ {set.total}</Small>
              </Data>
            </View>
            <View style={{ marginTop: 11 }}>
              <ProgressBar value={set.held / set.total} tint={tint} />
            </View>
          </Card>

          {/* The badge you'll get, stated up front rather than discovered on
              the last claim. */}
          <Card variant="sandy" style={styles.reward}>
            <Badge tint={tint} glyph={glyph} width={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label style={{ color: '#8A7A5E' }}>Set reward</Label>
              <H2 style={{ color: colour.forest, fontSize: 15, marginTop: 2 }}>Set badge</H2>
              <Small style={{ color: '#5C6B57', marginTop: 2 }}>
                Awarded once every badge below is yours · +{bonus} points
              </Small>
            </View>
          </Card>

          {isLoading ? (
            <View style={styles.section}>
              <Skeleton height={11} width={90} radius={4} />
              <View style={styles.grid}>
                {Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} width={64} height={79} radius={10} />
                ))}
              </View>
            </View>
          ) : held.length > 0 ? (
            <View style={styles.section}>
              <Label>Collected · {held.length}</Label>
              <View style={styles.grid}>
                {held.map((l) => (
                  <Pressable
                    key={l.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${l.name}, collected. Show on map`}
                    onPress={() => router.navigate({ pathname: '/explore', params: { location: l.id } })}
                    style={({ pressed }) => pressed && { opacity: 0.6 }}>
                    <Badge band={shortBand(l.name)} tint={rarityColour[l.rarity]} glyph={glyph} width={64} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {isLoading ? null : missing.length > 0 ? (
            <View style={styles.section}>
              <Label>Missing · {missing.length}</Label>
              <View style={styles.grid}>
                {missing.map((l) => {
                  const closed = l.status !== 'open';
                  const closedWord = l.status === 'closed' ? 'Closed' : 'Seasonal';
                  return (
                    <Pressable
                      key={l.id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        closed
                          ? `${l.name}, not yet collected, currently ${closedWord.toLowerCase()}. Show on map`
                          : `${l.name}, not yet collected. Show on map`
                      }
                      onPress={() => router.navigate({ pathname: '/explore', params: { location: l.id } })}
                      style={({ pressed }) => [{ alignItems: 'center' }, pressed && { opacity: 0.6 }]}>
                      <Badge
                        band={shortBand(l.name)}
                        tint={rarityColour[l.rarity]}
                        glyph={glyph}
                        state="faded"
                        width={64}
                      />
                      {closed ? (
                        <Small style={{ marginTop: 3, color: l.status === 'closed' ? colour.stop : colour.warn }}>
                          {closedWord}
                        </Small>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : held.length > 0 ? (
            <Card variant="flat">
              <Small style={{ textAlign: 'center' }}>
                Every badge in this set is yours.
              </Small>
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  content: { paddingHorizontal: space.screenX, gap: 12 },

  header: { flexDirection: 'row', marginBottom: 2 },

  summary: { paddingVertical: 15 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },

  reward: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },

  section: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
});
