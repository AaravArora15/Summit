/**
 * Arrival and claim, screens 11 and 12 of the v4 mockup.
 *
 * The moment the whole product exists for. The design rule that governs this
 * screen: the number is never shown until the server has issued it. A pioneer
 * number displayed optimistically and then withdrawn would break the one
 * promise the product makes, so the states here are honest about waiting.
 */
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Data, H1, Label, Small } from '@/components/ui';
import { useTrek } from '@/features/trek/store';
import { syncTrek, type SyncOutcome } from '@/features/trek/sync';
import { colour, space } from '@/theme/tokens';

export default function ArrivalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { trekId, targetLocationId, targetName, targetIsSecret, distanceM, withPartner } = useTrek();
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsPhoto, trekId, targetLocationId, photo, withPartner]);

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
        <Label style={{ color: colour.forest, letterSpacing: 2.4 }}>You made it</Label>
        <H1 style={styles.title}>{targetName ?? 'Somewhere new'}</H1>
        <Small style={{ textAlign: 'center', marginTop: 6 }}>
          {(distanceM / 1000).toFixed(2)} km walked
        </Small>

        <View style={styles.result}>
          {busy ? <Pending /> : <Outcome outcome={outcome} />}
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

function Outcome({ outcome }: { outcome: SyncOutcome | null }) {
  if (!outcome) return null;

  if (outcome.status === 'claimed') {
    const { pioneer_number, edition } = outcome.result;
    return (
      <Card variant="dark" style={styles.card}>
        <Label style={{ color: 'rgba(242,242,238,0.6)' }}>
          {edition === 'pioneer' ? 'Pioneer number' : 'Explorer edition'}
        </Label>
        <Data style={styles.number}>
          {pioneer_number === null ? 'Claimed' : `#${String(pioneer_number).padStart(4, '0')}`}
        </Data>
        <Small style={{ color: 'rgba(242,242,238,0.72)', textAlign: 'center', marginTop: 4 }}>
          {pioneer_number === null
            ? 'The five hundred numbers here are gone, but the badge is yours.'
            : 'Permanent. It never changes and never transfers.'}
        </Small>
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
  number: {
    fontSize: 44,
    color: colour.sand,
    marginTop: 4,
    letterSpacing: -1,
  },
});
