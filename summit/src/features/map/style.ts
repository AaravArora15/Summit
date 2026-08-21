/**
 * Map cartography.
 *
 * The explore screen in the v4 mockup is a muted green topographic map, not
 * stock street cartography. That look is the reason MapLibre was chosen over
 * react-native-maps: the style is a JSON document we control, so the map can be
 * made to match the rest of the product rather than sitting inside it as a
 * foreign rectangle.
 *
 * Getting there is two steps:
 *
 *   1. Now: OpenFreeMap's Liberty style, so the map renders real streets and
 *      paths without an API key. It is standard cartography, not Summit's, so
 *      it does not match the mockup.
 *
 *   2. Next: a real vector source (MapTiler's free tier, Protomaps, or
 *      self-hosted) with a style built from the tokens below. Set
 *      EXPO_PUBLIC_MAP_STYLE_URL and this module picks it up.
 *
 * Offline packs are the other half of the reason for MapLibre. Trails have no
 * signal, so before shipping, use OfflineManager to download a bounded region
 * around the city rather than relying on the tile cache.
 */
import { colour } from '@/theme/tokens';

/**
 * OpenFreeMap's Liberty style: keyless, OpenMapTiles schema, real data down to
 * street and trail zoom. Chosen over MapLibre's demotiles because those carry
 * no data past low zoom, so the map renders as an empty blue field exactly
 * where this product needs detail.
 *
 * It is a free community service with no SLA. Fine for building and demoing,
 * not something to depend on in production.
 */
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? DEFAULT_STYLE;

/** True when running on borrowed cartography rather than Summit's own style. */
export const usingDemoCartography = MAP_STYLE_URL === DEFAULT_STYLE;

/**
 * The palette the real style should be built against, kept here so the map and
 * the app cannot drift apart. These are the same values the mockup's map uses.
 */
export const mapPalette = {
  land: '#E9EFE6',
  water: '#CBDCE2',
  green: '#DCE7D6',
  road: '#FFFFFF',
  roadCasing: '#E2E6DE',
  contour: 'rgba(31,61,46,0.14)',
  label: colour.ink2,
  labelHalo: '#F7F7F5',
} as const;

/**
 * Distance rings drawn over the map. The mockup renders 2 km and 5 km so that
 * "how far" is something you read at a glance rather than compute from a list.
 */
export const DISTANCE_RINGS_M = [2000, 5000] as const;
