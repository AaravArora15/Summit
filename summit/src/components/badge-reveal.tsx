/**
 * The claim moment's reveal: the badge shield pops into the centre of the
 * screen with a soft, living aura behind it — not a burst so much as a
 * presence, closer to a voice-assistant orb's blob than a firework.
 *
 * `theme/tokens.ts` is explicit that depth here is hairlines and there are
 * "no coloured glows anywhere in the system" — a rule the rest of the app
 * keeps. This is the one deliberate exception, for the same reason the
 * pioneer-number card already breaks flat/no-shadow with a dark surface and
 * a lifted medal (see badge.tsx's own header comment for its precedent):
 * arrival is the single moment the whole product exists for, and it is
 * allowed to say so. The aura is still systematic rather than arbitrary —
 * it is always the badge's own tint, never a new colour.
 *
 * The aura is three overlapping circles, independently drifting and
 * breathing, each under heavy Gaussian blur and additively blended
 * (`blendMode="plus"`) so their overlaps brighten into a soft hot centre
 * rather than reading as three separate translucent discs — the actual
 * technique behind most "orb" effects, not a metaball shader (Skia can do
 * those too, but a real SDF/metaball pass is a much larger, riskier build
 * for what should read as a subtle effect, not the main event). Drawn on a
 * Skia canvas rather than composed from plain Views because RN's
 * View/StyleSheet has no real blur or additive-blend primitive at all —
 * Skia's shapes take Reanimated shared values directly as props, so this
 * still animates entirely on the UI thread.
 */
import { BlurMask, Canvas, Circle, RadialGradient, vec, type SkPoint } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Badge, type GlyphKey } from '@/components/badge';
import { colour, withAlpha } from '@/theme/tokens';

type BadgeRevealProps = {
  band?: string;
  tint?: string;
  glyph?: GlyphKey | string;
  width?: number;
};

export function BadgeReveal({ band, tint = colour.forest, glyph, width = 128 }: BadgeRevealProps) {
  const { width: screenWidth } = useWindowDimensions();
  // The pulse's whole point is to travel — most of the way across the
  // screen, not just clear of the badge — so its reach is anchored to the
  // screen, not the badge. The canvas has to be sized to match, since Skia
  // (unlike a plain RN View) actually clips its children to its own bounds.
  const pulseOuterR = screenWidth * 0.46;
  // +30 rather than a tight fit: the band's blur (6) extends past
  // pulseOuterR itself.
  const stage = pulseOuterR * 2 + 30;
  const cx = stage / 2;
  const cy = stage / 2;
  // Clears the shield's shoulders (its widest point) — the aura sits
  // outside this radius so it never sits on a half-hidden badge. The echo
  // pulse instead starts near zero, on purpose — see EchoRing below.
  const badgeRadius = width * 0.62;

  // Split from a single shared value on purpose: coupling opacity and scale
  // to the same curve meant the badge crossed the eye's "is this visible
  // yet" threshold at roughly the same moment it was already nearly full
  // size — so instead of watching it grow, it read as invisible, then
  // suddenly there, already big: a cut, not a grow. Fading in quickly while
  // still visibly scaling up afterward is what actually shows the growth.
  const badgeOpacity = useSharedValue(0);
  const badgeScale = useSharedValue(0);
  // Two continuous loops for as long as this is mounted: one slow, driving
  // the aura's drift and breathing; one driving the echo pulse's travel.
  const auraClock = useSharedValue(0);
  const echoClock = useSharedValue(0);

  useEffect(() => {
    badgeOpacity.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) });
    badgeScale.value = withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) });
    auraClock.value = withRepeat(withTiming(1, { duration: 5200, easing: Easing.linear }), -1);
    // A punchier cadence, now that the pulse travels much further — a
    // radar echo reads as an event, not a slow fade.
    echoClock.value = withRepeat(withTiming(1, { duration: 2500, easing: Easing.linear }), -1);
  }, [auraClock, badgeOpacity, badgeScale, echoClock]);

  const echoProgressB = useDerivedValue(() => (echoClock.value + 0.5) % 1);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeOpacity.value,
    transform: [
      { scale: 0.55 + badgeScale.value * 0.45 },
      { translateY: (1 - badgeScale.value) * 16 },
    ],
  }));

  return (
    <View style={[styles.stage, { width: stage, height: stage }]} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <AuraBlob
          clock={auraClock}
          origin={vec(cx, cy)}
          tint={tint}
          baseR={badgeRadius * 0.85}
          driftAmp={badgeRadius * 0.12}
          freqX={1}
          freqY={1.3}
          phase={0}
          rWobble={0.14}
          opacityBase={0.4}
          blur={26}
        />
        <AuraBlob
          clock={auraClock}
          origin={vec(cx, cy)}
          tint={tint}
          baseR={badgeRadius * 0.95}
          driftAmp={badgeRadius * 0.16}
          freqX={0.8}
          freqY={1.1}
          phase={2.1}
          rWobble={0.18}
          opacityBase={0.32}
          blur={30}
        />
        <AuraBlob
          clock={auraClock}
          origin={vec(cx, cy)}
          tint={tint}
          baseR={badgeRadius * 0.72}
          driftAmp={badgeRadius * 0.1}
          freqX={1.2}
          freqY={0.7}
          phase={4.2}
          rWobble={0.12}
          opacityBase={0.3}
          blur={22}
        />

        <EchoRing origin={vec(cx, cy)} tint={tint} progress={echoClock} outerR={pulseOuterR} />
        <EchoRing origin={vec(cx, cy)} tint={tint} progress={echoProgressB} outerR={pulseOuterR} />
      </Canvas>

      <Animated.View style={[StyleSheet.absoluteFill, styles.centre, badgeStyle]}>
        <Badge band={band} tint={tint} glyph={glyph} state="earned" width={width} preferVector />
      </Animated.View>
    </View>
  );
}

