/**
 * Map cartography.
 *
 * This used to be a custom style built layer-by-layer against OpenFreeMap's
 * `openmaptiles` vector source, chasing the mockup's muted-green topographic
 * look. Several rounds in (soft topo, then dark/neon, then decorative
 * contour rings), none of it read as "fun" — so this now just points at
 * OpenFreeMap's own hosted "Liberty" style: a real, colorful, friendly
 * default basemap, live at `https://tiles.openfreemap.org/styles/liberty`
 * (confirmed reachable directly), keyless, and zero custom cartography left
 * to maintain. `EXPO_PUBLIC_MAP_STYLE_URL` still overrides this with a
 * different hosted style if one is ever set.
 *
 * The 2 km/5 km distance rings below are the one thing still drawn on top,
 * regardless of base style — real distance from the device, not decoration
 * — so `mapPalette` only keeps the few tokens that overlay needs.
 *
 * Offline packs are the other half of the reason for MapLibre. Trails have
 * no signal, so before shipping, use OfflineManager to download a bounded
 * region around the city rather than relying on the tile cache.
 */
import { ringPolygon } from '@/features/trek/distance';
import { colour } from '@/theme/tokens';

const OPENFREEMAP_LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Just the rings overlay's own tokens now — the base map is Liberty's own
 *  palette, not Summit's. `land` is Liberty's actual background colour
 *  (`#f8f4f0`), used only for the loading placeholder so it doesn't flash a
 *  mismatched colour before the real style loads in. */
export const mapPalette = {
  land: '#f8f4f0',
  contour: 'rgba(31,61,46,0.14)',
  label: colour.ink2,
  labelHalo: '#F7F7F5',
} as const;

/** OpenFreeMap's Liberty style by default. EXPO_PUBLIC_MAP_STYLE_URL can
 *  still point this at a different hosted style instead. */
export const MAP_STYLE: string = process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? OPENFREEMAP_LIBERTY_STYLE;

/**
 * Distance rings drawn over the map. The mockup renders 2 km and 5 km so that
 * "how far" is something you read at a glance rather than compute from a
 * list.
 */
export const DISTANCE_RINGS_M = [2000, 5000] as const;

export const RINGS_SOURCE_ID = 'summit-distance-rings';
export const RINGS_LINE_LAYER_ID = 'summit-distance-rings-line';
export const RINGS_LABEL_LAYER_ID = 'summit-distance-rings-label';

/**
 * The rings, as a GeoJSON FeatureCollection centred on `origin`: one
 * LineString ring per DISTANCE_RINGS_M, plus one label Point per ring
 * (placed due north, matching the mockup's "2 KM"/"5 KM" caps) — trail-map.tsx
 * and trail-map.web.tsx both draw this same shape, just through different
 * MapLibre APIs (declarative on native, imperative on web).
 */
export function buildDistanceRingsGeoJSON(origin: { lat: number; lng: number }): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: DISTANCE_RINGS_M.flatMap((radiusM) => {
      const ring = ringPolygon(origin, radiusM);
      const label = radiusM >= 1000 ? `${radiusM / 1000} km` : `${radiusM} m`;
      return [
        {
          type: 'Feature',
          properties: { label },
          geometry: { type: 'LineString', coordinates: ring },
        },
        {
          type: 'Feature',
          properties: { label },
          // Due north of centre — the same point ring[0] is, since
          // ringPolygon starts its bearing sweep at 0.
          geometry: { type: 'Point', coordinates: ring[0] },
        },
      ];
    }),
  };
}
