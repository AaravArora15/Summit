/**
 * The primitives every Summit screen is built from, ported from the v4 kit.
 *
 * Two rules the mockup enforces and this file encodes:
 *   - Depth is hairlines. No shadows, and never a coloured glow.
 *   - The pill shape belongs to the primary CTA and to chips. Everything else
 *     is a tight rounded rectangle.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { ChevronIcon } from '@/components/icons';
import { colour, font, radius, size, space, type, withAlpha } from '@/theme/tokens';

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

type TextProps = { children: ReactNode; style?: any; numberOfLines?: number };

export const H1 = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.h1, style]}>
    {children}
  </Text>
);

export const H2 = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.h2, style]}>
    {children}
  </Text>
);

export const H3 = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.h3, style]}>
    {children}
  </Text>
);

/** The letterspaced uppercase eyebrow used above almost every block. */
export const Label = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.label, style]}>
    {children}
  </Text>
);

export const Body = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.body, style]}>
    {children}
  </Text>
);

export const Small = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.small, style]}>
    {children}
  </Text>
);

/**
 * Numerals. Tabular figures matter here: pioneer numbers, distances, and league
 * points all sit in columns or change in place, and proportional digits jitter.
 */
export const Data = ({ children, style, ...r }: TextProps) => (
  <Text {...r} style={[styles.data, style]}>
    {children}
  </Text>
);

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

type CardProps = {
  children: ReactNode;
  variant?: 'default' | 'flat' | 'tint' | 'sandy' | 'dark' | 'ink';
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, variant = 'default', style }: CardProps) {
  return <View style={[styles.card, cardVariants[variant], style]}>{children}</View>;
}

const cardVariants: Record<string, ViewStyle> = {
  default: {},
  flat: { backgroundColor: '#F2F2EF', borderColor: '#E7E7E3' },
  tint: { backgroundColor: colour.sageLight, borderColor: '#E1E7DF' },
  sandy: { backgroundColor: colour.sandLight, borderColor: '#EBE3D4' },
  dark: { backgroundColor: colour.forest, borderColor: colour.forest },
  ink: { backgroundColor: colour.n900, borderColor: colour.n900 },
};

/* -------------------------------------------------------------------------- */
/* Controls                                                                   */
/* -------------------------------------------------------------------------- */

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'sand';
  chevron?: boolean;
  full?: boolean;
  small?: boolean;
  /** Swaps the label and chevron for a spinner, in the same tint, and stops
   *  taking presses — for an action already in flight, so a second tap can't
   *  fire the same request twice. */
  loading?: boolean;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  chevron = false,
  full = false,
  small = false,
  loading = false,
}: ButtonProps) {
  const isPrimary = variant === 'primary';
  const tint =
    variant === 'primary' ? colour.n50 : variant === 'sand' ? colour.forest : colour.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: loading }}
      onPress={loading ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        // The pill is reserved for the primary CTA. Secondary actions are rects.
        { borderRadius: isPrimary && !small ? radius.pill : radius.button },
        { height: small ? size.buttonSmall : size.buttonPrimary },
        buttonVariants[variant],
        full && { width: '100%' },
        pressed && { opacity: 0.85 },
      ]}>
      {loading ? (
        <ActivityIndicator color={tint} size="small" />
      ) : (
        <>
          <Text style={[styles.buttonLabel, { color: tint, fontSize: small ? 13 : 14.5 }]}>
            {label}
          </Text>
          {chevron ? <ChevronIcon size={18} color={tint} /> : null}
        </>
      )}
    </Pressable>
  );
}

const buttonVariants: Record<string, ViewStyle> = {
  primary: { backgroundColor: colour.forest },
  ghost: { backgroundColor: colour.card, borderWidth: 1, borderColor: colour.n200 },
  sand: { backgroundColor: colour.sand },
};

type ChipProps = {
  label: string;
  tone?: 'default' | 'on' | 'ink' | 'ok' | 'warn' | 'stop';
  colour?: string;
  small?: boolean;
  /** Set on forest and ink cards, where the default white fill is too loud. */
  onDark?: boolean;
};

export function Chip({ label, tone = 'default', colour: tint, small, onDark }: ChipProps) {
  const resolved = tint ?? chipTones[tone].fg;
  return (
    <View
      style={[
        styles.chip,
        { height: small ? size.chipSmall : size.chip },
        tone === 'on'
          ? { backgroundColor: colour.forest, borderColor: colour.forest }
          : tone === 'ink'
            ? { backgroundColor: colour.n900, borderColor: colour.n900 }
            : onDark
            ? // On a forest or ink card the default white fill reads as a
              // sticker. The mockup tints the chip out of its own text colour
              // instead, so it sits in the surface rather than on top of it.
              {
                backgroundColor: withAlpha(resolved, 0.15),
                borderColor: withAlpha(resolved, 0.3),
              }
            : { borderColor: withAlpha(resolved, 0.4) },
      ]}>
      <Text
        style={[
          styles.chipLabel,
          {
            color: tone === 'on' ? colour.n50 : tone === 'ink' ? colour.sand : resolved,
            fontSize: small ? 10.5 : 11,
          },
        ]}>
        {label}
      </Text>
    </View>
  );
}

