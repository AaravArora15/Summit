/**
 * Settings, reached from Profile's gear icon.
 *
 * Deliberately small. Two actions live here. Renaming is ordinary maintenance:
 * a Sheet over this screen, validated and normalised by the RPC, with every
 * name-bearing cache invalidated on success. The consequential one -- sign out
 * -- gets a real confirmation for an anonymous session specifically:
 * session.ts's own doctrine is that an anonymous identity has no credential to
 * sign back into, so signing out one is indistinguishable from deleting every
 * badge and pioneer number earned on it. A linked identity (Apple/Google) has
 * no such trap, so it skips the warning.
 */
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackIcon, ChevronIcon } from '@/components/icons';
import { Body, Button, Card, H2, Label, Sheet, Small } from '@/components/ui';
import { attachCredentials, signOut, useSession } from '@/features/auth/session';
import { alertUser, confirmUser } from '@/lib/alert';
import { useProfile, useRename } from '@/lib/queries';
import { colour, radius, space } from '@/theme/tokens';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useSession();
  const { data: profile } = useProfile();
  const [signingOut, setSigningOut] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const rename = useRename();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [linkResult, setLinkResult] = useState<'linked' | 'confirm-email' | null>(null);

  const isAnonymous = session.status === 'signed-in' && session.isAnonymous;

  async function handleRename() {
    if (rename.isPending) return;
    try {
      // The server returns the normalised form; adopting it here means the
      // field never disagrees with what was actually stored.
      const stored = await rename.mutateAsync(draftName.trim());
      setDraftName(stored);
      setRenameOpen(false);
    } catch {
      // Shown inside the sheet from rename.error.
    }
  }

  async function handleLinkEmail() {
    const email = linkEmail.trim().toLowerCase();
    const password = linkPassword.trim();
    if (!email || password.length < 6) {
      setLinkError('Password must be at least 6 characters.');
      return;
    }
    setLinkBusy(true);
    setLinkError('');
    try {
      const { needsConfirmation } = await attachCredentials(email, password);
      setLinkResult(needsConfirmation ? 'confirm-email' : 'linked');
    } catch (e: any) {
      setLinkError(e.message || 'Could not link email.');
    } finally {
      setLinkBusy(false);
    }
  }

  function handleSignOut() {
    if (isAnonymous) {
      confirmUser(
        'Sign out as a guest?',
        `${profile.explorerNumber !== null ? `Explorer #${String(profile.explorerNumber).padStart(4, '0')} has no linked email — ` : 'This session has no linked email — '}signing out loses every badge and pioneer number on this device for good. There is no way back into this identity afterward.`,
        doSignOut,
        { confirmLabel: 'Sign out anyway', destructive: true },
      );
    } else {
      confirmUser('Sign out?', undefined, doSignOut, { confirmLabel: 'Sign out', destructive: true });
    }
  }

  async function doSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      // AuthGate in _layout.tsx watches the session and redirects to
      // /sign-in on its own once this resolves; nothing to navigate here.
    } catch {
      setSigningOut(false);
      alertUser('Could not sign out', 'Check your connection and try again.');
    }
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
        <H2>Settings</H2>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, gap: 12 }}
        showsVerticalScrollIndicator={false}>
        <Card style={styles.identityCard}>
          <Label>Signed in as</Label>
          <Body style={{ marginTop: 2, color: colour.ink }}>
            {profile.name} · {profile.standing}
          </Body>
          {isAnonymous ? (
            <Small style={{ marginTop: 6, color: colour.warn }}>
              Guest session — not linked to an email or account
            </Small>
          ) : null}
        </Card>

        {isAnonymous ? (
          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              onPress={() => { setLinkOpen(true); setLinkResult(null); setLinkEmail(''); setLinkPassword(''); setLinkError(''); }}
              style={({ pressed }) => pressed && { opacity: 0.8 }}>
              <Card style={styles.row}>
                <Small style={{ color: colour.ink }}>Link email to this account</Small>
                <ChevronIcon size={15} color={colour.muted} />
              </Card>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <Row
            label="Username"
            value={profile.name}
            onPress={() => {
              setDraftName(profile.name);
              setRenameOpen(true);
            }}
          />
          <Row label="Sign out" tone="destructive" onPress={handleSignOut} busy={signingOut} />
        </View>

        {profile.isAdmin ? (
          <View style={styles.section}>
            <Row label="Review submissions" onPress={() => router.push('/review')} />
          </View>
        ) : null}

        <View style={styles.section}>
          <Row label="App version" value={Constants.expoConfig?.version ?? '1.0.0'} />
        </View>
      </ScrollView>

      <Sheet visible={renameOpen} onClose={() => setRenameOpen(false)}>
        <H2>Your name</H2>
        <Small style={{ color: colour.muted, lineHeight: 18, marginTop: 4 }}>
          Shown on leaderboards and in your groups. Two to thirty characters.
        </Small>
        <TextInput
          value={draftName}
          onChangeText={(next) => setDraftName(next)}
          placeholder="Climber #0472"
          placeholderTextColor={colour.dim}
          autoCorrect={false}
          autoComplete="off"
          maxLength={40}
          onSubmitEditing={handleRename}
          style={[styles.input, { marginTop: 12 }]}
        />
        {rename.error ? (
          <Small style={{ color: colour.stop, marginTop: 7 }}>{rename.error.message}</Small>
        ) : null}
        <View style={{ marginTop: 14 }}>
          <Button label="Save name" full loading={rename.isPending} onPress={handleRename} />
        </View>
        <View style={{ marginTop: 9 }}>
          <Button label="Cancel" variant="ghost" full onPress={() => setRenameOpen(false)} />
        </View>
      </Sheet>

      <Sheet visible={linkOpen} onClose={() => setLinkOpen(false)}>
        {linkResult === 'linked' ? (
          <>
            <H2>Email linked</H2>
            <Small style={{ color: colour.muted, lineHeight: 18, marginTop: 4 }}>
              Your guest badges and pioneer number are now tied to that email.
              You can sign in from any device using these credentials.
            </Small>
            <View style={{ marginTop: 14 }}>
              <Button label="Done" full onPress={() => setLinkOpen(false)} />
            </View>
          </>
        ) : linkResult === 'confirm-email' ? (
          <>
            <H2>Check your inbox</H2>
            <Small style={{ color: colour.muted, lineHeight: 18, marginTop: 4 }}>
              A confirmation link was sent to {linkEmail.trim()}. Tap it to finish
              linking. You can keep using Summit now — your badges are safe on
              this device either way.
            </Small>
            <View style={{ marginTop: 14 }}>
              <Button label="Got it" full onPress={() => setLinkOpen(false)} />
            </View>
          </>
        ) : (
          <>
            <H2>Link email</H2>
            <Small style={{ color: colour.muted, lineHeight: 18, marginTop: 4 }}>
              Tie this guest session to an email so you can sign in from another
              phone or after reinstalling. Your badges and explorer number stay
              on this account.
            </Small>
            <TextInput
              value={linkEmail}
              onChangeText={setLinkEmail}
              placeholder="you@email.com"
              placeholderTextColor={colour.dim}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              style={[styles.input, { marginTop: 12 }]}
            />
            <TextInput
              value={linkPassword}
              onChangeText={setLinkPassword}
              placeholder="Password (6+ characters)"
              placeholderTextColor={colour.dim}
              autoCapitalize="none"
              autoComplete="new-password"
              secureTextEntry
              textContentType="newPassword"
              style={[styles.input, { marginTop: 8 }]}
            />
            {linkError ? (
              <Small style={{ color: colour.stop, marginTop: 7 }}>{linkError}</Small>
            ) : null}
            <View style={{ marginTop: 14 }}>
              <Button label="Link email" full loading={linkBusy} onPress={handleLinkEmail} />
            </View>
            <View style={{ marginTop: 9 }}>
              <Button label="Cancel" variant="ghost" full onPress={() => setLinkOpen(false)} />
            </View>
          </>
        )}
      </Sheet>
    </View>
  );
}

function Row({
  label,
  value,
  tone,
  onPress,
  busy,
}: {
  label: string;
  value?: string;
  tone?: 'destructive';
  onPress?: () => void;
  busy?: boolean;
}) {
  const content = (
    <Card style={[styles.row, { opacity: busy ? 0.6 : 1 }]}>
      <Small style={tone === 'destructive' ? { color: colour.stop } : { color: colour.ink }}>
        {busy ? 'Signing out…' : label}
      </Small>
      {value ? <Small style={{ color: colour.dim }}>{value}</Small> : null}
      {onPress && tone !== 'destructive' ? (
        <ChevronIcon size={15} color={colour.muted} />
      ) : null}
    </Card>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={busy ? undefined : onPress}
      style={({ pressed }) => pressed && { opacity: 0.8 }}>
      {content}
    </Pressable>
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

  identityCard: { padding: 14 },
  section: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 13,
  },
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
});
