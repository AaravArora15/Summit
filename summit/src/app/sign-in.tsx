/**
 * The identity gate, screen 03 of the v4 mockup.
 *
 * The mockup's rule for this screen: the cap is taught in the first two
 * minutes, with a live meter, because a scarcity mechanic explained after
 * someone misses out reads as bait. So the number and the Explorer fallback are
 * both on screen before anyone has walked anywhere.
 *
 * The single action is "Start walking", not "Create account". See
 * features/auth/session.ts for why that is an anonymous Supabase user rather
 * than a local id, and why attaching Apple or Google later keeps the same row.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, H1, Label, ProgressBar, Small } from '@/components/ui';
import { continueAsGuest } from '@/features/auth/session';
import { colour, space } from '@/theme/tokens';

/** The example on screen. Real counts come from the location cards later. */
const DEMO_TAKEN = 47;
const DEMO_CAP = 500;

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await continueAsGuest();
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.gap.xl, paddingBottom: insets.bottom + space.gap.xl },
      ]}>
      <Label style={{ color: colour.muted }}>SUMMIT</Label>
      <H1 style={styles.title}>Every place keeps its first 500 names.</H1>
      <Body style={styles.blurb}>
        Walk somewhere and the number you are given is yours permanently. Not a
        streak, not a rank. A record of who got there first.
      </Body>

      <Card style={styles.meterCard}>
        <View style={styles.meterHead}>
          <Label>BUKIT TIMAH HILL</Label>
          <Label style={{ color: colour.muted }}>
            {DEMO_TAKEN} / {DEMO_CAP}
          </Label>
        </View>
        <ProgressBar value={DEMO_TAKEN / DEMO_CAP} />
        <Small style={styles.meterNote}>
          Past 500 a claim still succeeds, as an Explorer edition. Nothing is
          ever locked behind being early.
        </Small>
      </Card>

      {error ? (
        <Card style={styles.errorCard}>
          <Small style={{ color: colour.stop }}>{error}</Small>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button label={busy ? 'Starting…' : 'Start walking'} onPress={start} full />
        <Small style={styles.legal}>
          You can attach Apple or Google later. Your numbers stay on the same
          account when you do.
        </Small>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  content: { paddingHorizontal: space.screenX, gap: space.gap.md },
  title: { marginTop: space.gap.sm },
  blurb: { color: colour.muted },
  meterCard: { marginTop: space.gap.md, gap: space.gap.sm },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meterNote: { color: colour.muted, marginTop: space.gap.xs },
  errorCard: { borderColor: colour.stop },
  actions: { marginTop: space.gap.xl, gap: space.gap.sm },
  legal: { color: colour.muted, textAlign: 'center' },
});
