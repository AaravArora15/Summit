/**
 * Summit design tokens, ported from design-mockup-v4.html.
 *
 * The mockup is the source of truth. Values here are transcribed from its CSS
 * custom properties, not re-derived, so a change there should be mirrored here
 * rather than reinvented.
 *
 * The product is light-native by design. There is no dark palette: the brand
 * colours are fixed, and the mockup's dark surfaces (`card.dark`, `card.ink`)
 * are deliberate emphasis, not a theme.
 */

export const colour = {
  // Brand
  forest: '#1F3D2E',
  forestDark: '#162C21',
  forestLight: '#2C5540',
  sage: '#6F8F75',
  sageLight: '#EDF1EB',
  sand: '#DCC6A1',
  sandLight: '#F6F1E7',
  rust: '#A65A3A',
  slate: '#7A8D99',

  // Neutrals
  n900: '#1A1A1A',
  n700: '#333333',
  n500: '#6B6B6B',
  n200: '#E5E5E5',
  n50: '#F7F7F5',

  // Surfaces
  bg: '#F7F7F5',
  card: '#FFFFFF',
  line: '#E8E8E4',
  line2: '#E5E5E5',

  // Ink
  ink: '#1A1A1A',
  ink2: '#333333',
  muted: '#6B6B6B',
  dim: '#9A9A94',

  // Status. Never reused for rarity or difficulty: safety keeps its own scale
  // so it can never be misread as a game signal.
  ok: '#2E7D4F',
  warn: '#C08327',
  stop: '#B23A2B',
} as const;

/** Rarity is colour. Difficulty is shape. The two never share a scale. */
export const rarityColour = {
  common: '#6F8F75',
  rare: '#7A8D99',
  epic: '#A65A3A',
  legendary: '#1A1A1A',
  mystery: '#B4B4AE',
} as const;

export type Rarity = keyof typeof rarityColour;

/** Set colours appear only on set surfaces (deed caps, stripes), never on pins. */
export const setColour = {
  rainforest: '#35604A',
  reservoir: '#46707F',
  coastal: '#C7A15A',
  heritage: '#4A4740',
  urban: '#6E7B88',
  islands: '#7A9E4F',
} as const;

export type SetKey = keyof typeof setColour;

/**
 * Type scale. Inter for everything; Outfit is reserved for the wordmark alone.
 * `letterSpacing` is absolute points in React Native, so the mockup's em values
 * are multiplied out against each size.
 */
export const type = {
  h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.47, lineHeight: 30 },
  h2: { fontSize: 19, fontWeight: '600', letterSpacing: -0.27, lineHeight: 23 },
  h3: { fontSize: 15, fontWeight: '600', letterSpacing: -0.09, lineHeight: 20 },
  label: {
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.95,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  body: { fontSize: 13.5, fontWeight: '400', lineHeight: 21 },
  xs: { fontSize: 12, fontWeight: '400', lineHeight: 18 },
  base: { fontSize: 13.5, fontWeight: '400', lineHeight: 20 },
} as const;

export const font = {
  ui: 'Inter',
  uiMedium: 'Inter-Medium',
  uiSemi: 'Inter-SemiBold',
  uiBold: 'Inter-Bold',
  wordmark: 'Outfit-Bold',
} as const;

/**
 * Radii. Hybrid language: the pill is reserved for the primary CTA, everything
 * else is a tight rounded rectangle. Adding a second pill-shaped control is the
 * fastest way to make this look like a toy again.
 */
export const radius = {
  card: 11,
  deed: 10,
  sheet: 16,
  photo: 10,
  row: 10,
  control: 11, // icon buttons, map controls
  button: 12, // secondary buttons
  pill: 999, // primary CTA and chips only
} as const;

export const space = {
  screenX: 22, // the horizontal gutter every screen shares
  card: 15,
  gap: { xs: 4, sm: 6, md: 10, lg: 14, xl: 20 },
} as const;

export const size = {
  buttonPrimary: 48,
  buttonSmall: 40,
  chip: 25,
  chipSmall: 22,
  control: 38,
  tabBar: 76,
  tabIcon: 21,
  progressBar: 5,
  pioneerMeter: 7,
  progressDot: 8,
} as const;

/**
 * Stroke width for all line icons. One value, deliberately: mixed stroke
 * weights were a large part of what made v3 read as cartoonish.
 */
export const strokeWidth = 1.5;

/**
 * Depth is hairlines, not shadows. There are no coloured glows anywhere in the
 * system. If something needs to lift off the page, give it a border.
 */
export const border = {
  hairline: { borderWidth: 1, borderColor: colour.line },
  hairlineStrong: { borderWidth: 1, borderColor: colour.n200 },
} as const;

/* -------------------------------------------------------------------------- */
/* Colour helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * React Native has no `color-mix()` and no `rgb()/alpha` syntax on a hex, so
 * the two mixes the mockup relies on are computed here instead.
 *
 * Both take the palette hexes above; neither is meant for arbitrary user
 * colour. Keeping them next to the palette is deliberate: a tint that is not
 * derivable from these two functions is a new colour, and new colours belong in
 * the mockup first.
 */
function channels(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

export function withAlpha(hex: string, alpha: number) {
  const [r, g, b] = channels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mix toward black. `darken(c, 0.07)` is the mockup's `color-mix(srgb, c 93%, #000)`. */
export function darken(hex: string, amount: number) {
  const [r, g, b] = channels(hex);
  const k = 1 - Math.max(0, Math.min(1, amount));
  const hx = (v: number) => Math.round(v * k).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}
