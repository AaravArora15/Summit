# Production-grade Android build for Summit

## Context

Summit (Expo SDK 57, RN 0.86, expo-router, new architecture, React Compiler on) has only ever run from `expo start`. On 2026-08-22 Aarav asked why it felt slow; the Explore tab turned out to be doing ~640× more rendering work than needed (fixed the same day: virtualised list, diffed web markers, hand-memoised handlers). The follow-up is **how to ship a production-grade Android build**: small, fast to cold-start, smooth on device, not draining the battery during a trek, and correctly configured for release.

Decisions from Aarav: **Google Play (AAB)** is the target (a sideload APK profile is added only for measurement), **web preview stays**, **persist react-query on device** (instant cold start, brief offline use on a trail), **map provider is TBC** (likely a topographic/contour style later) so the style URL stays a single env-driven swap point.

Two read-only surveys and two design passes (build/config and runtime) produced the facts and fixes below. Everything is grounded in the repo and `node_modules` as of today; nothing is speculative. All paths are under `summit/` unless noted.

### What was found

**Build / binary**
- No `expo-build-properties`: no R8 minification, no resource shrinking.
- `eas.json` production profile is `{ autoIncrement: true }` only: no Android block, no environment. `.env` is gitignored, so **EAS builds have no Supabase credentials** and the app would silently fall back to demo data (`src/lib/supabase.ts:47`).
- 9 dependencies with zero imports in `src/`; `@expo/ui` (Jetpack Compose/Material3) and `expo-image` (Glide, AVIF, SVG) are the largest native payloads.
- Fonts: four unsubsetted Inter TTFs (~325 KB each) + `Outfit-Bold` (48 KB, **0 consumers**), all loaded asynchronously before first render (`_layout.tsx` returns `null` until `fontsLoaded`).
- `RECORD_AUDIO` permission is declared and is also re-added by `expo-image-picker`'s plugin unless `microphonePermission: false`. `allowBackup` defaults to `true` via config-plugins.
- `postinstall` runs a web-only shell copy on every install, Android EAS workers included.
- Badge PNGs (228 KB) are Metro assets, so AGP's PNG crunch never touches them.

**Runtime**
- `useSession()` is per-component: every `useLive` hook opens its own `getSession()` + `onAuthStateChange` subscription (3–5 per tab screen, all alive under the tab navigator).
- `useLive` (`src/lib/queries.ts:88-110`) re-maps full row sets and returns a new object on every render; every caller rebuilds its demo fallback per render too. No `useMemo` in the file.
- No react-query persistence; no `invalidateQueries` anywhere (a claim never refreshes Home/Collect/Profile until restart).
- Explore fetches all ~645 locations (272 KB, deliberate) **twice** per mount because the query key contains the device centre.
- Native map: one `<Marker>` native view + `<Pressable>` per location (~645), closure per pin per render, `TrailMap` not memoised. `@maplibre/maplibre-react-native` 11.3.6 exposes `GeoJSONSource` + `Layer type="circle"` (not `ShapeSource`/`CircleLayer`).
- `badges.tsx` mounts every badge (SVG + PNG) in a `ScrollView`; `set/[id].tsx` likewise for a whole set.
- `Skeleton` runs an infinite reanimated loop per instance (up to ~20 concurrent); tab bar wraps in `expo-blur` on Android (real-time blur under every screen incl. the map).
- Trek recorder: `Accuracy.High`, 5 s / 10 m, no deferred batching; `trek/live.tsx` re-reads **all** points from SQLite and recomputes distance O(n) **every second** for the whole walk.

---

## Phase A: build configuration (all Must, cheapest wins, do first)

### A1. Dependencies
- `npm uninstall @expo/ui expo-glass-effect expo-symbols expo-image expo-haptics expo-web-browser expo-secure-store date-fns zod`
- Keep `expo-system-ui` (enforces light-only UI), `expo-linking`/`expo-constants` (router deps), `react-native-worklets` (reanimated peer), and the web trio `maplibre-gl`/`react-dom`/`react-native-web`.
- Replace the shell `postinstall` with `node scripts/sync-maplibre-worker.mjs`: resolve `maplibre-gl/dist/maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` via `createRequire`; on failure log and `exit(0)`; else `mkdirSync('public/maplibre', {recursive:true})` + `copyFileSync`. `trail-map.web.tsx` still calls `setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')`, so the copy must keep happening for web.
- Then `npx expo install --check` and `npx expo-doctor`.

