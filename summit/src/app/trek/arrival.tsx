/**
 * Arrival and claim, screens 11 and 12 of the v4 mockup.
 *
 * The moment the whole product exists for. The design rule that governs this
 * screen: the number is never shown until the server has issued it. A pioneer
 * number displayed optimistically and then withdrawn would break the one
 * promise the product makes, so the states here are honest about waiting.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BadgeReveal } from '@/components/badge-reveal';
import { Body, Button, Card, Data, H1, Label, Small } from '@/components/ui';
import { takeDevFakeOutcome } from '@/features/trek/dev-fake-claim';
import { useTrek } from '@/features/trek/store';
import { syncTrek, type SyncOutcome } from '@/features/trek/sync';
import { shortBand, useWildcard } from '@/lib/queries';
import { claimPointsBreakdown, type ClaimPointsRow } from '@/lib/supabase';
import { colour, rarityColour, space } from '@/theme/tokens';

/** Copy for each points_ledger source (see award_claim_points(), 0012) —
 *  what a claim can pay for, in the order the reward screen lists them. */
const SOURCE_LABEL: Record<ClaimPointsRow['source'], string> = {
  distance: 'Distance',
  moving_time: 'Moving time',
  badge: 'Badge',
  new_route: 'First stop in a new set',
  difficulty: 'Difficulty',
  set_complete: 'Set complete',
  secret_spot: 'Secret spot',
  beat_average: 'Faster than average',
  wildcard: "Today's Wildcard",
};
const SOURCE_ORDER: ClaimPointsRow['source'][] = [
  'distance',
  'moving_time',
  'new_route',
  'difficulty',
  'badge',
  'wildcard',
  'set_complete',
  'secret_spot',
  'beat_average',
];

