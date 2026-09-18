/**
 * The map canvas.
 *
 * MapLibre is a native module, so it does not exist inside Expo Go or on web.
 * Rather than crash there, this module resolves the library lazily and renders
 * a neutral placeholder when it is absent. That keeps `expo start --go` usable
 * as a preview for every other screen while the map itself needs a dev build.
 *
 * The placeholder is deliberately plain. It should never be mistaken for the
 * real cartography in a screenshot.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Label } from '@/components/ui';
import { colour, radius } from '@/theme/tokens';
import {
  MAP_STYLE,
  RINGS_LABEL_LAYER_ID,
  RINGS_LINE_LAYER_ID,
  RINGS_SOURCE_ID,
  buildDistanceRingsGeoJSON,
  mapPalette,
} from '@/features/map/style';

// Type-only: erased at compile time, so it does not pull the native module in
// on web or in Expo Go the way the runtime `require` below would.
import type { CameraRef } from '@maplibre/maplibre-react-native';

type MapLibreModule = typeof import('@maplibre/maplibre-react-native');

let MapLibre: MapLibreModule | null = null;
try {
  // Not a static import: the native side is missing in Expo Go and on web, and
  // a top-level import would take the whole screen down with it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate, see above
  MapLibre = require('@maplibre/maplibre-react-native') as MapLibreModule;
} catch {
  MapLibre = null;
}

export const isMapAvailable = MapLibre !== null;

export type MapPin = {
  id: string;
  lng: number;
  lat: number;
  colour: string;
  label?: string;
  /** Faded almost out, for places a submitted search did not match. Still
   *  tappable: fading says "not what you asked for", not "gone". */
  dimmed?: boolean;
};

export type TrailMapProps = {
  centre: [number, number]; // [lng, lat]
  zoom?: number;
  pins?: MapPin[];
  /** Drawn larger, with a wider ring, so the pin a card or callout refers to
   *  is findable on the map without reading every label. */
  selectedPinId?: string | null;
  onPinPress?: (id: string) => void;
  /** Centre of the 2 km/5 km distance rings — the device's real position,
   *  not necessarily `centre` above (the camera can be panned/focused
   *  somewhere else while the rings stay anchored to where "2 km" is
   *  actually true from). Omit to draw no rings at all. */
  ringOrigin?: { lat: number; lng: number } | null;
  children?: React.ReactNode;
};

export function TrailMap({
  centre,
  zoom = 13,
  pins = [],
  selectedPinId = null,
  onPinPress,
  ringOrigin = null,
  children,
}: TrailMapProps) {
  // The ref, not a controlled `center`/`zoom` prop on Camera: a controlled
  // prop re-fights the user's own pan/pinch on every render, where flyTo only
  // moves the camera when this component was told to.
  const cameraRef = useRef<CameraRef>(null);
  const flewOnce = useRef(false);

  useEffect(() => {
    if (!flewOnce.current) {
      flewOnce.current = true;
      return;
    }
    cameraRef.current?.flyTo({ center: centre, zoom, duration: 900 });
  }, [centre, zoom]);

  // Recomputed only when the device actually moves enough to matter for a
  // ring's shape, not on every render/pan.
  const ringsGeoJSON = useMemo(
    () => (ringOrigin ? buildDistanceRingsGeoJSON(ringOrigin) : null),
    [ringOrigin],
  );

  if (!MapLibre) return <MapUnavailable />;

  const { Map, Camera, UserLocation, Marker, GeoJSONSource, Layer } = MapLibre;

  return (
    <Map
      style={styles.fill}
      mapStyle={MAP_STYLE}
      // v11 renamed these from logoEnabled / attributionEnabled / compassEnabled.
      // The wordmark and attribution are required by most tile providers, so
      // check your provider's terms before turning either off.
      logo
      attribution
      compass={false}>
      <Camera ref={cameraRef} initialViewState={{ center: centre, zoom }} />
      <UserLocation />
      {ringsGeoJSON ? (
        <GeoJSONSource id={RINGS_SOURCE_ID} data={ringsGeoJSON}>
          <Layer
            id={RINGS_LINE_LAYER_ID}
            type="line"
            paint={{ 'line-color': mapPalette.contour, 'line-width': 1.4, 'line-dasharray': [3, 2] }}
          />
          <Layer
            id={RINGS_LABEL_LAYER_ID}
            type="symbol"
            filter={['==', ['geometry-type'], 'Point']}
            layout={{
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 10.5,
            }}
            paint={{ 'text-color': mapPalette.label, 'text-halo-color': mapPalette.labelHalo, 'text-halo-width': 1 }}
          />
        </GeoJSONSource>
      ) : null}
      {pins.map((pin) => (
        <Marker key={pin.id} id={pin.id} lngLat={[pin.lng, pin.lat]} onPress={() => onPinPress?.(pin.id)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pin.label}
            style={[
              styles.pin,
              pin.id === selectedPinId && styles.pinSelected,
              { backgroundColor: pin.colour },
              pin.dimmed && styles.pinDimmed,
            ]}
          />
        </Marker>
      ))}
      {children}
    </Map>
  );
}

function MapUnavailable() {
  return (
    <View style={styles.placeholder}>
      <Label style={{ color: colour.dim }}>Map needs a dev build</Label>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: mapPalette.land,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
  },
  pin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  pinSelected: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colour.ink,
  },
  pinDimmed: { opacity: 0.22 },
});