/**
 * One lobe of the aura. `clock` runs 0→1 on a loop; each blob reads it at
 * its own frequency and phase so the three drift and breathe out of sync
 * with each other rather than pulsing in lockstep, which is what makes the
 * overlap read as organic movement instead of one circle scaling.
 */
function AuraBlob({
  clock,
  origin,
  tint,
  baseR,
  driftAmp,
  freqX,
  freqY,
  phase,
  rWobble,
  opacityBase,
  blur,
}: {
  clock: SharedValue<number>;
  origin: SkPoint;
  tint: string;
  baseR: number;
  driftAmp: number;
  freqX: number;
  freqY: number;
  phase: number;
  rWobble: number;
  opacityBase: number;
  blur: number;
}) {
  const c = useDerivedValue(() =>
    vec(
      origin.x + Math.sin(clock.value * 2 * Math.PI * freqX + phase) * driftAmp,
      origin.y + Math.cos(clock.value * 2 * Math.PI * freqY + phase) * driftAmp,
    ),
  );
  const r = useDerivedValue(
    () => baseR * (1 + Math.sin(clock.value * 2 * Math.PI * freqX * 1.3 + phase) * rWobble),
  );
  const opacity = useDerivedValue(
    () => opacityBase * (0.75 + 0.25 * Math.sin(clock.value * 2 * Math.PI * freqY * 0.8 + phase + 1.4)),
  );

  return (
    <Circle c={c} r={r} color={tint} opacity={opacity} blendMode="plus">
      <BlurMask blur={blur} style="normal" />
    </Circle>
  );
}

/**
 * A radar-style echo: a filled disc pulsing outward, solid through most of
 * its area and fading only at its own edge — not a hollow band, and not a
 * flat-opacity disc either. A `strokeWidth`-based outline reads as thin no
 * matter how large it's set once the radius doing the travelling is a good
 * fraction of the screen; a radial gradient stays a real, filled presence at
 * any size. Two of these half a cycle out of phase (see `echoProgressB`
 * above) keep one always mid-pulse instead of a beat of silence between
 * each ring.
 *
 * Starts from (almost) zero radius rather than just outside the shield: the
 * badge is drawn on top of this canvas, so a disc smaller than the badge is
 * simply hidden behind it and only becomes visible once it grows past the
 * badge's edge. That reads as the pulse originating from inside the badge,
 * for free, rather than appearing to snap into existence at its border.
 */
function EchoRing({
  origin,
  tint,
  progress,
  outerR,
}: {
  origin: SkPoint;
  tint: string;
  progress: SharedValue<number>;
  outerR: number;
}) {
  const r = useDerivedValue(() => 4 + progress.value * (outerR - 4));
  // The whole colour stop array is one derived value, not a static array
  // with a reactive element mixed in — Skia's Reanimated interop expects a
  // single shared/derived value per prop, not per array entry.
  const fillColors = useDerivedValue(() => {
    // Cubic, not linear or a gentle power curve: stays close to full
    // strength through most of the travel (still vivid out near the new,
    // much larger radius) and only really collapses in the last stretch —
    // a sharp, visible dissolve at the end rather than a fade spread evenly
    // across the whole distance, which is what read as "too subtle" before.
    const peak = 0.6 * (1 - progress.value ** 3);
    // Solid out to 60% of the current radius, then falls off toward the
    // edge — the fade is spatial (near the rim), not a flat tint over the
    // whole disc.
    return [withAlpha(tint, peak), withAlpha(tint, peak), withAlpha(tint, 0)];
  });

  return (
    <Circle c={origin} r={r}>
      <RadialGradient c={origin} r={r} colors={fillColors} positions={[0, 0.6, 1]} />
      <BlurMask blur={6} style="normal" />
    </Circle>
  );
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'center' },
  centre: { alignItems: 'center', justifyContent: 'center' },
});
