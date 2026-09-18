/**
 * Web entry point. react-native-skia has no native binding on web — it runs
 * on CanvasKit compiled to WASM instead, loaded asynchronously via
 * LoadSkiaWeb(). Any Skia component (the claim-reveal's ambient effects,
 * see badge-reveal.tsx) rendered before that WASM finishes loading crashes
 * with "Cannot read properties of undefined (reading 'PictureRecorder')" —
 * so the whole app's render is gated behind it here, once, at boot, rather
 * than every call site guarding for it individually.
 */
import '@expo/metro-runtime';
import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb().then(() => {
  renderRootComponent(App);
});
