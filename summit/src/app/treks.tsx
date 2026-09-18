/**
 * Trek journal, reached from Profile's journal card.
 *
 * Every walk, not just the ones that landed a claim — the card on Profile
 * already promises "N this month" for untargeted walks too, so this list
 * has to include them or it would contradict the number that opens it.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, CheckIcon } from '@/components/icons';
import { Card, Data, H2, Label, Small } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';
import { formatDuration } from '@/features/trek/store';
import { useTreks, type TrekView } from '@/lib/queries';
import { colour, radius, space } from '@/theme/tokens';

export default function TreksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: treks, isLoading } = useTreks();

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
        <H2>Trek journal</H2>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 9 }}
        showsVerticalScrollIndicator={false}>
        {isLoading ? (
          Array.from({ length: 4 }, (_, i) => (
            <Card key={i} style={styles.row}>
              <Skeleton height={13} width="35%" radius={4} />
              <View style={{ marginTop: 8 }}>
                <Skeleton height={10} width="55%" radius={4} />
              </View>
            </Card>
          ))
        ) : treks.length === 0 ? (
          <Card variant="flat" style={styles.emptyCard}>
            <Small style={{ textAlign: 'center' }}>No treks yet — go for a walk.</Small>
          </Card>
        ) : (
          treks.map((t) => <TrekRow key={t.id} trek={t} />)
        )}
      </ScrollView>
    </View>
  );
}

function TrekRow({ trek }: { trek: TrekView }) {
  const pending = trek.status === 'recording' || trek.status === 'submitted';
  const rejected = trek.status === 'rejected';

  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <Label>{trek.dateLabel}</Label>
        <Data style={{ fontSize: 12.5 }}>+{trek.pointsEarned} pts</Data>
      </View>

      <View style={[styles.rowTop, { marginTop: 4 }]}>
        <Small style={{ color: colour.ink }}>
          {trek.distanceKm.toFixed(1)} km · {formatDuration(trek.movingTimeS)}
        </Small>
        {pending ? (
          <Small style={{ color: colour.warn }}>Verifying…</Small>
        ) : rejected ? (
          <Small style={{ color: colour.stop }}>Not counted</Small>
        ) : null}
      </View>

      {trek.locationName ? (
        <View style={styles.claim}>
          <CheckIcon size={13} color={colour.ok} />
          <Small style={{ color: colour.ink }}>
            {trek.locationName}
            {trek.pioneerNumber !== null ? ` · #${String(trek.pioneerNumber).padStart(4, '0')}` : ''}
          </Small>
        </View>
      ) : null}
    </Card>
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

  row: { padding: 13 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  claim: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },

  emptyCard: { paddingVertical: 24 },
});
