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
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Label } from '@/components/ui';
import { colour, radius } from '@/theme/tokens';
import { MAP_STYLE_URL } from '@/features/map/style';

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
};

export type TrailMapProps = {
  centre: [number, number]; // [lng, lat]
  zoom?: number;
  pins?: MapPin[];
  /** Drawn larger, with a wider ring, so the pin a card or callout refers to
   *  is findable on the map without reading every label. */
  selectedPinId?: string | null;
  onPinPress?: (id: string) => void;
  children?: React.ReactNode;
};

export function TrailMap({
  centre,
  zoom = 13,
  pins = [],
  selectedPinId = null,
  onPinPress,
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

  if (!MapLibre) return <MapUnavailable />;

  const { Map, Camera, UserLocation, Marker } = MapLibre;

  return (
    <Map
      style={styles.fill}
      mapStyle={MAP_STYLE_URL}
      // v11 renamed these from logoEnabled / attributionEnabled / compassEnabled.
      // The wordmark and attribution are required by most tile providers, so
      // check your provider's terms before turning either off.
      logo
      attribution
      compass={false}>
      <Camera ref={cameraRef} initialViewState={{ center: centre, zoom }} />
      <UserLocation />
      {pins.map((pin) => (
        <Marker key={pin.id} id={pin.id} lngLat={[pin.lng, pin.lat]} onPress={() => onPinPress?.(pin.id)}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pin.label}
            style={[styles.pin, pin.id === selectedPinId && styles.pinSelected, { backgroundColor: pin.colour }]}
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
    backgroundColor: '#E9EFE6',
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
});