### A2. `app.json`
- `npx expo install expo-build-properties`, add plugin:
  ```json
  ["expo-build-properties", { "android": {
    "enableMinifyInReleaseBuilds": true,
    "enableShrinkResourcesInReleaseBuilds": true,
    "useLegacyPackaging": false,
    "enableBundleCompression": false,
    "networkInspector": false } }]
  ```
  (`enableProguardInReleaseBuilds` is only a deprecated alias in SDK 57.) Keep rules for RN, expo-modules-core, reanimated, worklets are shipped as consumer rules; MapLibre's AAR has its own. Do **not** add `extraProguardRules` pre-emptively; only if a release crash points at reflection (candidates: `-keep class org.maplibre.reactnative.** { *; }`, `-keep class expo.modules.sqlite.** { *; }`).
- `android.allowBackup: false`; drop `RECORD_AUDIO` from `permissions` **and** add `"blockedPermissions": ["android.permission.RECORD_AUDIO"]` **and** `"microphonePermission": false` on the `expo-image-picker` plugin entry.
- Remove the `expo-secure-store` plugin entry (package is being uninstalled; prebuild fails otherwise). `expo-dev-client` may stay (its launcher compiles to stubs in release; only the `exp+summit` scheme leaks).
- Leave `newArchEnabled`, `jsEngine` (Hermes by default), `experiments`, `minSdkVersion` (default 24 = MapLibre floor) alone.

### A3. `eas.json` + environment
```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "environment": "development",
                     "ios": { "resourceClass": "m-medium" }, "android": { "buildType": "apk" } },
    "preview":     { "distribution": "internal", "environment": "preview",
                     "ios": { "resourceClass": "m-medium" }, "android": { "buildType": "apk" } },
    "production":  { "distribution": "store", "environment": "production", "autoIncrement": true,
                     "android": { "buildType": "app-bundle" } },
    "production-apk": { "extends": "production", "distribution": "internal", "android": { "buildType": "apk" } }
  },
  "submit": { "production": {} }
}
```
- Credentials via EAS environment variables, not `env` in eas.json:
  `npx eas-cli env:push production --path .env` (then the same for `preview`), and
  `npx eas-cli env:set --environment production --name EXPO_PUBLIC_MAP_STYLE_URL --value <style url>` so the tile provider is swappable without a code change. Verify with `env:list`.
