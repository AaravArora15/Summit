/**
 * Log into an account that already exists.
 *
 * The counterpart to onboarding's anonymous path: guests are how Summit starts,
 * credentials are how a guest survives a deleted app, a new phone, or -- in
 * development -- a second browser tab that needs to be somebody specific.
 * Deliberately only email and password here. OAuth providers are off in the
 * Supabase project; when one is switched on it earns its own button, not a
 * dead link pretending otherwise.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, SummitMark } from '@/components/icons';
import { Body, Button, Card, H1, Label, Small } from '@/components/ui';
import { signInWithEmail } from '@/features/auth/session';
import { colour, font, radius, space } from '@/theme/tokens';

export default function LogInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLogIn() {
    if (busy) return;
    setError(null);

    const trimmed = email.trim();
    if (!trimmed.includes('@') || !password) {
      setFieldError('Enter the email and password you saved.');
      return;
    }
    setFieldError(null);

    setBusy(true);
    try {
      await signInWithEmail(trimmed, password);
      // Same flag onboarding writes: this tab has seen the intro.
      await AsyncStorage.setItem('@summit/onboarding_done', 'true');
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

      <Label style={{ color: colour.forest }}>Welcome back</Label>
      <H1 style={{ marginTop: 4 }}>
        Your numbers{'\n'}are waiting
      </H1>
      <Body style={{ marginTop: 6, color: colour.muted }}>
        Badges, pioneer numbers and your league place live on the account, not
        the phone. Sign in and they come with you.
      </Body>

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
          placeholder="Password"
          placeholderTextColor={colour.dim}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          onSubmitEditing={handleLogIn}
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
          <Button label="Log in" full loading={busy} onPress={handleLogIn} />
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create an account"
        onPress={() => router.replace('/sign-up')}
        style={({ pressed }) => [styles.footerLink, pressed && { opacity: 0.7 }]}>
        <Small style={{ color: colour.muted }}>New here?</Small>
        <Small style={{ color: colour.forest, fontFamily: font.uiSemi }}>
          Create an account
        </Small>
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
