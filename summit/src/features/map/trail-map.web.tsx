/**
 * The map canvas, web variant.
 *
 * Metro resolves this file instead of trail-map.tsx when the platform is web,
 * so the browser preview gets a real map without a dev build. Native keeps the
 * MapLibre React Native component.
 *
 * Same props, same cartography (both read MAP_STYLE), different renderer:
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

import {
  MAP_STYLE,
  RINGS_LABEL_LAYER_ID,
  RINGS_LINE_LAYER_ID,
  RINGS_SOURCE_ID,
  buildDistanceRingsGeoJSON,
  mapPalette,
} from '@/features/map/style';

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
  /** Faded almost out, for places a submitted search did not match. Still
   *  clickable: fading says "not what you asked for", not "gone". */
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
  /** Centre of the 2 km/5 km distance rings — see the same prop's doc on the
   *  native TrailMap for why this is separate from `centre`. */
  ringOrigin?: { lat: number; lng: number } | null;
  children?: React.ReactNode;
};

function styleMarker(el: HTMLDivElement, pin: MapPin, selected: boolean) {
  el.style.cssText = [
    `width:${selected ? 22 : 16}px`,
    `height:${selected ? 22 : 16}px`,
    'border-radius:50%',
    `background:${pin.colour}`,
    selected
      ? 'box-shadow:0 0 0 2px #fff, 0 0 0 4px #1A1A1A'
      : 'box-shadow:0 0 0 2px #fff, 0 0 0 3px rgba(26,26,26,.10)',
    `opacity:${pin.dimmed ? 0.22 : 1}`,
    'cursor:pointer',
  ].join(';');
  el.title = pin.label ?? '';
}

export function TrailMap({
  centre,
  zoom = 13,
  pins = [],
  selectedPinId = null,
  onPinPress,
  ringOrigin = null,
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
    const registry = markers.current;

    map.current = new MapLibreMap({
      container: container.current,
      style: MAP_STYLE,
      center: centre,
      zoom,
      attributionControl: { compact: true },
    });

    return () => {
      // map.remove() takes its markers down with it; the registry just has
      // to forget them so a remount starts clean.
      registry.clear();
      map.current?.remove();
      map.current = null;
      flewOnce.current = false;
    };
    // Created once. Position changes are applied in the effect below rather
    // than by tearing the map down and rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The 2 km/5 km distance rings. maplibre-gl needs its style fully loaded
   * before addSource/addLayer will take — the constructor above returns long
   * before that finishes — so this only actually runs once `isStyleLoaded()`
   * says yes (immediately if it's already true, otherwise deferred to the
   * map's own 'load' event). Re-fires on every ringOrigin change and just
   * calls setData in place, the source already existing by then.
   */
  useEffect(() => {
    const m = map.current;
    if (!m || !ringOrigin) return;

    const apply = () => {
      const data = buildDistanceRingsGeoJSON(ringOrigin);
      const existing = m.getSource(RINGS_SOURCE_ID) as
        | { setData: (data: GeoJSON.FeatureCollection) => void }
        | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }
      m.addSource(RINGS_SOURCE_ID, { type: 'geojson', data });
      m.addLayer({
        id: RINGS_LINE_LAYER_ID,
        type: 'line',
        source: RINGS_SOURCE_ID,
        paint: { 'line-color': mapPalette.contour, 'line-width': 1.4, 'line-dasharray': [3, 2] },
      });
      m.addLayer({
        id: RINGS_LABEL_LAYER_ID,
        type: 'symbol',
        source: RINGS_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 10.5 },
        paint: {
          'text-color': mapPalette.label,
          'text-halo-color': mapPalette.labelHalo,
          'text-halo-width': 1,
        },
      });
    };

    if (m.isStyleLoaded()) apply();
    else m.once('load', apply);
  }, [ringOrigin]);

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
   *
   * Each marker is a DOM element, and there are ~640 of them, so they are
   * kept in a registry by id and restyled in place. A selection change, a
   * search fade or a filter recolour is 640 style writes, not 640 elements
   * destroyed and rebuilt — which is what the previous version did on every
   * render of the parent, keystrokes included, and was the single largest
   * cost on this screen. The press handler is read through a ref for the
   * same reason: a fresh closure from the parent is not a reason to touch a
   * marker at all.
   */
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLDivElement }>());
  const pressRef = useRef(onPinPress);
  useEffect(() => {
    pressRef.current = onPinPress;
  }, [onPinPress]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const live = markers.current;
    const seen = new Set<string>();

    for (const pin of pins) {
      seen.add(pin.id);
      let entry = live.get(pin.id);
      if (!entry) {
        const el = document.createElement('div');
        const { id } = pin;
        el.onclick = () => pressRef.current?.(id);
        entry = { el, marker: new Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(m) };
        live.set(id, entry);
      } else {
        entry.marker.setLngLat([pin.lng, pin.lat]);
      }
      styleMarker(entry.el, pin, pin.id === selectedPinId);
    }

    for (const [id, entry] of live) {
      if (!seen.has(id)) {
        entry.marker.remove();
        live.delete(id);
      }
    }
  }, [pins, selectedPinId]);

  /*
   * `children` are MapLibre React Native elements (Marker, Camera, and so on)
   * and have no meaning to maplibre-gl, so they are deliberately not rendered
   * here. Pins on web will need drawing through the maplibre-gl API directly.
   */
  return <View ref={container as never} style={{ flex: 1 }} />;
}