- `versionCode` stays remote/auto-incremented; never add it to app.json. Seed once: `npx eas-cli build:version:set -p android -e production`.
- EAS Update: not now (`expo-updates` isn't installed; it adds native code and a startup check).
- These EAS commands need an interactive `eas login` that only Aarav can do; the plan prepares files, Aarav runs the commands.

### A4. Fonts and images
- Delete `assets/fonts/Outfit-Bold.ttf` and the `font.wordmark` token (0 consumers; tsc confirms).
- Subset the four Inter files to Latin + Latin-Extended with `/opt/anaconda3/bin/pyftsubset` (`--unicodes="U+0000-00FF,U+0100-024F,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD" --layout-features="kern,liga,calt,tnum" --no-hinting --desubroutinize`), keep `.ttf`, replace in place. Expect ~1.3 MB → ~250 KB.
- Embed natively with the `expo-font` config plugin (`"fonts": [the four Inter paths]`). Family names become the file basenames (`Inter-Regular` etc., which also match Inter's PostScript names on iOS), so `src/theme/tokens.ts` `font.ui` changes `'Inter'` → `'Inter-Regular'`. In `_layout.tsx` keep `useFonts` **for web only** (`useFonts(Platform.OS === 'web' ? FONTS : {})`) and remove the `if (!fontsLoaded) return null` gate on native; hide the splash from the root `View`'s `onLayout` instead of on font load.
- `brew install pngquant` then `pngquant --quality=70-90 --strip --ext .png --force assets/images/badges/*.png` (these ship uncrunched). Repo-hygiene deletions (no APK effect): `logo-glow.png`, `tutorial-web.png`, `react-logo*.png`, `expo-badge*.png`, `expo-logo.png`, `assets/images/tabIcons/`, `assets/expo.icon/`, `scripts/reset-project.js` + its npm script.

### A5. Fail loudly without a backend in release
`src/lib/supabase.ts` / `_layout.tsx`: when `!__DEV__ && !isSupabaseConfigured`, render a blocking "misconfigured build" screen instead of silently running on demo data. Cheap insurance against A3 being skipped.

---

## Phase B: runtime (Must)

### B1. One shared session
`src/features/auth/session.ts` → `.tsx`: add `SessionProvider` owning the existing `getSession()` + `onAuthStateChange` effect and a context; `useSession()` reads the context. Mount it inside `QueryClientProvider` in `_layout.tsx` (above `AuthGate`). Removes 3–5 subscriptions per screen and makes every `useLive` flip in one commit.

### B2. Memoise `useLive`
`src/lib/queries.ts:88-110`: `useMemo` the mapped result on `[query.isSuccess, query.data]` and the returned `{data,isDemo,isLoading}` object. Hoist every caller's inline `map` arrow to a module-level function and every per-render demo fallback to a module constant (they're static). Same for `useSetLocations`/`useSetCompleteBonus`. Add an optional `options` arg (`staleTime`, `meta`) for B4. Without this, every downstream `memo`/`useMemo` is defeated.

### B3. Explore: one fetch, distance client-side
`src/app/(tabs)/explore.tsx`: query key `['locations-all']` with `staleTime: 5 min`, fetched once against `FALLBACK_CENTRE`; a `rows` memo on `[data, centre]` recomputes `distance_m` with the existing `haversineM` (`src/features/trek/distance.ts:53`), precomputes `nameLc`, and sorts. Search (`locations`, `pins`) filters on `nameLc`. Keep `secret-spots-near` keyed by `centre` (round to 3 dp). Memoise `extraData` and hoist `renderItem` to `useCallback` (compiler bails on this component). In `useDeviceCentre`, try `getLastKnownPositionAsync()` first, then refine.

### B4. Persisted react-query + invalidation
- `npx expo install @tanstack/query-async-storage-persister @tanstack/react-query-persist-client`.
- `_layout.tsx`: `PersistQueryClientProvider` with `createAsyncStoragePersister({ storage: AsyncStorage, key: 'summit-rq-v1', throttleTime: 1000 })`, `gcTime: 24h`, `persistOptions.maxAge: 24h`, `buster: Constants.expoConfig?.version`, `shouldDehydrateQuery: success && !meta.noPersist`.
- Per-query `staleTime` via B2's options: `locations-all` 5 min; profile/collection/set-progress/recent-badges/badges/treks 60 s; league/standings 30 s; `secret-spots-near` 2 min + `meta: { noPersist: true }`.
- Invalidate after a claim: in `src/app/trek/arrival.tsx` after `setOutcome(result)` (non-deferred), `queryClient.invalidateQueries` on `['profile']`, `['collection']`, `['set-progress']`, `['recent-badges']`, `['badges']`, `['treks']`, `['league']`, `['standings']`, `['locations-all']`, `['set-locations']` (prefix match covers the `[key, userId]` keys). Same list in `_layout.tsx` when `syncPendingTreks()` resolves > 0.

### B5. Native map: data-driven circles instead of 645 native views
`src/features/map/trail-map.tsx`: build one GeoJSON `FeatureCollection` memoised on `[pins]` (properties: `id`, `colour`, `dimmed`); render `<GeoJSONSource id="pins" data onPress hitbox>` + `<Layer type="circle" paint={{ 'circle-radius': 6, 'circle-color': ['get','colour'], 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': ['case', ['==',['get','dimmed'],1], 0.22, 1], ... }}>`; press handler reads `event.nativeEvent.features[0].properties.id` and calls `onPinPress` through a ref (same pattern as the web variant). The selected pin is one `<LayerAnnotation lngLat>` with the existing `pinSelected` style. `export const TrailMap = memo(...)`. Per-pin `accessibilityLabel` is lost (layers aren't views); the sheet list carries the same items, note it in the header. Clustering (`cluster`, `clusterRadius`) is optional follow-up.

### B6. Tab bar blur off on Android
`src/components/tab-bar.tsx:70`: `Platform.OS === 'android' ? View : BlurView`; the existing `rgba(255,255,255,0.96)` background already dominates visually.

### B7. Badges screen: virtualised grid
`src/app/badges.tsx`: `FlatList` with `numColumns` from `useWindowDimensions` (cell 72 + gap 16), `initialNumToRender 16`, `windowSize 5`, `removeClippedSubviews`; extract `BadgeCell` (`memo`) taking `(badge, onPress(locationId))`; search on a precomputed `nameLc`; skeleton cells as `ListEmptyComponent` while loading. Header + search stay outside the list.

### B8. `Badge` component
`src/components/badge.tsx`: `export const Badge = memo(...)` (all-primitive props); RN `Image` gets `resizeMethod="resize"` so Android (Fresco) decodes the 240 px PNG at the 52–64 px view size instead of keeping a full bitmap per badge.

### B9. Trek recorder: batch deliveries, incremental distance
- `src/features/trek/recorder.ts` `beginLocationUpdates`: add `activityType: Location.LocationActivityType.Fitness`, `deferredUpdatesInterval: 15_000`, `deferredUpdatesDistance: 30` (fix density unchanged; only delivery is batched). Add `getTrekPointsSince(trekId, afterId)` (`where trek_id = ? and id > ? order by id`) and an index `(trek_id, id)` in `initTrekStore`.
- `src/features/trek/store.ts`: replace `points` with `pointCount`, `lastPointId`, `lastPoint`; `refresh()` reads only new rows, accumulates `distanceM` with `haversineM`, and skips `set()` when nothing arrived.
- `src/app/trek/live.tsx`: 1 s tick for the clock only; call `refresh()` every 5th tick; read the store through selectors. `arrival.tsx` only uses `distanceM` (unchanged).

---

## Phase C: Should (after A and B are measured)

- **C1 Startup**: move `isTrekStoreAvailable()`/`initTrekStore()`/`syncPendingTreks()` in `_layout.tsx` into `InteractionManager.runAfterInteractions` (the SQLite calls are synchronous); `TaskManager.defineTask` at import in `recorder.ts` must stay.
- **C2 Shared skeleton driver**: `SkeletonPulseProvider` in `_layout.tsx` owning one `useSharedValue` + `withRepeat` (`cancelAnimation` on unmount); `Skeleton` reads it via context and keeps its own cheap `useAnimatedStyle`.
- **C3 Set detail grid**: `set/[id].tsx` → `SectionList` over rows of N badges (Collected / Missing) with a memoised row component; `useMemo` `held`/`missing` on `[locations]`.
- **C4 Map clustering** on the `GeoJSONSource` from B5 (product call: rarity colours vanish inside clusters).
- **C5 Migration `0016`**: trim `slug`/`set_id`/`status` from `locations_near` and move the per-row `points_ledger` subquery to a lateral join; update `NearbyLocation`; run `supabase/tests/run.sh`. ~15% payload; defer until B3 is measured.
- **C6 `.easignore`** (only if upload time matters; it *replaces* `.gitignore`, so it must include `.env`).

## Sequencing
A1 → A2 → A3 → A4/A5 (one native build worth of config) → B1 → B2 → B4 → B3 → B5 → B6 → B8 → B7 → B9 → C*. B6, B8, B9 are independent and can slot anywhere. After A and B: `npx tsc --noEmit`, `npm run lint`, then a `production-apk` build for measurement and a `production` AAB for Play.

## Verification
- **Config (no build)**: `npx expo config --type introspect` (no `RECORD_AUDIO`, `allowBackup=false`, plugin list); `npx eas-cli build:inspect -p android -s pre-build -e production-apk -o <scratchpad>/inspect` and check `android/gradle.properties` (`android.enableMinifyInReleaseBuilds=true`, `...ShrinkResources...=true`, `hermesEnabled=true`) and the manifest; `npx expo-doctor`; `npx expo install --check`.
- **JS bundle locally**: `npx expo export --platform android --output-dir <scratchpad>/export --dump-assetmap`; compare `.hbc` size and font/image bytes in `assetmap.json` before/after A1/A4.
- **Binary**: `npx eas-cli build -p android --profile production-apk`; install adb/apkanalyzer (`brew install --cask android-platform-tools android-commandlinetools`); `apkanalyzer apk download-size`, `apkanalyzer files list --raw-size | sort -n -r | head -40` (expect no `androidx/compose`, no Glide), `adb shell dumpsys package com.summit.app | grep -A30 "requested permissions"`.
- **Cold start**: `adb shell am force-stop com.summit.app; adb shell am start -W -n com.summit.app/.MainActivity` ×5, read `TotalTime`; compare before/after A4 + B4 + C1.
- **Jank**: `adb shell dumpsys gfxinfo com.summit.app reset`, pan the map / scroll badges 30 s, `dumpsys gfxinfo` → janky-frame % before/after B5, B6, B7.
- **Re-render checks**: `npx react-devtools` profiler (Flipper is gone in 0.86): `LocationCard`/`BadgeCell` must not re-render on keystroke; `TrailMap` must not re-render on sheet drag.
- **Recorder**: `adb shell dumpsys batterystats --reset`, a 20-min walk on a dev build, `dumpsys batterystats com.summit.app | grep -A5 "Wake lock\|GPS"`; expect ~4× fewer task wakeups; `trek/live` JS FPS steady via the dev-menu Perf Monitor over the whole walk.
- **Network**: `adb shell dumpsys netstats detail | grep -A3 com.summit.app` per Explore open: one ~270 KB RPC, not two.
- **SQL** (only if C5 lands): `supabase/tests/run.sh`.
- Device testing and EAS builds need Aarav (interactive `eas login`, a physical Android device); everything else is runnable here.
