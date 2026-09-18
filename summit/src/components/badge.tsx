/**
 * The badge shield, restyled 2026-08-22 to match the reference brand
 * specsheet's medal system (see the repo root's badge-system screenshot): a
 * pointed hexagon shield with a lighter border ring and a full illustrated
 * scene inside — not a small line icon on a flat tint. This is a deliberate
 * reversal of the earlier "no borders, no depth, thin-stroke glyphs only"
 * call for badges specifically; the rest of the app's flat/hairline language
 * is unchanged.
 *
 * The illustration is keyed off the same category string the data already
 * carries ('ridge' | 'tree' | 'fort' | 'drop' | ...) rather than a caller-built
 * icon node, so the badge owns its whole look: a base tint, a lighter "mid"
 * tone for the scene's body, and a warm or cool accent for its highlights,
 * all derived from the one tint colour a caller passes in.
 *
 * A badge still carries three things and no more: a rarity or set colour, a
 * glyph, and the location ID printed across the foot. The ID is printed
 * straight onto the shield's base now, not on a separate band pulled up
 * over the point — the specsheet's captions sit on the medal itself.
 *
 * In CSS this is one element with a `clip-path` hexagon and an inset copy of
 * itself for the border ring. React Native has no clip-path, so it is two SVG
 * paths of the same polygon, the inner one drawn inset from the outer with
 * the scene and the label printed over it. Same construction, same result.
 */
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colour, darken, font, lighten, rarityColour } from '@/theme/tokens';

/** polygon(50% 0, 100% 13%, 100% 87%, 50% 100%, 0 87%, 0 13%) on a 100×124 box. */
const SHIELD = 'M50 0 L100 16.12 L100 107.88 L50 124 L0 107.88 L0 16.12 Z';

/**
 * Real artwork, cropped from the reference brand specsheet's four sample
 * medals (see the repo root's badge-system screenshot) rather than redrawn —
 * one per rarity, chosen for both colour and, where possible, subject match:
 * First Summit's green peak for common, Peak Collector's blue-grey range for
 * rare, Explorer's pin for epic (colour match only — its source has no
 * ridge art in a rust tone), Summit Legend's flagged peak for legendary.
 * Only 'ridge' has source art; every other category still draws its scene
 * in code, and 'ridge' itself falls back to code for a tint with no match
 * (a set colour, say) — see RIDGE_ART below.
 */
const RIDGE_ART: Record<string, ReturnType<typeof require>> = {
  [rarityColour.common]: require('../../assets/images/badges/ridge-common.png'),
  [rarityColour.rare]: require('../../assets/images/badges/ridge-rare.png'),
  [rarityColour.epic]: require('../../assets/images/badges/ridge-epic.png'),
  [rarityColour.legendary]: require('../../assets/images/badges/ridge-legendary.png'),
};

/** The shield is taller than it is wide, at the ratio the mockup uses. */
const ASPECT = 1.24;

/**
 * 'faded' is not 'locked': it draws the real scene and real colour, dimmed,
 * for a specific known place you have not been to yet (a set's missing
 * badge). 'locked'/'mystery' draw the generic triangle for a slot that has no
 * known contents at all (an empty featured slot). Reusing 'locked' for the
 * first case would say "you have not unlocked this kind of thing", when the
 * true statement is "you know exactly which place this is and have not been
 * there" - see set/[id].tsx.
 */
export type BadgeState = 'earned' | 'locked' | 'mystery' | 'faded';

/** The scenes drawn inside an earned shield. Falls back to 'ridge' if unset or unknown. */
export type GlyphKey = 'ridge' | 'tree' | 'fort' | 'drop' | 'pennant' | 'summit';

type BadgeProps = {
  /**
   * The band text: a location ID ("RAILCOR."), or a state word ("Locked").
   * Omitted where the shield is standing in for something that is not a place
   * — a crew standard, for instance — and so has no ID to print.
   */
  band?: string;
  /** Rarity or set colour. Ignored unless the badge is earned. */
  tint?: string;
  /** Which scene to draw. Ignored unless the badge is earned. */
  glyph?: GlyphKey | string;
  state?: BadgeState;
  width?: number;
  /**
   * Skip RIDGE_ART even for a 'ridge' glyph, drawing the vector Scene
   * instead. RIDGE_ART is a cropped photo fixed at ~230px native — fine at
   * every size this component has shipped at (52-64px) but visibly soft
   * once asked to render much larger, e.g. the claim-reveal's hero size.
   * The vector Scene has no such ceiling. Same category, same tint, just
   * drawn rather than cropped.
   */
  preferVector?: boolean;
};

