/**
 * Badge browser, reached from Collect's "Search your badges" button.
 *
 * Collect itself is deliberately a dashboard, not a wall of tiles — this is
 * the wall of tiles, one level deeper, for the moment that dashboard isn't
 * enough and you need to find one specific thing you already have.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import { BadgeReveal } from '@/components/badge-reveal';
import { BackIcon, CloseIcon, SearchIcon } from '@/components/icons';
import { Button, Card, Chip, Data, H2, Label, Small } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { formatPace } from '@/features/trek/run-stats';
import { formatDuration } from '@/features/trek/store';
import { shortBand, useBadgeRunStats, useBadges, type BadgeView } from '@/lib/queries';
import { colour, radius, rarityColour, space } from '@/theme/tokens';

const RARITIES = ['All', 'common', 'rare', 'epic', 'legendary'] as const;
type RarityFilter = (typeof RARITIES)[number];

export default function BadgesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [rarity, setRarity] = useState<RarityFilter>('All');
  const [selected, setSelected] = useState<BadgeView | null>(null);

  const { data: badges, isLoading, isDemo } = useBadges();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return badges.filter((b) => {
      if (rarity !== 'All' && b.rarity !== rarity) return false;
      if (q && !b.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [badges, search, rarity]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}>
          <BackIcon size={18} color={colour.ink} />
        </Pressable>
        <H2>Your badges</H2>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.search}>
        <SearchIcon size={16} color={colour.dim} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name"
          placeholderTextColor={colour.dim}
          style={styles.searchInput}
          returnKeyType="search"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}>
        {RARITIES.map((r) => {
          const active = rarity === r;
          return (
            <Pressable key={r} onPress={() => setRarity(r)} accessibilityRole="button">
              <Chip
                label={r === 'All' ? 'All' : r[0].toUpperCase() + r.slice(1)}
                tone={active ? 'on' : 'default'}
                colour={active ? undefined : colour.dim}
                small
              />
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}>
        {isLoading ? (
          Array.from({ length: 8 }, (_, i) => (
            <View key={i} style={styles.cell}>
              <Skeleton width={64} height={79} radius={10} />
              <View style={{ marginTop: 6 }}>
                <Skeleton width={52} height={9} radius={4} />
              </View>
            </View>
          ))
        ) : filtered.length === 0 ? (
          <Card variant="flat" style={styles.emptyCard}>
            <Small style={{ textAlign: 'center' }}>
              {badges.length === 0
                ? 'Nothing claimed yet — go outside.'
                : 'No badges match that search.'}
            </Small>
          </Card>
        ) : (
          filtered.map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              accessibilityLabel={`${b.name}. Show the run behind it`}
              onPress={() => setSelected(b)}
              style={({ pressed }) => [styles.cell, pressed && { opacity: 0.6 }]}>
              <Badge tint={rarityColour[b.rarity]} glyph={b.glyph} width={64} />
              <Small numberOfLines={1} style={styles.cellName}>
                {b.name}
              </Small>
              {b.pioneerNumber !== null ? (
                <Label style={{ color: colour.dim }}>#{String(b.pioneerNumber).padStart(4, '0')}</Label>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>

      <BadgeDetail
        badge={selected}
        isDemoBadge={isDemo}
        onClose={() => setSelected(null)}
        onShowOnMap={() => {
          const locationId = selected?.locationId;
          setSelected(null);
          if (locationId) router.navigate({ pathname: '/explore', params: { location: locationId } });
        }}
      />
    </View>
  );
}

/**
 * The badge full-screen, on tap: the same centred reveal the claim moment
 * itself uses (see badge-reveal.tsx), with the walk behind it underneath —
 * time, distance, pace. useBadgeRunStats() (queries.ts) already resolves to
 * an honest number either way: a real trek's own figures, or a generic
 * estimate clearly labelled as one when there is no genuine track to show
 * (a dev-fake-claim.ts shortcut, or demo mode's invented badges).
 */
function BadgeDetail({
  badge,
  isDemoBadge,
  onClose,
  onShowOnMap,
}: {
  badge: BadgeView | null;
  isDemoBadge: boolean;
  onClose: () => void;
  onShowOnMap: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { data: stats } = useBadgeRunStats(badge, isDemoBadge);

  return (
    <Modal visible={badge !== null} animationType="fade" onRequestClose={onClose}>
      {badge ? (
        <View style={[styles.detailScreen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.detailHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}>
              <CloseIcon size={16} color={colour.ink} />
            </Pressable>
          </View>

          <View style={styles.detailBody}>
            <BadgeReveal band={shortBand(badge.name)} tint={rarityColour[badge.rarity]} glyph={badge.glyph} width={148} />

            <H2 style={{ textAlign: 'center', marginTop: 4 }}>{badge.name}</H2>
            {badge.setName ? (
              <Small style={{ color: colour.dim, marginTop: 2 }}>{badge.setName}</Small>
            ) : null}

            {badge.pioneerNumber !== null ? (
              <Card variant="dark" style={[styles.card, styles.numberCard]}>
                <Label style={{ color: 'rgba(242,242,238,0.6)', fontSize: 8 }}>Pioneer number</Label>
                <Data style={styles.number}>#{String(badge.pioneerNumber).padStart(4, '0')}</Data>
              </Card>
            ) : null}

            {stats ? (
              <Card variant="flat" style={[styles.card, styles.statsCard]}>
                <View style={styles.statsRow}>
                  <Stat label="Time" value={formatDuration(stats.movingTimeS)} />
                  <Stat label="Distance" value={`${(stats.distanceM / 1000).toFixed(1)}`} unit="km" />
                  <Stat label="Pace" value={formatPace(stats.movingTimeS, stats.distanceM)} unit="/km" />
                </View>
                {stats.isEstimated ? (
                  <Small style={{ color: colour.dim, textAlign: 'center', marginTop: 10 }}>
                    {isDemoBadge
                      ? 'Estimated — no real walk behind a demo badge.'
                      : 'Estimated from a typical hike here — this claim carries no walked track.'}
                  </Small>
                ) : null}
              </Card>
            ) : null}
          </View>

          <Button label="Show on map" variant="ghost" full onPress={onShowOnMap} />
        </View>
      ) : null}
    </Modal>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        <Data style={styles.statValue}>{value}</Data>
        {unit ? <Small style={{ color: colour.dim }}>{unit}</Small> : null}
      </View>
      <Label style={{ color: colour.dim, marginTop: 2 }}>{label}</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg, paddingHorizontal: space.screenX, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    alignItems: 'center',
    justifyContent: 'center',
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    paddingHorizontal: 16,
  },
  searchInput: { flex: 1, fontSize: 14, color: colour.ink },

  chipRow: { gap: 6, paddingRight: space.screenX },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingTop: 4 },
  cell: { width: 72, alignItems: 'center' },
  cellName: { marginTop: 6, textAlign: 'center', color: colour.ink },

  emptyCard: { width: '100%', paddingVertical: 24 },

  detailScreen: { flex: 1, backgroundColor: colour.bg, paddingHorizontal: space.screenX, gap: 12 },
  detailHeader: { flexDirection: 'row', justifyContent: 'flex-end' },
  detailBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { alignItems: 'center', alignSelf: 'stretch' },
  numberCard: { marginTop: 22, paddingVertical: 10, paddingHorizontal: 14 },
  number: { fontSize: 32, color: colour.sand, marginTop: 2, letterSpacing: -0.6 },
  statsCard: { marginTop: 12, paddingVertical: 16, paddingHorizontal: 14 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  stat: { alignItems: 'center' },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  statValue: { fontSize: 22 },
});
