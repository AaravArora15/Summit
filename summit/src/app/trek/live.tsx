/**
 * Live trek, screen 09 of the v4 mockup.
 *
 * The screen someone glances at mid-walk, one-handed, in sunlight. So: three
 * numbers at size, one action, and nothing that needs reading.
 *
 * It ticks once a second and re-reads the track from SQLite rather than
 * accumulating in memory, because the background task writing those points runs
 * in a different JS context and cannot push into this one.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Chip, Data, H2, Label, Small } from '@/components/ui';
import { elapsedSeconds, formatDuration, useTrek } from '@/features/trek/store';
import { colour, space } from '@/theme/tokens';

export default function LiveTrekScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { phase, targetName, startedAt, distanceM, points, withPartner, refresh, arrive } =
    useTrek();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      refresh();
      forceTick((n) => n + 1); // elapsed is derived from the clock, not stored
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, refresh]);

  const elapsed = elapsedSeconds(startedAt);
  const km = (distanceM / 1000).toFixed(2);
  const pace = distanceM > 50 ? formatPace(elapsed, distanceM) : '--';

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.header}>
        <Label style={{ color: colour.sand }}>Trekking to</Label>
        <H2 style={{ color: colour.n50, marginTop: 2 }}>{targetName ?? 'Somewhere new'}</H2>
      </View>

      <View style={styles.stats}>
        <Stat label="Distance" value={km} unit="km" />
        <Stat label="Moving" value={formatDuration(elapsed)} />
        <Stat label="Pace" value={pace} unit="/km" />
      </View>

      {/* Honesty about the data, in the one place it matters. A trek with no
          fixes yet looks identical to a broken one unless you say so. */}
      <Card variant="ink" style={styles.status}>
        <Label style={{ color: 'rgba(242,242,238,0.6)' }}>Recording</Label>
        <Small style={{ color: 'rgba(242,242,238,0.75)', marginTop: 3 }}>
          {points.length === 0
            ? 'Waiting for a GPS fix. Under tree cover this can take a minute.'
            : `${points.length} points logged. Saved on the phone, uploaded when you have signal.`}
        </Small>
      </Card>

      {/* Self-reported, honour system — see the "with one other person"
          multiplier in award_claim_points(). Toggleable mid-walk since a
          partner can join partway through. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Walking with someone else"
        onPress={() => useTrek.getState().setWithPartner(!withPartner)}
        style={styles.partnerRow}>
        <Chip
          label={withPartner ? 'Walking with someone · on' : 'Walking with someone else?'}
          small
          tone={withPartner ? 'on' : 'default'}
          onDark={!withPartner}
        />
      </Pressable>

      <View style={styles.actions}>
        <Button
          label="I'm here"
          full
          chevron
          onPress={() => {
            arrive();
            router.push('/trek/arrival');
          }}
        />
        <Button
          label="Discard trek"
          variant="ghost"
          full
          small
          onPress={() => {
            useTrek.getState().end();
            useTrek.getState().reset();
            router.back();
          }}
        />
      </View>
    </View>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={styles.stat}>
      <Label style={{ color: 'rgba(242,242,238,0.6)' }}>{label}</Label>
      <View style={styles.statValue}>
        <Data style={{ fontSize: 34, color: colour.n50 }}>{value}</Data>
        {unit ? <Small style={{ color: 'rgba(242,242,238,0.6)' }}>{unit}</Small> : null}
      </View>
    </View>
  );
}

/** Minutes per kilometre, the unit walkers actually think in. */
function formatPace(seconds: number, metres: number): string {
  const secondsPerKm = seconds / (metres / 1000);
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.forest,
    paddingHorizontal: space.screenX,
  },
  header: { marginBottom: 28 },
  stats: { gap: 18 },
  stat: { gap: 2 },
  statValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  status: { marginTop: 'auto' },
  partnerRow: { alignSelf: 'flex-start', marginTop: 10, marginBottom: 12 },
  actions: { gap: 9 },
});