const chipTones = {
  default: { fg: colour.ink2 },
  on: { fg: colour.n50 },
  /** Reserved for a title. A solid ink pill is the scarcest treatment there is. */
  ink: { fg: colour.sand },
  ok: { fg: colour.ok },
  warn: { fg: colour.warn },
  stop: { fg: colour.stop },
} as const;

/* -------------------------------------------------------------------------- */
/* Indicators                                                                 */
/* -------------------------------------------------------------------------- */

export function ProgressBar({
  value,
  tint = colour.forest,
  track,
}: {
  value: number;
  tint?: string;
  /** Overridden only on dark surfaces, where the default grey disappears. */
  track?: string;
}) {
  return (
    <View style={[styles.progressTrack, track ? { backgroundColor: track } : null]}>
      <View
        style={[
          styles.progressFill,
          { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: tint },
        ]}
      />
    </View>
  );
}

/**
 * Difficulty is shape, never colour, so it can never be misread as rarity or as
 * a safety warning. Four peaks, filled to the grade.
 */
export function Difficulty({ level, label }: { level: 1 | 2 | 3 | 4; label?: string }) {
  return (
    <View style={styles.difficulty}>
      <View style={styles.peaks}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.peak,
              { borderBottomWidth: 6 + i * 2, opacity: i < level ? 1 : 0.2 },
            ]}
          />
        ))}
      </View>
      {label ? <Text style={styles.difficultyLabel}>{label}</Text> : null}
    </View>
  );
}


/**
 * The collection ring. A fraction, not a percentage: the mockup's note is
 * explicit that "27 of 71" implies remaining work where "38%" implies a score.
 * The number goes in `children`; this draws only the arc.
 */
export function ProgressRing({
  value,
  size: diameter = 74,
  thickness = 9,
  tint = colour.forest,
  children,
}: {
  value: number;
  size?: number;
  thickness?: number;
  tint?: string;
  children?: ReactNode;
}) {
  const r = (diameter - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(1, value)) * circumference;

  return (
    <View style={{ width: diameter, height: diameter }}>
      <Svg width={diameter} height={diameter}>
        <Circle cx={diameter / 2} cy={diameter / 2} r={r} stroke={colour.n200} strokeWidth={thickness} fill="none" />
        <Circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={r}
          stroke={tint}
          strokeWidth={thickness}
          fill="none"
          // Butt cap, not round: a rounded cap overhangs the track and reads as
          // more progress than there is.
          strokeLinecap="butt"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${diameter / 2} ${diameter / 2})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre]}>{children}</View>
    </View>
  );
}

/**
 * The five-segment tier meter on the league card. Sand behind you, forest for
 * where you stand, grey ahead: promotion is legible without reading a word.
 */
export function TierMeter({
  count,
  current,
  onDark = false,
}: {
  count: number;
  /** Zero-based index of the tier the climber is in. */
  current: number;
  onDark?: boolean;
}) {
  return (
    <View style={styles.tierMeter}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.tierSegment,
            i < current && { backgroundColor: colour.sand },
            i === current && { backgroundColor: onDark ? colour.n50 : colour.forest },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * A rule with a label through it, marking where promotion starts and relegation
 * begins. Drawn into the standings rather than described above them, so the
 * boundary sits between the two rows it actually separates.
 */
export function ZoneRule({ label, tone }: { label: string; tone: 'promotion' | 'relegation' }) {
  const tint = tone === 'promotion' ? colour.ok : colour.stop;
  return (
    <View style={styles.zone}>
      <View style={[styles.zoneLine, { backgroundColor: withAlpha(tint, 0.38) }]} />
      <Text style={[styles.zoneLabel, { color: tint }]}>{label}</Text>
      <View style={[styles.zoneLine, { backgroundColor: withAlpha(tint, 0.38) }]} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Small parts                                                                */
/* -------------------------------------------------------------------------- */

/** The set colour, as a vertical rule. It appears nowhere else in the app. */
export function Stripe({ tint, height = 30, width = 4 }: { tint: string; height?: number; width?: number }) {
  return <View style={{ width, height, borderRadius: 99, backgroundColor: tint }} />;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Avatar({
  initials,
  size: diameter = 34,
  background = colour.forest,
  tint = colour.n50,
}: {
  initials: string;
  size?: number;
  background?: string;
  tint?: string;
}) {
  return (
    <View
      style={[
        styles.centre,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: background,
        },
      ]}>
      <Text style={[styles.avatarLabel, { color: tint, fontSize: diameter * 0.38 }]}>
        {initials}
      </Text>
    </View>
  );
}

/** The 38px squircle that carries a single icon in a screen header. */
export function IconButton({
  children,
  onPress,
  label,
}: {
  children: ReactNode;
  onPress?: () => void;
  /** Required: an icon on its own says nothing to a screen reader. */
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  );
}

/**
 * Segmented control.
 *
 * The mockup lifts the selected segment with a 1px neutral shadow; here it is a
 * hairline instead, because the system's rule is that depth is a border. The
 * effect at this size is the same and it stays consistent across platforms.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  dotOn,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Draws the attention dot on this segment -- for a join request waiting on
   *  the leader, which should be visible from the League segment too. */
  dotOn?: T | null;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[styles.segment, selected && styles.segmentOn]}>
            <Text style={[styles.segmentLabel, selected && styles.segmentLabelOn]}>{option}</Text>
            {dotOn === option ? <View style={styles.segmentDot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A card that rises from the bottom over a dimmed backdrop. Built on RN's own
 * Modal rather than a custom overlay: it is the one primitive here that has
 * to sit above the navigator, not just above other views in the same tree,
 * and Modal is the one component that actually does that on both platforms.
 */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.sheetBackdrop}
        onPress={onClose}
      />
      <View style={[styles.sheetCard, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.sheetGrab} />
        {children}
      </View>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Onboarding primitives                                                      */
/* -------------------------------------------------------------------------- */

export function StepDots({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <View style={styles.stepDots}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stepDot,
            i === step ? styles.stepDotActive : styles.stepDotInactive,
          ]}
        />
      ))}
    </View>
  );
}

