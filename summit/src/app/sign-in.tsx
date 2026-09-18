/**
 * The Onboarding flow, ported from Screens 01-04 of design-mockup-v4.html.
 *
 * 01 WELCOME: Mountain illustration, product mission, live places count.
 * 02 INTERESTS: Terrain & activity calibration (10 categories, >=3 selection).
 * 03 IDENTITY: Scarcity mechanism, permanent founding number, pioneer cap.
 * 04 THE DEAL: Safety contract (no speed pressure, closures win, permanent progress).
 *
 * Nothing here signs anyone in. Finishing step 04 hands off to /sign-up, which
 * offers a real account first and an explicit guest session second; "Already
 * climbing?" on the welcome screen opens /log-in instead of continuing on.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/components/badge';
import {
  AlertTriangleIcon,
  BackIcon,
  CoastalIcon,
  CyclingIcon,
  FortIcon,
  HomeIcon,
  IslandsIcon,
  RefreshIcon,
  RunningIcon,
  ScenicIcon,
  ShieldCheckIcon,
  SummitMark,
  TimerOffIcon,
  TreeIcon,
  UrbanIcon,
  WalkingIcon,
} from '@/components/icons';
import {
  Body,
  Button,
  Card,
  Chip,
  Data,
  H1,
  H3,
  Label,
  MountainHero,
  ProgressBar,
  Small,
  StepDots,
} from '@/components/ui';
import { prepareClosureAlerts } from '@/features/trek/closure-alerts';
import { colour, font, radius, space } from '@/theme/tokens';

const DEMO_TAKEN = 47;
const DEMO_CAP = 500;

type TerrainOption = {
  id: string;
  name: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
};

const TERRAIN_OPTIONS: TerrainOption[] = [
  { id: 'hiking', name: 'Hiking', Icon: HomeIcon },
  { id: 'walking', name: 'Walking', Icon: WalkingIcon },
  { id: 'cycling', name: 'Cycling', Icon: CyclingIcon },
  { id: 'running', name: 'Running', Icon: RunningIcon },
  { id: 'nature', name: 'Nature', Icon: TreeIcon },
  { id: 'scenic', name: 'Scenic views', Icon: ScenicIcon },
  { id: 'urban', name: 'Urban', Icon: UrbanIcon },
  { id: 'coastal', name: 'Coastal', Icon: CoastalIcon },
  { id: 'heritage', name: 'Heritage', Icon: FortIcon },
  { id: 'islands', name: 'Islands', Icon: IslandsIcon },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([
    'hiking',
    'nature',
    'scenic',
    'coastal',
  ]);
  const [privacyHomeProtected, setPrivacyHomeProtected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleInterest(id: string) {
    setSelectedInterests((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  async function persistCalibration() {
    // Save user calibration preferences
    await AsyncStorage.setItem('@summit/interests', JSON.stringify(selectedInterests));
    await AsyncStorage.setItem('@summit/onboarding_done', 'true');
  }

  /**
   * The deal is agreed. Calibration is saved here so it holds whichever door
   * the next screen takes; the session itself is /sign-up's business.
   *
   * Closure-alert permission is requested here too, right where the promise
   * ("...cannot be switched off") is made — not awaited, so a slow or
   * ignored OS prompt never blocks getting to /sign-up. See
   * features/trek/closure-alerts.ts for what this permission does and does
   * not yet cover.
   */
  async function handleAgreeAndContinue() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await persistCalibration();
      void prepareClosureAlerts();
      setBusy(false);
      router.push('/sign-up');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      {step === 0 && (
        <WelcomeStep insets={insets} onNext={() => setStep(1)} onLogIn={() => router.push('/log-in')} />
      )}

      {step === 1 && (
        <InterestsStep
          insets={insets}
          selected={selectedInterests}
          onToggle={toggleInterest}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <IdentityStep
          insets={insets}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <SafetyContractStep
          insets={insets}
          privacyEnabled={privacyHomeProtected}
          onTogglePrivacy={setPrivacyHomeProtected}
          onBack={() => setStep(2)}
          onAgree={handleAgreeAndContinue}
          busy={busy}
          error={error}
        />
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 01: Welcome                                                           */
/* -------------------------------------------------------------------------- */

function WelcomeStep({
  insets,
  onNext,
  onLogIn,
}: {
  insets: { top: number; bottom: number };
  onNext: () => void;
  onLogIn: () => void;
}) {
  return (
    <View style={styles.stepContainer}>
      {/* Top illustration layer */}
      <View style={[styles.heroLayer, { height: 260 }]}>
        <MountainHero height={260} />
      </View>

      {/* Header bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.brandRow}>
          <SummitMark size={24} color={colour.forest} />
          <Text style={styles.wordmark}>SUMMIT</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log in to an existing account"
          onPress={onLogIn}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <Text style={styles.skipText}>Log in</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />

      {/* Bottom Content Sheet */}
      <View
        style={[
          styles.welcomeSheet,
          { paddingBottom: insets.bottom + space.gap.md },
        ]}>
        <View style={styles.chipsRow}>
          <Chip label="World" colour={colour.forest} small />
          <Chip label="641 places live" small />
        </View>

        <H1 style={styles.welcomeTitle}>Every trail{'\n'}hides something</H1>

        <Body style={styles.welcomeBody}>
          Trek to places worth walking to, hunt the spots nobody signposts, and put
          your number on them first. Explore more, climb higher, together.
        </Body>

        <View style={styles.actions}>
          <Button label="Start Exploring" onPress={onNext} full chevron />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Log in to an existing account"
            onPress={onLogIn}
            style={({ pressed }) => [styles.signInLink, pressed && { opacity: 0.7 }]}>
            <Small style={{ color: colour.muted }}>Already climbing?</Small>
            <Small style={{ color: colour.forest, fontFamily: font.uiSemi }}>
              Log in
            </Small>
          </Pressable>
        </View>

        <View style={{ marginTop: space.gap.sm }}>
          <StepDots step={0} total={4} />
        </View>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 02: Interests & Terrain Calibration                                   */
/* -------------------------------------------------------------------------- */

function InterestsStep({
  insets,
  selected,
  onToggle,
  onBack,
  onNext,
}: {
  insets: { top: number; bottom: number };
  selected: string[];
  onToggle: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const met = selected.length >= 3;

  return (
    <View style={[styles.stepContainer, { paddingTop: insets.top + 8 }]}>
      <View style={styles.navHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
          <BackIcon size={18} color={colour.ink} />
        </Pressable>
        <StepDots step={1} total={4} />
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Label style={{ color: colour.forest }}>Step 02 · Calibration</Label>
        <H1 style={{ marginTop: 4 }}>What gets you{'\n'}outside?</H1>
        <Body style={{ marginTop: 6, color: colour.muted }}>
          Pick at least three. This shapes what surfaces near you, never what
          you are allowed to claim.
        </Body>

        <View style={styles.grid}>
          {TERRAIN_OPTIONS.map((item) => {
            const isSelected = selected.includes(item.id);
            const { Icon } = item;
            return (
              <Pressable
                key={item.id}
                onPress={() => onToggle(item.id)}
                style={({ pressed }) => [
                  styles.terrainCard,
                  isSelected && styles.terrainCardSelected,
                  pressed && { opacity: 0.8 },
                ]}>
                <Icon
                  size={24}
                  color={isSelected ? colour.forest : colour.ink}
                />
                <H3
                  style={[
                    styles.terrainName,
                    isSelected && { color: colour.forest },
                  ]}>
                  {item.name}
                </H3>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Bottom Sticky Action Bar */}
      <View
        style={[
          styles.bottomActionBar,
          { paddingBottom: insets.bottom + space.gap.md },
        ]}>
        <View style={styles.selectionCountRow}>
          <Label style={{ color: colour.ink }}>{selected.length} of 10 selected</Label>
          <Label style={{ color: met ? colour.ok : colour.muted }}>
            {met ? 'Minimum met' : 'Pick at least 3'}
          </Label>
        </View>
        <Button
          label="Continue"
          onPress={met ? onNext : undefined}
          full
          chevron
          variant={met ? 'primary' : 'ghost'}
        />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 03: Identity & Pioneer Numbers                                        */
/* -------------------------------------------------------------------------- */

function IdentityStep({
  insets,
  onBack,
  onNext,
}: {
  insets: { top: number; bottom: number };
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <View style={[styles.stepContainer, { paddingTop: insets.top + 8 }]}>
      <View style={styles.navHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
          <BackIcon size={18} color={colour.ink} />
        </Pressable>
        <StepDots step={2} total={4} />
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <View style={styles.identityHeader}>
          <Label style={{ color: colour.forest }}>Your permanent identity</Label>
          <Data style={styles.identityNumber}>#0472</Data>
          <Body style={styles.identityDesc}>
            The 472nd climber worldwide. This number never changes and never
            transfers.
          </Body>

          {/* Shield Medal Preview */}
          <View style={styles.shieldPreviewWrap}>
            <Badge width={76} tint={colour.forest} glyph="summit" band="WORLD" />
            <Text style={styles.pioneerSerialLabel}>
              Founding Pioneer · #0472
            </Text>
          </View>
        </View>

        {/* Sandy Info Card */}
        <Card variant="sandy" style={styles.sandyCard}>
          <View style={styles.sandyHeader}>
            <ShieldCheckIcon size={20} color={colour.forest} />
            <H3 style={{ color: colour.forest }}>How badge numbers work</H3>
          </View>

          <Small style={styles.sandyText}>
            Every place you reach stamps you with its own number, in the order
            you got there.
          </Small>

          {/* Demonstration Location Meter */}
          <View style={styles.demoLocationCard}>
            <View style={styles.demoLocationRow}>
              <Text style={styles.demoLocationTitle}>
                MACRITCHIE · PIONEER #0047
              </Text>
            </View>
            <View style={{ marginVertical: 8 }}>
              <ProgressBar value={DEMO_TAKEN / DEMO_CAP} tint={colour.forest} />
            </View>
            <View style={styles.demoLocationFooter}>
              <Label style={{ fontSize: 9 }}>47 of 500 claimed</Label>
              <Label style={{ fontSize: 9 }}>453 left</Label>
            </View>
          </View>

          <Small style={[styles.sandyText, { marginTop: 10 }]}>
            Each place caps at 500 pioneer numbers. After that the badge is still
            yours — in its Explorer edition, without a number.{' '}
            <Text style={{ fontFamily: font.uiBold, color: colour.forest }}>
              Nothing is ever locked behind being early.
            </Text>
          </Small>
        </Card>
      </ScrollView>

      <View
        style={[
          styles.bottomActionBar,
          { paddingBottom: insets.bottom + space.gap.md },
        ]}>
        <Button label="Claim My Number" onPress={onNext} full chevron />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 04: Trek & Safety Contract                                            */
/* -------------------------------------------------------------------------- */

function SafetyContractStep({
  insets,
  privacyEnabled,
  onTogglePrivacy,
  onBack,
  onAgree,
  busy,
  error,
}: {
  insets: { top: number; bottom: number };
  privacyEnabled: boolean;
  onTogglePrivacy: (val: boolean) => void;
  onBack: () => void;
  onAgree: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <View style={[styles.stepContainer, { paddingTop: insets.top + 8 }]}>
      <View style={styles.navHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}>
          <BackIcon size={18} color={colour.ink} />
        </Pressable>
        <StepDots step={3} total={4} />
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Label style={{ color: colour.forest }}>Step 04 · The deal</Label>
        <H1 style={{ marginTop: 4 }}>Four promises</H1>
        <Body style={{ marginTop: 6, color: colour.muted }}>
          Summit scores distance and time. These four rules stop that from
          turning into pressure.
        </Body>

        <View style={styles.promisesList}>
          <PromiseRow
            Icon={TimerOffIcon}
            title="No timers on discoveries"
            desc="A place waits. Nothing you have not claimed can expire."
          />
          <PromiseRow
            Icon={ShieldCheckIcon}
            title="Points reward going, not racing"
            desc="Distance and moving time only. No speed multiplier, ever."
          />
          <PromiseRow
            Icon={AlertTriangleIcon}
            title="Closures always win"
            desc="If a trail is shut, the badge waits with it. Weather and closure alerts cannot be switched off."
          />
          <PromiseRow
            Icon={RefreshIcon}
            title="A quiet month costs you nothing"
            desc="Only the monthly leaderboard resets. Badges, numbers, sets, titles and level are permanent."
          />
        </View>

        {/* Privacy Switch Card */}
        <Card variant="flat" style={styles.privacyCard}>
          <Switch
            value={privacyEnabled}
            onValueChange={onTogglePrivacy}
            trackColor={{ false: colour.n200, true: colour.forest }}
            thumbColor={colour.n50}
          />
          <Small style={styles.privacyText}>
            Location while trekking. Precise home area stays hidden by default.
          </Small>
        </Card>

        {error ? (
          <Card style={styles.errorCard}>
            <Small style={{ color: colour.stop }}>{error}</Small>
          </Card>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.bottomActionBar,
          { paddingBottom: insets.bottom + space.gap.md },
        ]}>
        <Button
          label="Agree & Continue"
          onPress={onAgree}
          full
          chevron
          loading={busy}
        />
        <Small style={styles.legalNotice}>Terms · Privacy · Trail safety</Small>
      </View>
    </View>
  );
}

function PromiseRow({
  Icon,
  title,
  desc,
}: {
  Icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <Card style={styles.promiseCard}>
      <View style={styles.promiseIconWrap}>
        <Icon size={22} color={colour.forest} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <H3 style={{ fontSize: 14 }}>{title}</H3>
        <Small style={{ color: colour.muted, lineHeight: 16 }}>{desc}</Small>
      </View>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colour.bg,
  },
  stepContainer: {
    flex: 1,
  },

  // Welcome Hero
  heroLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F5F3ED',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.screenX,
    zIndex: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wordmark: {
    fontFamily: font.wordmark,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    color: colour.forest,
  },
  skipText: {
    fontFamily: font.uiSemi,
    fontSize: 13,
    color: colour.forest,
  },

  welcomeSheet: {
    backgroundColor: colour.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: space.screenX,
    paddingTop: space.gap.lg,
    gap: space.gap.sm,
    borderTopWidth: 1,
    borderColor: colour.line,
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  welcomeTitle: {
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.8,
    marginTop: 4,
  },
  welcomeBody: {
    color: colour.ink2,
    fontSize: 15,
    lineHeight: 21,
  },
  actions: {
    marginTop: space.gap.sm,
    gap: 10,
  },
  signInLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },

  // Navigation Header
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.screenX,
    paddingBottom: space.gap.sm,
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
  scrollContent: {
    paddingHorizontal: space.screenX,
    paddingBottom: 100,
  },

  // Interests Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: space.gap.md,
  },
  terrainCard: {
    width: '48%',
    backgroundColor: colour.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colour.line,
    padding: 14,
    minHeight: 88,
    justifyContent: 'space-between',
  },
  terrainCardSelected: {
    backgroundColor: colour.sageLight,
    borderColor: colour.forest,
  },
  terrainName: {
    fontSize: 14,
    fontFamily: font.uiSemi,
    marginTop: 8,
  },

  bottomActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colour.bg,
    borderTopWidth: 1,
    borderColor: colour.line,
    paddingHorizontal: space.screenX,
    paddingTop: 10,
    gap: 8,
  },
  selectionCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Identity Step
  identityHeader: {
    alignItems: 'center',
    textAlign: 'center',
    marginTop: space.gap.sm,
  },
  identityNumber: {
    fontSize: 42,
    lineHeight: 46,
    color: colour.forest,
    marginTop: 4,
  },
  identityDesc: {
    textAlign: 'center',
    maxWidth: 280,
    marginTop: 6,
    color: colour.muted,
  },
  shieldPreviewWrap: {
    alignItems: 'center',
    marginTop: 18,
    gap: 8,
  },
  pioneerSerialLabel: {
    fontFamily: font.uiSemi,
    fontSize: 12,
    color: colour.ink,
    letterSpacing: 0.4,
  },

  sandyCard: {
    marginTop: space.gap.lg,
    padding: 14,
    borderRadius: radius.card,
  },
  sandyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sandyText: {
    color: '#5C6B57',
    lineHeight: 18,
  },
  demoLocationCard: {
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: '#E8DCC5',
    borderRadius: radius.row,
    padding: 10,
    marginTop: 10,
  },
  demoLocationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  demoLocationTitle: {
    fontFamily: font.uiBold,
    fontSize: 12,
    color: colour.ink,
    letterSpacing: 0.5,
  },
  demoLocationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  // Safety Promises
  promisesList: {
    gap: 10,
    marginTop: space.gap.md,
  },
  promiseCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
  },
  promiseIconWrap: {
    marginTop: 2,
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginTop: space.gap.sm,
  },
  privacyText: {
    flex: 1,
    color: colour.ink,
    lineHeight: 16,
  },
  errorCard: {
    borderColor: colour.stop,
    marginTop: space.gap.sm,
  },
  legalNotice: {
    color: colour.muted,
    textAlign: 'center',
    fontSize: 11,
  },

});
