/**
 * The badge shield, ported from the v4 kit.
 *
 * A badge carries three things and no more: a rarity or set colour, a glyph,
 * and the location ID printed on a band across the foot. The ID band is the
 * reason a badge feels owned rather than awarded — it names the place, in the
 * same typographic register as a pioneer number.
 *
 * In CSS this is one element with a `clip-path` hexagon and a 2px inset copy of
 * itself. React Native has no clip-path, so it is two SVG paths of the same
 * polygon, the inner one drawn 2px inside the outer with the glyph centred over
 * it. Same construction, same result.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colour, darken, font } from '@/theme/tokens';

/** polygon(50% 0, 100% 13%, 100% 87%, 50% 100%, 0 87%, 0 13%) on a 100×124 box. */
const SHIELD = 'M50 0 L100 16.12 L100 107.88 L50 124 L0 107.88 L0 16.12 Z';

/** The shield is taller than it is wide, at the ratio the mockup uses. */
const ASPECT = 1.24;

/**
 * 'faded' is not 'locked': it draws the real glyph and real colour, dimmed,
 * for a specific known place you have not been to yet (a set's missing
 * badge). 'locked'/'mystery' draw the generic triangle for a slot that has no
 * known contents at all (an empty featured slot). Reusing 'locked' for the
 * first case would say "you have not unlocked this kind of thing", when the
 * true statement is "you know exactly which place this is and have not been
 * there" - see set/[id].tsx.
 */
export type BadgeState = 'earned' | 'locked' | 'mystery' | 'faded';

type BadgeProps = {
  /**
   * The band text: a location ID ("RAILCOR."), or a state word ("Locked").
   * Omitted where the shield is standing in for something that is not a place
   * — a crew standard, for instance — and so has no ID to print.
   */
  band?: string;
  /** Rarity or set colour. Ignored unless the badge is earned. */
  tint?: string;
  /** The glyph, already sized and coloured by the caller. */
  glyph?: ReactNode;
  state?: BadgeState;
  width?: number;
};

export function Badge({ band, tint = colour.forest, glyph, state = 'earned', width = 52 }: BadgeProps) {
  // Faded draws exactly what earned draws - real tint, real glyph, real band
  // colour - and dims the whole shield afterward with one opacity, rather
  // than composing muted colours by hand for a second time.
  const drawAsEarned = state === 'earned' || state === 'faded';
  const outer = drawAsEarned ? tint : '#DEDED9';
  // The inner face is the same colour a shade down, which is what gives the
  // shield its rim without adding a second colour to the palette.
  const inner = drawAsEarned ? darken(tint, 0.07) : '#EAEAE5';

  const height = width * ASPECT;

  return (
    <View style={[styles.wrap, state === 'faded' && styles.faded]}>
      <View style={{ width, height }}>
        <Shape fill={outer} />
        <View style={styles.inset}>
          <Shape fill={inner} />
          <View style={[StyleSheet.absoluteFill, styles.centre]}>
            {drawAsEarned ? glyph : <Text style={[styles.lockGlyph, { fontSize: width * 0.3 }]}>▲</Text>}
          </View>
        </View>
      </View>

      {band ? (
        <View
          style={[
            styles.band,
            { maxWidth: width + 14 },
            drawAsEarned ? { backgroundColor: tint } : styles.bandLocked,
          ]}>
          <Text
            numberOfLines={1}
            style={[styles.bandLabel, !drawAsEarned && styles.bandLabelLocked]}>
            {band}
          </Text>
        </View>
      ) : null}
    </View>
  );
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
  inset: { position: 'absolute', top: 2, left: 2, right: 2, bottom: 2 },
  centre: { alignItems: 'center', justifyContent: 'center' },

  lockGlyph: { color: '#C3C3BC', opacity: 0.34, lineHeight: undefined },

  // Pulled up over the point of the shield, so the band reads as fixed to it
  // rather than floating below it.
  band: {
    marginTop: -8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  bandLocked: { backgroundColor: '#DEDED9' },
  bandLabel: {
    fontFamily: font.uiSemi,
    fontSize: 7.5,
    letterSpacing: 0.75,
    textTransform: 'uppercase',
    color: colour.n50,
  },
  bandLabelLocked: { color: colour.dim },
});