export function MountainHero({ height = 220 }: { height?: number }) {
  return (
    <View style={{ width: '100%', height, overflow: 'hidden' }}>
      <Svg viewBox="0 0 390 220" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <Path d="M-10 118 L66 84 120 100 198 46 268 88 336 66 400 86 V220 H-10Z" fill="#CFD9CA" />
        <Path d="M-10 146 L52 122 112 134 182 88 250 124 316 102 400 120 V220 H-10Z" fill="#9BB29D" />
        <Path d="M-10 172 L58 154 118 162 180 128 246 158 310 138 400 154 V220 H-10Z" fill="#3E6B51" />
      </Svg>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  h1: { ...type.h1, fontFamily: font.uiBold, color: colour.ink },
  h2: { ...type.h2, fontFamily: font.uiSemi, color: colour.ink },
  h3: { ...type.h3, fontFamily: font.uiSemi, color: colour.ink },
  label: { ...type.label, fontFamily: font.uiSemi, color: colour.muted },
  body: { ...type.body, fontFamily: font.ui, color: colour.muted },
  small: { ...type.xs, fontFamily: font.ui, color: colour.muted },
  data: {
    fontFamily: font.uiSemi,
    color: colour.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.1,
  },

  card: {
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.line,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: space.card,
    minWidth: 0,
  },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 22,
  },
  buttonLabel: { fontFamily: font.uiSemi, letterSpacing: -0.06 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderCurve: 'continuous',
    backgroundColor: colour.card,
    flexShrink: 1,
  },
  chipLabel: { fontFamily: font.uiMedium },

  progressTrack: {
    height: size.progressBar,
    borderRadius: 99,
    backgroundColor: colour.n200,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 99 },

  centre: { alignItems: 'center', justifyContent: 'center' },
  divider: { height: 1, backgroundColor: colour.line },

  tierMeter: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tierSegment: { flex: 1, height: 5, borderRadius: 99, backgroundColor: colour.n200 },

  zone: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 3 },
  zoneLine: { flex: 1, height: 1 },
  zoneLabel: {
    fontFamily: font.uiSemi,
    fontSize: 8.5,
    letterSpacing: 1.19,
    textTransform: 'uppercase',
  },

  avatarLabel: { fontFamily: font.uiSemi },

  iconButton: {
    width: size.control,
    height: size.control,
    borderRadius: radius.control,
    borderCurve: 'continuous',
    backgroundColor: colour.card,
    borderWidth: 1,
    borderColor: colour.n200,
    alignItems: 'center',
    justifyContent: 'center',
  },

  segmented: {
    flexDirection: 'row',
    backgroundColor: '#EFEFEC',
    borderRadius: radius.pill,
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentOn: { backgroundColor: colour.card, borderColor: colour.n200 },
  segmentLabel: { fontFamily: font.uiSemi, fontSize: 12, color: colour.muted },
  segmentLabelOn: { color: colour.ink },
  segmentDot: {
    position: 'absolute',
    top: 6,
    right: 12,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colour.warn,
  },

  difficulty: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  peaks: { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 12 },
  peak: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colour.ink,
  },
  difficultyLabel: { fontFamily: font.uiSemi, fontSize: 11, color: colour.ink },

  stepDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  stepDot: {
    height: 3.5,
    borderRadius: 2,
  },
  stepDotActive: {
    width: 24,
    backgroundColor: colour.forest,
  },
  stepDotInactive: {
    width: 14,
    backgroundColor: colour.n200,
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,26,26,0.4)' },
  sheetCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colour.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderCurve: 'continuous',
    paddingHorizontal: space.screenX,
    paddingTop: 10,
  },
  sheetGrab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colour.n200,
    marginBottom: 14,
  },
});
