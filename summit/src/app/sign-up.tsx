/**
 * Create the account a login can return to.
 *
 * Onboarding ends here rather than inside the app on purpose: an account made
 * in the first five minutes is the one that gets claimed. The guest path stays
 * -- it is how Summit wants first contact to work, and session.ts explains why
 * anonymous users are real users -- but as an explicit second choice under the
 * form, never a silent default.
 *
 * Email and password only. OAuth providers are off in the Supabase project;
 * when one is switched on it earns its own button here and on /log-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, SummitMark } from '@/components/icons';
import { Body, Button, Card, H1, Label, Small } from '@/components/ui';
import { continueAsGuest, signUpWithEmail } from '@/features/auth/session';
import { colour, font, radius, space } from '@/theme/tokens';

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function markOnboarded() {
    // Same flag onboarding writes; this tab has seen the intro either way.
    void AsyncStorage.setItem('@summit/onboarding_done', 'true');
  }

  async function handleSignUp() {
    if (busy) return;
    setError(null);

    const trimmed = email.trim();
    if (!trimmed.includes('@') || password.length < 6) {
      setFieldError('An email, and a password of at least 6 characters.');
      return;
    }
    setFieldError(null);

    setBusy(true);
    try {
      const { needsConfirmation } = await signUpWithEmail(trimmed, password);
      markOnboarded();
      if (needsConfirmation) {
        // The user row exists; only the emailed link is missing. Say so and
        // route to where the confirmation completes: logging in.
        setNote(
          `Almost there. Click the link we sent to ${trimmed}, then log in. Your number is already reserved.`,
        );
        setBusy(false);
        return;
      }
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function handleGuest() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      markOnboarded();
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
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + space.gap.lg },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <View style={styles.navHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
          <BackIcon size={18} color={colour.ink} />
        </Pressable>
        <View style={styles.brandRow}>
          <SummitMark size={20} color={colour.forest} />
          <Small style={styles.wordmark}>SUMMIT</Small>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <Label style={{ color: colour.forest }}>One minute now</Label>
      <H1 style={{ marginTop: 4 }}>
        Claim your{'\n'}number
      </H1>
      <Body style={{ marginTop: 6, color: colour.muted }}>
        An email and a password is all it takes. Everything you earn is stamped
        with a permanent number that belongs to this account, not this phone.
      </Body>

      {note ? (
        <>
          <Card variant="sandy" style={styles.noteCard}>
            <Label>Email sent</Label>
            <Small style={{ color: '#5C6B57', lineHeight: 18, marginTop: 4 }}>{note}</Small>
          </Card>
          <View style={{ marginTop: 14 }}>
            <Button label="Go to log in" full onPress={() => router.replace('/log-in')} />
          </View>
          <View style={{ marginTop: 9 }}>
            <Button label="Explore as guest for now" variant="ghost" full onPress={handleGuest} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.form}>
            <TextInput
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                if (fieldError || error) {
                  setFieldError(null);
                  setError(null);
                }
              }}
              placeholder="you@somewhere.com"
              placeholderTextColor={colour.dim}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              style={styles.input}
            />
            <TextInput
              value={password}
              onChangeText={(next) => {
                setPassword(next);
                if (fieldError || error) {
                  setFieldError(null);
                  setError(null);
                }
              }}
              placeholder="Password (6+ characters)"
              placeholderTextColor={colour.dim}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              onSubmitEditing={handleSignUp}
              style={[styles.input, { marginTop: 10 }]}
            />

            {fieldError ? (
              <Small style={{ color: colour.stop, marginTop: 8 }}>{fieldError}</Small>
            ) : null}

            {error ? (
              <Card style={[styles.errorCard, fieldError && { marginTop: 8 }]}>
                <Small style={{ color: colour.stop }}>{error}</Small>
              </Card>
            ) : null}

            <View style={{ marginTop: 14 }}>
              <Button label="Create account" full loading={busy} onPress={handleSignUp} />
            </View>
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Small style={{ color: colour.muted }}>or</Small>
            <View style={styles.dividerLine} />
          </View>

          <Button label="Keep exploring as a guest" variant="ghost" full onPress={handleGuest} />
        </>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log in to an existing account"
        onPress={() => router.replace('/log-in')}
        style={({ pressed }) => [styles.footerLink, pressed && { opacity: 0.7 }]}>
        <Small style={{ color: colour.muted }}>Already climbing?</Small>
        <Small style={{ color: colour.forest, fontFamily: font.uiSemi }}>Log in</Small>
      </Pressable>
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.bg },
  content: { paddingHorizontal: space.screenX, gap: 4 },

  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.gap.md,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.line,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wordmark: {
    fontFamily: font.wordmark,
    fontSize: 12,
    letterSpacing: 2,
    color: colour.forest,
  },

  form: { marginTop: space.gap.lg },

  input: {
    borderRadius: radius.control,
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colour.ink,
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 14,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colour.line },

  noteCard: { marginTop: space.gap.lg, padding: 14 },
  errorCard: { borderColor: colour.stop, marginTop: 8 },

  footerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: space.gap.sm,
  },
});
