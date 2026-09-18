/**
 * Suggest a location, reached from Explore's header and from Profile.
 *
 * Not in the v4 mockup — this is new, so it borrows rather than invents:
 * the photo step is the same camera-first/library-fallback flow as a secret
 * spot's proof of arrival (trek/arrival.tsx), and the coordinate is always
 * the device's own position, never typed in, for the same reason claiming a
 * location is proximity-checked rather than trusted from the client — a
 * suggestion is worth reviewing only if someone was actually standing there.
 *
 * A submission lands in `location_suggestions`, not `locations`: nothing
 * here becomes claimable until a human reviews it by hand (see
 * 0014_location_suggestions.sql). This screen's whole job is capturing that
 * one submission and saying so plainly, not promising it will appear anywhere.
 */
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, CheckIcon, PlusIcon } from '@/components/icons';
import { Button, Card, H2, Label, Small } from '@/components/ui';
import { useSession } from '@/features/auth/session';
import { suggestLocation, uploadSuggestionPhoto } from '@/lib/supabase';
import { colour, radius, space } from '@/theme/tokens';

type Fix = { lat: number; lng: number };
type Photo = { uri: string; mimeType?: string };

export default function SuggestScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSession();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [locating, setLocating] = useState(false);
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function captureLocation() {
    setError(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location access was not granted.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setFix({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setError('Could not get your location. Try again.');
    } finally {
      setLocating(false);
    }
  }

  async function capturePhoto(source: 'camera' | 'library') {
    setError(null);
    setCapturingPhoto(true);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(source === 'camera' ? 'Camera access was not granted.' : 'Photo library access was not granted.');
        return;
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      setPhoto({ uri: asset.uri, mimeType: asset.mimeType });
    } catch {
      setError('Could not open the camera. Try the photo library instead.');
    } finally {
      setCapturingPhoto(false);
    }
  }

  async function submit() {
    if (!fix || !name.trim() || session.status !== 'signed-in') return;
    setError(null);
    setSubmitting(true);
    try {
      let photoPath: string | undefined;
      if (photo) {
        try {
          photoPath = await uploadSuggestionPhoto(session.userId, photo.uri, photo.mimeType);
        } catch (uploadError) {
          // The name and coordinate are the part that matters. A photo that
          // fails to upload should not lose the whole suggestion.
          console.warn('[suggest] photo upload failed', uploadError);
        }
      }
      await suggestLocation({ name: name.trim(), lat: fix.lat, lng: fix.lng, notes: notes.trim() || undefined, photoPath });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.doneBody}>
          <Label style={{ color: colour.forest, letterSpacing: 2.4 }}>Sent</Label>
          <H2 style={{ marginTop: 8, textAlign: 'center' }}>Thanks for the find</H2>
          <Small style={{ textAlign: 'center', marginTop: 8, color: colour.dim }}>
            {"It's reviewed by hand before it joins the collection. You'll see it in My suggestions either way."}
          </Small>
        </View>
        <View style={{ gap: 9 }}>
          <Button label="See my suggestions" full onPress={() => router.replace('/suggestions')} />
          <Button label="Done" variant="ghost" full onPress={() => router.back()} />
        </View>
      </View>
    );
  }

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
        <H2>Suggest a location</H2>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 14 }}
        showsVerticalScrollIndicator={false}>
        <Small style={{ color: colour.dim }}>
          {"Found somewhere worth a badge that isn't in the collection yet? Send it in — someone reviews it before it joins."}
        </Small>

        <View style={styles.field}>
          <Label>Name</Label>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="What do you call this place?"
            placeholderTextColor={colour.dim}
            style={styles.input}
            maxLength={120}
          />
        </View>

        <View style={styles.field}>
          <Label>Notes (optional)</Label>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything worth knowing — how to find it, what makes it worth a badge"
            placeholderTextColor={colour.dim}
            style={[styles.input, styles.multiline]}
            multiline
            maxLength={1000}
          />
        </View>

        <View style={styles.field}>
          <Label>Location</Label>
          <Pressable onPress={captureLocation} disabled={locating}>
            <Card variant={fix ? 'sandy' : 'flat'} style={styles.captureCard}>
              {locating ? (
                <ActivityIndicator color={colour.forest} />
              ) : fix ? (
                <View style={styles.captureRow}>
                  <CheckIcon size={16} color={colour.forest} />
                  <Small style={{ color: colour.ink }}>
                    Captured · {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
                  </Small>
                </View>
              ) : (
                <Small style={{ textAlign: 'center', color: colour.dim }}>
                  Tap to use where you are standing right now
                </Small>
              )}
            </Card>
          </Pressable>
          {fix ? (
            <Pressable onPress={captureLocation}>
              <Small style={{ color: colour.forest, marginTop: 6 }}>Recapture</Small>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.field}>
          <Label>Photo (optional)</Label>
          {photo ? (
            <Card variant="flat" style={styles.captureCard}>
              <View style={styles.captureRow}>
                <CheckIcon size={16} color={colour.forest} />
                <Small style={{ color: colour.ink }}>Photo attached</Small>
              </View>
              <Pressable onPress={() => setPhoto(null)}>
                <Small style={{ color: colour.stop, marginTop: 6 }}>Remove</Small>
              </Pressable>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <Pressable
                onPress={() => capturePhoto('camera')}
                disabled={capturingPhoto}
                style={({ pressed }) => [styles.photoButton, pressed && { opacity: 0.8 }]}>
                <PlusIcon size={15} color={colour.ink} />
                <Small style={{ color: colour.ink }}>Camera</Small>
              </Pressable>
              <Pressable
                onPress={() => capturePhoto('library')}
                disabled={capturingPhoto}
                style={({ pressed }) => [styles.photoButton, pressed && { opacity: 0.8 }]}>
                <PlusIcon size={15} color={colour.ink} />
                <Small style={{ color: colour.ink }}>Library</Small>
              </Pressable>
            </View>
          )}
        </View>

        {error ? (
          <Card style={styles.errorCard}>
            <Small style={{ color: colour.stop }}>{error}</Small>
          </Card>
        ) : null}

        <Button label="Send suggestion" full loading={submitting} onPress={submit} />
        {!fix ? (
          <Small style={{ textAlign: 'center', color: colour.dim }}>
            Capture a location before sending.
          </Small>
        ) : null}
      </ScrollView>
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

  field: { gap: 8 },
  input: {
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colour.ink,
  },
  multiline: { minHeight: 88, textAlignVertical: 'top' },

  captureCard: { alignItems: 'center', paddingVertical: 16 },
  captureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  photoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
  },

  doneBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorCard: { borderColor: colour.stop },
});