export function Badge({
  band,
  tint = colour.forest,
  glyph,
  state = 'earned',
  width = 52,
  preferVector = false,
}: BadgeProps) {
  // Faded draws exactly what earned draws - real tint, real scene, real
  // label - and dims the whole shield afterward with one opacity, rather
  // than composing muted colours by hand for a second time.
  const drawAsEarned = state === 'earned' || state === 'faded';
  const isBlack = tint === colour.n900;
  // The specsheet's darkest badge (Summit Legend) pairs a near-black fill
  // with a single gold tone rather than a lighter-still border and scene, so
  // a black tint gets the one hand-picked exception; every other tint
  // borders and illustrates with lighter copies of itself.
  const border = drawAsEarned ? (isBlack ? colour.sand : lighten(tint, 0.3)) : '#C7C7C0';
  const fill = drawAsEarned ? tint : '#DEDED9';
  const mid = isBlack ? colour.sand : lighten(tint, 0.22);
  const accent = isBlack ? colour.sand : isCool(tint) ? colour.n50 : colour.sand;

  const height = width * ASPECT;
  const inset = Math.max(2.5, width * 0.055);
  const key = normalise(glyph);
  const art = key === 'ridge' && !preferVector ? RIDGE_ART[tint] : undefined;

  return (
    <View style={[styles.wrap, state === 'faded' && styles.faded]}>
      <View style={[{ width, height }, drawAsEarned && styles.lift]}>
        <Shape fill={border} />
        <View style={{ position: 'absolute', top: inset, left: inset, right: inset, bottom: inset }}>
          <Svg width="100%" height="100%" viewBox="0 0 100 124" preserveAspectRatio="none">
            <Path d={SHIELD} fill={fill} />
            {drawAsEarned && !art ? <Scene glyph={key} mid={mid} accent={accent} /> : null}
          </Svg>
          {drawAsEarned && art ? (
            <View style={styles.artZone} pointerEvents="none">
              <Image source={art} style={styles.artImage} resizeMode="contain" />
            </View>
          ) : null}
          {!drawAsEarned ? (
            <View style={[StyleSheet.absoluteFill, styles.lockZone]}>
              <Text style={[styles.lockGlyph, { fontSize: width * 0.3 }]}>▲</Text>
            </View>
          ) : null}
          {band ? (
            <View style={styles.labelZone} pointerEvents="none">
              <Text
                numberOfLines={1}
                style={[styles.label, !drawAsEarned && styles.labelLocked]}>
                {band}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function normalise(glyph?: string): GlyphKey {
  if (glyph === 'tree' || glyph === 'fort' || glyph === 'drop' || glyph === 'pennant' || glyph === 'summit') {
    return glyph;
  }
  return 'ridge';
}

/** True for blue/teal tints, which read best against a white highlight rather than the warm gold every other tint uses. */
function isCool(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return b >= r && b >= g;
}

function Scene({ glyph, mid, accent }: { glyph: GlyphKey; mid: string; accent: string }) {
  switch (glyph) {
    case 'tree':
      return (
        <>
          <Path d="M12 80 L24 50 L36 80 Z" fill={mid} />
          <Path d="M64 80 L76 50 L88 80 Z" fill={mid} />
          <Path d="M32 80 L50 30 L68 80 Z" fill={mid} />
          <Path d="M44 42 L50 30 L56 42 Z" fill={accent} />
        </>
      );
    case 'fort':
      return (
        <>
          <Path d="M38 80 L38 42 L62 42 L62 80 Z" fill={mid} />
          <Path d="M34 42 L50 24 L66 42 Z" fill={mid} />
          <Path d="M60.5 32 L63.5 32 L63.5 12 L60.5 12 Z" fill={accent} />
          <Path d="M63.5 12 L80 18 L63.5 24 Z" fill={accent} />
        </>
      );
    case 'drop':
      return (
        <>
          <Circle cx="30" cy="32" r="10" fill={accent} />
          <Path d="M4 58 C20 46 34 46 50 58 C66 70 80 70 96 58 L96 72 L4 72 Z" fill={mid} />
          <Path d="M4 74 C20 64 34 64 50 74 C66 84 80 84 96 74 L96 88 L4 88 Z" fill={darken(mid, 0.12)} />
        </>
      );
    case 'pennant':
      return (
        <>
          <Path d="M48.5 20 L51.5 20 L51.5 82 L48.5 82 Z" fill={mid} />
          <Path d="M51.5 26 L83 37 L51.5 48 Z" fill={accent} />
        </>
      );
    case 'summit':
      return (
        <>
          <Path d="M48 80 L68 34 L92 80 Z" fill={mid} />
          <Path d="M8 80 L38 24 L66 80 Z" fill={mid} />
          <Path d="M31 40 L38 24 L45 40 Z" fill={accent} />
          <Path d="M38 24 L38 10 L52 15 L38 20 Z" fill={accent} />
        </>
      );
    case 'ridge':
    default:
      return (
        <>
          <Path d="M48 80 L68 34 L92 80 Z" fill={darken(mid, 0.1)} />
          <Path d="M8 80 L38 24 L66 80 Z" fill={mid} />
          <Path d="M31 40 L38 24 L45 40 Z" fill={accent} />
        </>
      );
  }
}

function Shape({ fill }: { fill: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 124" preserveAspectRatio="none">
      <Path d={SHIELD} fill={fill} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', minWidth: 0, maxWidth: '100%' },
  // A place you know and have not been to, not a mystery. Dimmed, not greyed.
  faded: { opacity: 0.4 },
  // Medal weight, earned/faded badges only: locked slots stay flat on the page.
  lift: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    elevation: 3,
  },

  lockZone: { top: '4%', bottom: '30%', alignItems: 'center', justifyContent: 'center' },
  lockGlyph: { color: '#C3C3BC', opacity: 0.34, lineHeight: undefined },

  // Matches the vertical extent the code-drawn Scene occupies, so real
  // cropped art and hand-drawn scenes sit at the same height across badges.
  artZone: { position: 'absolute', top: '6%', left: '4%', right: '4%', bottom: '28%' },
  artImage: { width: '100%', height: '100%' },

  // Printed straight onto the shield's base, above the taper to the point.
  labelZone: {
    position: 'absolute',
    left: '6%',
    right: '6%',
    top: '72%',
    bottom: '4%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: font.uiSemi,
    fontSize: 8,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    textAlign: 'center',
    color: colour.n50,
  },
  labelLocked: { color: colour.dim },
});
