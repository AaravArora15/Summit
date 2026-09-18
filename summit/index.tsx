/**
 * Native entry point. `expo-router/entry` (the default `main`) does exactly
 * this — see expo-router/entry-classic.js — it's taken over here only
 * because the web build (index.web.tsx) needs to gate rendering behind
 * react-native-skia's WASM load first, and once `main` points at a custom
 * file, Metro's platform resolution needs both a native and a web version of
 * it to keep working.
 */
import '@expo/metro-runtime'; // must be the first import — Fast Refresh depends on it

import { App } from 'expo-router/build/qualified-entry';
import { renderRootComponent } from 'expo-router/build/renderRootComponent';

renderRootComponent(App);
