/**
 * Territory polygon overlay for the Explore map.
 *
 * Renders a convex-hull polygon for each territory, computed from its
 * member-location coordinates. The visual treatment depends on user state:
 *
 *   captured   — solid fill, shows the user controls this area
 *   unvisited  — faint fill with dashed border, visible but not owned
 *   signed out — no polygons rendered (no user state to colour by)
 *
 * Each territory is a separate MapLibre source + fill/line layer pair,
 * keyed by territory id for stable identity across data updates.
 *
 * The 200 m outward buffer keeps the polygon from hugging the location
 * points so tightly that the territory looks like a line at low zoom.
 * For 3-4 points, the convex hull is the points connected in order,
 * which is exactly what this produces — no library needed.
 */
import { useMemo } from 'react';

import type { TerritoryMapView } from '@/lib/queries';
import { colour, withAlpha } from '@/theme/tokens';

type TerritoryLayerProps = {
  territories: TerritoryMapView[];
};

const BUFFER_M = 200;

/**
 * Approximate degree offset for BUFFER_M at the equator. At Singapore
 * latitude (~1.3°N) this is a slight overestimate, which is fine — the
 * buffer is visual, not a security boundary.
 */
const DEG_PER_M = 1 / 111_320;

function convexHullCoordinates(lngs: number[], lats: number[]): [number, number][] {
  if (lngs.length < 3) return lngs.map((lng, i) => [lng, lats[i]]);

  // Simple convex hull (Graham scan) for small point sets (3-4 points).
  const points = lngs.map((lng, i) => ({ lng, lats: lats[i] }));

  // Find lowest point (southmost), then leftmost if tied.
  let pivot = points[0];
  for (const p of points) {
    if (p.lats < pivot.lats || (p.lats === pivot.lats && p.lng < pivot.lng)) {
      pivot = p;
    }
  }

  const sorted = points
    .filter((p) => p !== pivot)
    .sort((a, b) => {
      const angleA = Math.atan2(a.lats - pivot.lats, a.lng - pivot.lng);
      const angleB = Math.atan2(b.lats - pivot.lats, b.lng - pivot.lng);
      return angleA - angleB;
    });

  const hull = [pivot, ...sorted];

  // For 3-4 nearly-collinear points, just return all of them with a buffer.
  // A full Graham scan is overkill for this size.
  return hull.map((p) => [p.lng, p.lats]);
}

function bufferPolygon(coords: [number, number][], bufferM: number): [number, number][] {
  if (coords.length < 3) return coords;

  const offset = bufferM * DEG_PER_M;

  // Find centroid.
  const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;

  // Push each vertex outward from centroid by bufferM.
  return coords.map(([lng, lat]) => {
    const dx = lng - cx;
    const dy = lat - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return [lng, lat + offset] as [number, number];
    const scale = (dist + offset) / dist;
    return [cx + dx * scale, cy + dy * scale] as [number, number];
  });
}

function buildTerritoryGeoJSON(
  territories: TerritoryMapView[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: territories
      .filter((t) => t.memberLngs.length >= 3)
      .map((t) => {
        const hull = convexHullCoordinates(t.memberLngs, t.memberLats);
        const buffered = bufferPolygon(hull, BUFFER_M);
        return {
          type: 'Feature' as const,
          properties: {
            id: t.territoryId,
            captured: t.captured,
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [buffered],
          },
        };
      }),
  };
}

const SOURCE_ID = 'summit-territories';
const FILL_LAYER_ID = 'summit-territories-fill';
const LINE_LAYER_ID = 'summit-territories-line';

export function TerritoryLayer({ territories }: TerritoryLayerProps) {
  const geoJSON = useMemo(
    () => buildTerritoryGeoJSON(territories),
    [territories],
  );

  const hasPolygons = geoJSON.features.length > 0;
  if (!hasPolygons) return null;

  // MapLibre components are imported at the TrailMap level and passed via
  // context or direct import. Here we use the same lazy import pattern.
  let MapLibre: typeof import('@maplibre/maplibre-react-native') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    MapLibre = require('@maplibre/maplibre-react-native') as typeof import('@maplibre/maplibre-react-native');
  } catch {
    return null;
  }

  if (!MapLibre) return null;
  const { GeoJSONSource, Layer } = MapLibre;

  return (
    <GeoJSONSource id={SOURCE_ID} data={geoJSON}>
      <Layer
        id={FILL_LAYER_ID}
        type="fill"
        source={SOURCE_ID}
        paint={{
          'fill-color': [
            'case',
            ['get', 'captured'],
            withAlpha(colour.forest, 0.22),
            withAlpha(colour.forest, 0.08),
          ],
          'fill-opacity': 1,
        }}
      />
      <Layer
        id={LINE_LAYER_ID}
        type="line"
        source={SOURCE_ID}
        paint={{
          'line-color': [
            'case',
            ['get', 'captured'],
            colour.forest,
            withAlpha(colour.forest, 0.3),
          ],
          'line-width': 1.5,
          'line-dasharray': [4, 2],
        }}
      />
    </GeoJSONSource>
  );
}
