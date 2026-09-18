/**
 * Territory detail — Capture Territory.
 *
 * Distinct from set/[id].tsx on purpose: a set groups by theme and shows a
 * badge grid, because every member shares one glyph. A territory groups by
 * geography — its members can belong to entirely different sets with
 * entirely different glyphs — so this is a plain list, not a badge wall,
 * plus the one thing a set detail screen has no equivalent of: a
 * leaderboard, since "how fast did you capture this" is the whole point.
 *
 * Reached from Collect's Territories list.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, CheckIcon } from '@/components/icons';
import { Card, Chip, Data, Difficulty, H1, IconButton, Label, ProgressBar, Small } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { formatDuration } from '@/features/trek/store';
import {
  useTerritories,
  useTerritoryLeaderboard,
  useTerritoryLocations,
  type TerritoryLeaderboardView,
  type TerritoryLocationView,
} from '@/lib/queries';
import { colour, rarityColour, space } from '@/theme/tokens';

export default function TerritoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // useTerritories() already fetches every territory the climber has, in one
  // call; this screen reuses it for the name/held/total/captured summary
  // rather than adding a second query, same reasoning set/[id].tsx already
  // gives for reusing useSetProgress().
  const { data: territories } = useTerritories();
  const territory = territories.find((t) => t.territoryId === id);

  const { data: locations, isLoading: locationsLoading } = useTerritoryLocations(id ?? '');
  const { data: leaderboard, isLoading: leaderboardLoading } = useTerritoryLeaderboard(id ?? '');

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => router.back()}>
          <BackIcon size={18} color={colour.ink} />
        </IconButton>
      </View>

      {!territory ? (
        <Card>
          <Small style={{ textAlign: 'center' }}>
            {locationsLoading ? 'Loading…' : 'This territory could not be found.'}
          </Small>
        </Card>
      ) : (
        <View style={{ flex: 1, gap: 12 }}>
          <Card style={styles.summary}>
            <View style={styles.summaryTop}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label>Territory</Label>
                <H1 style={{ marginTop: 1, fontSize: 20 }}>{territory.name}</H1>
              </View>
              <Data style={{ fontSize: 21, color: territory.captured ? colour.ok : colour.ink }}>
                {territory.held} <Small style={{ color: colour.dim }}>/ {territory.total}</Small>
              </Data>
            </View>
            <View style={{ marginTop: 11 }}>
              <ProgressBar
                value={territory.held / territory.total}
                tint={territory.captured ? colour.ok : colour.forest}
              />
            </View>
          </Card>

          {territory.captured && territory.durationS !== null ? (
            <Card variant="sandy" style={styles.reward}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label style={{ color: '#8A7A5E' }}>Captured</Label>
                <Data style={{ fontSize: 22, color: colour.forest, marginTop: 2 }}>
                  {formatDuration(territory.durationS)}
                </Data>
                <Small style={{ color: '#5C6B57', marginTop: 2 }}>
                  {territory.bestDurationS !== null && territory.bestDurationS < territory.durationS
                    ? `Fastest so far: ${formatDuration(territory.bestDurationS)}`
                    : 'Your time from first claim to last.'}
                </Small>
              </View>
            </Card>
          ) : territory.bestDurationS !== null ? (
            <Card variant="flat" style={styles.reward}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label>Fastest capture so far</Label>
                <Data style={{ fontSize: 18, marginTop: 2 }}>{formatDuration(territory.bestDurationS)}</Data>
              </View>
            </Card>
          ) : null}

          <View style={styles.section}>
            <Label>Locations</Label>
            {locationsLoading ? (
              Array.from({ length: 3 }, (_, i) => (
                <Card key={i} style={styles.row}>
                  <Skeleton height={13} width="45%" radius={4} />
                </Card>
              ))
            ) : (
              <View style={{ gap: 8 }}>
                {locations.map((l) => (
                  <LocationRow key={l.id} location={l} />
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Label>Leaderboard</Label>
            {leaderboardLoading ? (
              <Card style={styles.row}>
                <Skeleton height={13} width="60%" radius={4} />
              </Card>
            ) : leaderboard.length === 0 ? (
              <Card variant="flat" style={styles.emptyCard}>
                <Small style={{ textAlign: 'center' }}>Nobody has captured this one yet.</Small>
              </Card>
            ) : (
              <View style={{ gap: 8 }}>
                {leaderboard.map((row) => (
                  <LeaderboardRow key={row.rank} row={row} />
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

function LocationRow({ location }: { location: TerritoryLocationView }) {
  return (
    <Card style={[styles.row, styles.rowInline]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Small style={{ color: colour.ink }}>{location.name}</Small>
        <View style={styles.rowMeta}>
          <Chip
            label={location.rarity[0].toUpperCase() + location.rarity.slice(1)}
            small
            colour={rarityColour[location.rarity]}
          />
          <Difficulty level={location.difficulty} />
        </View>
      </View>
      {location.claimed ? (
        <View style={styles.claim}>
          <CheckIcon size={14} color={colour.ok} />
          {location.pioneerNumber !== null ? (
            <Small style={{ color: colour.dim }}>#{String(location.pioneerNumber).padStart(4, '0')}</Small>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function LeaderboardRow({ row }: { row: TerritoryLeaderboardView }) {
  return (
    <Card style={[styles.row, styles.rowInline, row.isYou && styles.rowYou]}>
      <View style={styles.leaderboardName}>
        <Data style={{ fontSize: 13, color: colour.dim, width: 22 }}>#{row.rank}</Data>
        <Small style={{ color: colour.ink }}>{row.isYou ? 'You' : row.displayName}</Small>
      </View>
      <Data style={{ fontSize: 13 }}>{formatDuration(row.durationS)}</Data>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg, paddingHorizontal: space.screenX, gap: 12 },
  header: { flexDirection: 'row', marginBottom: 2 },

  summary: { paddingVertical: 15 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  reward: { flexDirection: 'row', alignItems: 'center', padding: 13 },

  section: { gap: 8 },
  row: { padding: 12 },
  rowInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  rowYou: { borderColor: colour.forest, borderWidth: 1 },
  claim: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  leaderboardName: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  emptyCard: { paddingVertical: 20 },
});