export default function ArrivalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const {
    trekId,
    targetLocationId,
    targetName,
    targetRarity,
    targetGlyph,
    targetIsSecret,
    targetIsWildcard,
    distanceM,
    withPartner,
  } = useTrek();
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [busy, setBusy] = useState(true);
  const [photo, setPhoto] = useState<{ uri: string; mimeType?: string } | null>(null);

  // A secret spot cannot be claimed without a photo (claim_location() refuses
  // it server-side), so the screen asks for one before it ever tries, rather
  // than uploading a whole track just to have the claim half bounce. A public
  // location skips straight to syncing: `needsPhoto` starts false for it and
  // stays false, since `photo` never becomes required.
  const [needsPhoto, setNeedsPhoto] = useState(targetIsSecret);

  useEffect(() => {
    // Stop the location task the moment this screen mounts, whether or not a
    // photo is still pending: recording nothing further to submit.
    useTrek.getState().end();
  }, []);

  useEffect(() => {
    if (needsPhoto) return; // waiting on <PhotoStep>, below

    // A dev "fake claim" (see dev-fake-claim.ts) already did the real upload
    // and claim server-side before navigating here — there is no local trek
    // to sync, so its outcome is used as-is instead of calling syncTrek().
    const fakeOutcome = takeDevFakeOutcome();
    if (fakeOutcome) {
      setOutcome(fakeOutcome);
      setBusy(false);
      return;
    }

    let cancelled = false;

    (async () => {
      if (!trekId) {
        if (!cancelled) {
          setOutcome({ status: 'deferred', reason: 'No trek in progress' });
          setBusy(false);
        }
        return;
      }

      const result = await syncTrek({
        localTrekId: trekId,
        locationId: targetLocationId,
        photoUri: photo?.uri,
        photoMimeType: photo?.mimeType,
        withPartner,
      });
      if (!cancelled) {
        setOutcome(result);
        setBusy(false);
        if (result.status === 'claimed') {
          // Invalidate all claim-dependent queries so the user sees updated
          // data when they navigate back to the app. The wildcard query is
          // included here for the Wildcard reveal case.
          void queryClient.invalidateQueries({ queryKey: ['wildcard'] });
          void queryClient.invalidateQueries({ queryKey: ['profile'] });
          void queryClient.invalidateQueries({ queryKey: ['collection'] });
          void queryClient.invalidateQueries({ queryKey: ['set-progress'] });
          void queryClient.invalidateQueries({ queryKey: ['recent-badges'] });
          void queryClient.invalidateQueries({ queryKey: ['league'] });
          void queryClient.invalidateQueries({ queryKey: ['standings'] });
          void queryClient.invalidateQueries({ queryKey: ['badges'] });
          void queryClient.invalidateQueries({ queryKey: ['locations-near'] });
          void queryClient.invalidateQueries({ queryKey: ['secret-spots-near'] });
          void queryClient.invalidateQueries({ queryKey: ['treks'] });
          void queryClient.invalidateQueries({ queryKey: ['group-standings'] });
          void queryClient.invalidateQueries({ queryKey: ['territory-map-data'] });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsPhoto, trekId, targetLocationId, photo, withPartner, targetIsWildcard, queryClient]);

  if (needsPhoto) {
    return (
      <PhotoStep
        onPhoto={(p) => {
          setPhoto(p);
          setNeedsPhoto(false);
        }}
        onSkip={() => setNeedsPhoto(false)}
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.body}>
        <Label style={{ color: colour.forest, letterSpacing: 2.4 }}>
          {targetIsWildcard || targetName ? 'You made it' : 'Walk complete'}
        </Label>
        <H1 style={styles.title}>
          {targetIsWildcard ? "Today's Wildcard" : (targetName ?? 'Free walk')}
        </H1>
        <Small style={{ textAlign: 'center', marginTop: 6 }}>
          {(distanceM / 1000).toFixed(2)} km walked
        </Small>

        <View style={styles.result}>
          {busy ? (
            <Pending />
          ) : (
            <Outcome
              outcome={outcome}
              targetName={targetName}
              targetRarity={targetRarity}
              targetGlyph={targetGlyph}
              targetIsWildcard={targetIsWildcard}
            />
          )}
        </View>
      </View>

      <Button
        label="Done"
        full
        onPress={() => {
          useTrek.getState().reset();
          router.dismissAll();
        }}
      />
    </View>
  );
}

/**
 * Proof of a secret spot, asked for before the track ever leaves the phone.
 *
 * Camera first, library as a fallback: a photo taken here and now is what the
 * claim is meant to prove, and a library pick is a lesser but honest substitute
 * for a platform where the camera is unavailable (the web preview, mainly).
 * Skipping is allowed rather than blocked, because the walk still counts for
 * distance, time and the league even if this one claim does not go through;
 * see the "rejected" state in <Outcome>, which is exactly what a skip leads to.
 */
function PhotoStep({
  onPhoto,
  onSkip,
}: {
  onPhoto: (photo: { uri: string; mimeType?: string }) => void;
  onSkip: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture(source: 'camera' | 'library') {
    setError(null);
    setBusy(true);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setError(
          source === 'camera'
            ? 'Camera access was not granted.'
            : 'Photo library access was not granted.',
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });

      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0];
      onPhoto({ uri: asset.uri, mimeType: asset.mimeType });
    } catch {
      setError('Could not open the camera. Try the photo library instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <View style={styles.body}>
        <Label style={{ color: colour.forest, letterSpacing: 2.4 }}>Secret spot</Label>
        <H1 style={styles.title}>Add proof</H1>
        <Small style={{ textAlign: 'center', marginTop: 6 }}>
          Secret spots need a photo taken here, as evidence you found it.
        </Small>

        <View style={styles.result}>
          <Card variant="flat" style={styles.card}>
            {busy ? (
              <ActivityIndicator color={colour.forest} />
            ) : (
              <Small style={{ textAlign: 'center' }}>
                {error ?? 'A quick photo of the marker or the view is enough.'}
              </Small>
            )}
          </Card>
        </View>
      </View>

      <View style={{ gap: 9 }}>
        <Button label="Take photo" full chevron onPress={() => capture('camera')} />
        <Button label="Choose from library" variant="ghost" full small onPress={() => capture('library')} />
        <Button label="Skip · will not claim" variant="ghost" full small onPress={onSkip} />
      </View>
    </View>
  );
}

function Pending() {
  return (
    <Card variant="flat" style={styles.card}>
      <ActivityIndicator color={colour.forest} />
      <Small style={{ textAlign: 'center', marginTop: 10 }}>
        Sending your track for verification. The number is issued by the server,
        so it lands in a moment.
      </Small>
    </Card>
  );
}

function Outcome({
  outcome,
  targetName,
  targetRarity,
  targetGlyph,
  targetIsWildcard,
}: {
  outcome: SyncOutcome | null;
  targetName: string | null;
  targetRarity: string | null;
  targetGlyph: string | null;
  targetIsWildcard: boolean;
}) {
  // Always called (rules of hooks), only ever read from for a Wildcard
  // claim below — every other outcome ignores it entirely.
  const { data: wildcard } = useWildcard();

  if (!outcome) return null;

  if (outcome.status === 'claimed') {
    const { pioneer_number, edition } = outcome.result;
    // A Wildcard hunt never carried targetName/targetRarity/targetGlyph in
    // the first place (see store.ts's targetIsWildcard) — the reveal comes
    // from my_wildcard() itself, now that `claimed` unlocks it, rather than
    // anything this screen already knew going in. Every other claim keeps
    // using the display conveniences carried from the pin the trek was
    // started from (real, but not server-issued the way pioneer_number is).
    // A secret spot carries neither, so it falls back to the system's own
    // "unknown identity" tint rather than inventing a rarity.
    const revealName = targetIsWildcard ? (wildcard.kind === 'active' ? wildcard.name : null) : targetName;
    const revealRarity = targetIsWildcard
      ? wildcard.kind === 'active'
        ? wildcard.rarity
        : null
      : targetRarity;
    const revealGlyph = targetIsWildcard
      ? wildcard.kind === 'active'
        ? wildcard.glyph
        : null
      : targetGlyph;
    const tint =
      revealRarity && revealRarity in rarityColour
        ? rarityColour[revealRarity as keyof typeof rarityColour]
        : rarityColour.mystery;
    return (
      <>
        <BadgeReveal
          band={revealName ? shortBand(revealName) : undefined}
          tint={tint}
          glyph={revealGlyph ?? undefined}
          width={148}
        />
        <Card variant="dark" style={[styles.card, styles.claimCard]}>
          <Label style={{ color: 'rgba(242,242,238,0.6)', fontSize: 8 }}>
            {edition === 'pioneer' ? 'Pioneer number' : 'Explorer edition'}
          </Label>
          <Data style={styles.number}>
            {pioneer_number === null ? 'Claimed' : `#${String(pioneer_number).padStart(4, '0')}`}
          </Data>
          <Small style={{ color: 'rgba(242,242,238,0.72)', textAlign: 'center', marginTop: 2, fontSize: 10.5 }}>
            {pioneer_number === null
              ? 'The five hundred numbers here are gone, but the badge is yours.'
              : 'Permanent. It never changes and never transfers.'}
          </Small>
        </Card>
        <PointsBreakdown claimId={outcome.result.claim_id} />
      </>
    );
  }

  if (outcome.status === 'recorded') {
    return (
      <Card variant="flat" style={styles.card}>
        <Label>Walk recorded</Label>
        <Body style={{ textAlign: 'center', marginTop: 6 }}>
          Nothing here to claim, but it counted for distance, time, and your league.
        </Body>
      </Card>
    );
  }

  if (outcome.status === 'rejected') {
    return (
      <Card variant="sandy" style={styles.card}>
        <Label style={{ color: colour.warn }}>Not claimed</Label>
        <Body style={{ textAlign: 'center', marginTop: 6, color: colour.ink2 }}>
          {outcome.reason}
        </Body>
        <Small style={{ textAlign: 'center', marginTop: 8 }}>
          The walk still counts for distance, time, and your league.
        </Small>
      </Card>
    );
  }

  return (
    <Card variant="flat" style={styles.card}>
      <Label>Saved on your phone</Label>
      <Body style={{ textAlign: 'center', marginTop: 6 }}>{outcome.reason}</Body>
      <Small style={{ textAlign: 'center', marginTop: 8 }}>
        It uploads by itself once you are back in signal.
      </Small>
    </Card>
  );
}

/**
 * The permanent-XP total behind the pioneer card above, broken out by
 * source (claim_points_breakdown(), 0021) — the same number `points_earned`
 * already shows on a claimed pin in Explore, just itemized here instead of
 * pre-summed. A separate component, not inlined in <Outcome>, so its query
 * only ever mounts once the claim has actually landed.
 */
function PointsBreakdown({ claimId }: { claimId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['claim-points', claimId],
    queryFn: () => claimPointsBreakdown(claimId),
  });

  // Silent while loading and on a failed fetch alike: a wrong or half-drawn
  // number here would contradict the one promise this whole screen makes
  // (see the file header) — better to say nothing than to guess.
  if (isLoading || !data || data.length === 0) return null;

  const total = data.reduce((sum, row) => sum + row.amount, 0);
  const bySource = new Map(data.map((row) => [row.source, row.amount]));

  return (
    <Card variant="flat" style={[styles.card, styles.pointsCard]}>
      <View style={styles.pointsHeader}>
        <Label>Points earned</Label>
        <Data style={{ fontSize: 16 }}>{total}</Data>
      </View>
      {SOURCE_ORDER.filter((source) => bySource.has(source)).map((source) => (
        <View key={source} style={styles.pointsRow}>
          <Small>{SOURCE_LABEL[source]}</Small>
          <Small style={{ color: colour.ink2 }}>+{bySource.get(source)}</Small>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.bg,
    paddingHorizontal: space.screenX,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center', marginTop: 10 },
  result: { alignSelf: 'stretch', marginTop: 26 },
  card: { alignItems: 'center' },
  claimCard: { marginTop: 10, paddingVertical: 10, paddingHorizontal: 14 },
  number: {
    fontSize: 32,
    color: colour.sand,
    marginTop: 2,
    letterSpacing: -0.6,
  },
  pointsCard: { alignItems: 'stretch', marginTop: 10, paddingVertical: 10, paddingHorizontal: 14 },
  pointsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
});
