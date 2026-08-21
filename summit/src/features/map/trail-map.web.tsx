/**
 * The map canvas, web variant.
 *
 * Metro resolves this file instead of trail-map.tsx when the platform is web,
 * so the browser preview gets a real map without a dev build. Native keeps the
 * MapLibre React Native component.
 *
 * Same props, same cartography (both read MAP_STYLE_URL), different renderer:
 * this one drives maplibre-gl directly against a DOM node.
 *
 * Worth knowing when comparing the two: this is a preview convenience, not a
 * second supported target. The web build has no offline packs and no native
 * gesture handling, so treat the device as the source of truth for how the map
 * actually behaves.
 */
import 'maplibre-gl/dist/maplibre-gl.css';

// v6 has no default export; Map is a named export.
import { Map as MapLibreMap, Marker, setWorkerUrl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { MAP_STYLE_URL } from '@/features/map/style';

/**
 * Point maplibre at a worker we actually serve.
 *
 * maplibre-gl spawns its parser in a module Web Worker loaded from a separate
 * file. Left to itself under Metro it resolves to a path that does not exist
 * (node_modules/expo-router/maplibre-gl-worker.mjs); the dev server answers
 * with the SPA HTML fallback, the browser refuses it for having a text/html
 * MIME type, the worker never starts, and the map renders as an empty field
 * with no error on the map itself.
 *
 * The worker and its shared chunk are copied into public/maplibre by the
 * `sync:maplibre-worker` npm script, which also runs on postinstall so it
 * survives a fresh clone or a dependency bump.
 */
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

export const isMapAvailable = true;

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
}: TrailMapProps) {
  // react-native-web renders View as a div and forwards the ref to it, which is
  // what maplibre-gl needs as a container.
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  // The constructor already places the map at `centre`; the first run of the
  // effect below would otherwise immediately flyTo the same spot it just
  // opened on, which reads as a pointless zoom-out-in on every mount.
  const flewOnce = useRef(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    map.current = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE_URL,
      center: centre,
      zoom,
      attributionControl: { compact: true },
    });

    return () => {
      map.current?.remove();
      map.current = null;
      flewOnce.current = false;
    };
    // Created once. Position changes are applied in the effect below rather
    // than by tearing the map down and rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!flewOnce.current) {
      flewOnce.current = true;
      return;
    }
    map.current?.flyTo({ center: centre, zoom, duration: 900 });
  }, [centre, zoom]);

  /*
   * Pins, drawn through the maplibre-gl API rather than as React children.
   * They match the v4 language: a small ringed dot, no teardrop and no drop
   * shadow, because those were what made the map read as a game.
   */
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const markers = pins.map((pin) => {
      const selected = pin.id === selectedPinId;
      const el = document.createElement('div');
      el.style.cssText = [
        `width:${selected ? 22 : 16}px`,
        `height:${selected ? 22 : 16}px`,
        'border-radius:50%',
        `background:${pin.colour}`,
        selected
          ? 'box-shadow:0 0 0 2px #fff, 0 0 0 4px #1A1A1A'
          : 'box-shadow:0 0 0 2px #fff, 0 0 0 3px rgba(26,26,26,.10)',
        'cursor:pointer',
      ].join(';');
      if (pin.label) el.title = pin.label;
      if (onPinPress) el.onclick = () => onPinPress(pin.id);

      return new Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(m);
    });

    return () => markers.forEach((marker) => marker.remove());
  }, [pins, selectedPinId, onPinPress]);

  /*
   * `children` are MapLibre React Native elements (Marker, Camera, and so on)
   * and have no meaning to maplibre-gl, so they are deliberately not rendered
   * here. Pins on web will need drawing through the maplibre-gl API directly.
   */
  return <View ref={container as never} style={{ flex: 1 }} />;
}
