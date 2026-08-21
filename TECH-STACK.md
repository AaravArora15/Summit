# Summit: Tech Stack

**Decision date:** 19 August 2026
**Status:** Locked for the hackathon build

---

## The one-line answer

**React Native via Expo** on the client, **Supabase (Postgres + PostGIS)** on the server, **MapLibre** for maps, built as an **EAS dev build** from day one.

---

## 1. Client: Expo (React Native)

Confirmed. One codebase for iOS and Android, and the fastest path from the v4 mockups to something running on a phone.

| Concern | Choice |
|---|---|
| Framework | Expo, latest SDK via `npx create-expo-app@latest` |
| Language | TypeScript, strict |
| Navigation | `expo-router` (file-based, tabs + stacks) |
| Animation | `react-native-reanimated`, `react-native-gesture-handler` |
| Bottom sheets | `@gorhom/bottom-sheet` |
| Vector UI | `react-native-svg` |
| Gradients | `expo-linear-gradient` |
| Fonts | `expo-font` (Inter for UI, Outfit for the wordmark) |
| Images | `expo-image` |
| Haptics | `expo-haptics` |
| Icons | Hand-rolled SVG components, matching the 1.5px stroke system in v4 |

### Build the dev client on day one

This is the single most important setup decision. **Do not start in Expo Go.** Background location, MapLibre, and in-app purchases are all native modules that Expo Go cannot load. Starting in Expo Go means rewriting the trek loop later, which is exactly the thing you cannot afford mid-hackathon.

```bash
npx expo install expo-dev-client
npx eas build --profile development --platform ios
```

From then on, `npx expo start --dev-client`. JS changes still hot-reload normally. You only rebuild when you add a native module.

### Porting the v4 mockups

The design ports almost directly, because it is all shapes and type rather than raster art. Two things do not translate one-to-one:

- **Progress rings** use `conic-gradient` in the mockup. RN has no conic gradient. Rebuild them as an SVG circle with `stroke-dasharray` / `stroke-dashoffset`.
- **`backdrop-filter`** on the tab bar becomes `expo-blur` (`BlurView`).

Everything else (shields via `clip-path` equivalents in SVG, deed cards, difficulty peaks, pioneer meters, the ridge illustrations) is a direct `react-native-svg` translation.

---

## 2. Maps and location

This is the part of the stack that actually decides whether the product works, so it gets the most care.

### Maps: MapLibre, not react-native-maps

**`@maplibre/maplibre-react-native`**

Reasons, in order of weight:

1. **Custom cartography.** The explore screen is a specific muted-green topographic style. MapLibre takes a style JSON, so you get exactly that. `react-native-maps` gives you Apple's or Google's cartography with limited restyling.
2. **Offline tile packs.** Trails have no signal. MapLibre can download and store a bounded region ahead of time. This is not optional for a hiking product.
3. **No per-load billing.** Free tile sources or self-hosted, versus Google Maps SDK pricing.

Tiles: start with a free provider (MapTiler free tier, Protomaps, or Stadia) and restyle. Swap the source later without touching app code, since it is just the style JSON.

**Risk to verify in the first hour:** confirm MapLibre RN's New Architecture support against whatever Expo SDK `create-expo-app` gives you today, since the New Architecture is the default in recent SDKs. If it fights you, `react-native-maps` is the fallback and you accept stock cartography for the demo.

### Location: expo-location + expo-task-manager

Three distinct jobs, three different APIs:

| Job | API |
|---|---|
| Where am I right now (map, location cards) | `getCurrentPositionAsync` / `watchPositionAsync` |
| Live trek recording, screen off, in a pocket | `startLocationUpdatesAsync` + `TaskManager` background task |
| Secret spot proximity, screen off | `startGeofencingAsync` |

Config needed in `app.json`:

- iOS: `UIBackgroundModes: ["location"]`, plus honest `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription` strings. App Store review reads these, and a vague one gets rejected.
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`.

**Permission flow:** ask for "when in use" first, during onboarding, and only escalate to "always" at the moment the user starts their first trek, with the reason on screen. Asking for background access cold on screen 01 gets denied and you never get a second chance.

**Battery:** use `Accuracy.Balanced` while idle, escalate to `Accuracy.High` only during an active trek. A hiking app that eats 40% of a battery in two hours does not get a second use.

---

## 3. Backend: Supabase

Postgres, PostGIS, auth, storage, realtime, and edge functions in one box. For a hackathon this is the highest ratio of capability to setup time, and unlike Firebase it gives you the one thing Summit genuinely needs.

### Why PostGIS specifically

Every core question this app asks is spatial:

- "What is within 5 km of me, sorted by distance" (explore map, screen 06)
- "Am I within 40 m of this secret spot" (hunt, screen 10)
- "Is this GPS track plausibly a walk to that summit" (claim validation)

That is `ST_DWithin`, `ST_Distance`, and `geography(Point,4326)` with a GiST index. Firebase has no real spatial query and pushes you into geohash workarounds, which is why it is not the pick here.

### Services used

| Need | Supabase piece |
|---|---|
| Data + spatial queries | Postgres 15 with PostGIS |
| Auth | Supabase Auth (Apple + Google) |
| User photos | Storage buckets |
| League leaderboard updates | Realtime subscriptions |
| Privileged logic | Postgres functions (`SECURITY DEFINER`) |
| Access control | Row Level Security on every table |

Client: `@supabase/supabase-js` with session persistence in `expo-secure-store`.

### The pioneer number is the sharp edge

Every location caps at 500 pioneer numbers, permanently assigned in claim order. **Two people summiting at the same moment must not both receive #0048.** This is the one place in the backend where a race condition breaks the product's central promise, so it is worth doing properly on day one rather than patching later.

Rules:

1. Numbers are allocated **server-side only**, in a `SECURITY DEFINER` Postgres function. Never computed on the client and never derived from a client-supplied count.
2. A **unique constraint on `(location_id, pioneer_number)`** is the backstop. Even if the logic is wrong, the database refuses the duplicate.
3. Allocation takes a **row lock on the location** (`SELECT ... FOR UPDATE` on a per-location counter row) so concurrent claims serialise instead of both reading the same max.
4. Past 500, the claim still succeeds but is recorded as an **Explorer edition with a null pioneer number**, exactly as the onboarding screen promises.

Sketch:

```sql
create table locations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  geom          geography(Point,4326) not null,
  pioneer_cap   int not null default 500,
  pioneer_taken int not null default 0
);
create index locations_geom_idx on locations using gist (geom);

create table claims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id),
  location_id    uuid not null references locations(id),
  pioneer_number int,                    -- null = Explorer edition
  claimed_at     timestamptz not null default now(),
  unique (user_id, location_id),
  unique (location_id, pioneer_number)   -- the backstop
);
```

The allocating function locks the `locations` row, increments `pioneer_taken`, and returns the number (or null once the cap is hit), all inside one transaction.

### Other things that belong server-side

Anything a user would benefit from lying about:

- Points awarded for a trek
- League standings and promotion/relegation
- Secret spot discovery
- Set completion and title unlocks

The client submits a finished trek. The server decides what it was worth.

---

## 4. Integrity: assume the GPS is lying

Summit's entire economy is scarcity: permanent numbers, capped at 500, ranked in a league. That makes it worth spoofing, and mock location is a two-tap setting on Android. This does not need to be bulletproof for a hackathon, but the hooks should exist:

- Read the **`mocked` flag** that `expo-location` exposes on Android position objects.
- Validate the submitted track **server-side**: continuity between points, plausible speed (reject a 60 km/h "walk"), and total elapsed time against distance.
- Require an actual **track**, not a single point. A claim with one GPS fix and no path is not a trek.
- Rate-limit claims per user per hour.

---

## 5. Supporting pieces

| Need | Choice | Note |
|---|---|---|
| Server state | `@tanstack/react-query` | Caching, retries, offline refetch |
| Client state | `zustand` | One small store for the active trek session. No Redux. |
| Local persistence | `expo-sqlite` | Buffers GPS points offline, syncs on reconnect |
| Fast key-value | `react-native-mmkv` | Settings, flags, cached view state |
| Validation | `zod` | Shared shapes between client and edge functions |
| Dates | `date-fns` | League months, trek timestamps |
| Push | `expo-notifications` | Weekly mystery clue drops, league close, promotion |
| Payments | `react-native-purchases` (RevenueCat) | Only if the paywall (screens 34/35) is in the demo |
| Photos | `expo-image-picker`, `expo-camera` | Community photos on badge detail |
| Errors | Sentry (`@sentry/react-native`) | Optional, cheap to add |

### Offline is a first-class requirement

Restating this because it is easy to defer and expensive to retrofit: **trails have no signal.** The trek loop must work fully offline. Buffer every GPS point to SQLite as it arrives, mark the trek as pending, and sync when connectivity returns. The claim is validated and the pioneer number allocated at sync time, not at trek time. That means the arrival screen (11) should show the number as *pending* if offline, not fabricate one.

---

## 6. Build and ship

- **EAS Build** for dev, preview, and production profiles.
- **EAS Update** for JS-only fixes during the event, which is how you fix a demo bug without a rebuild.
- `eas.json` with three profiles. Get the development profile building on a real device before writing feature code.

---

## 7. Deliberately not chosen

| Rejected | Why |
|---|---|
| Flutter | Fine technically, but no advantage here and it costs the React familiarity |
| Firebase | No real spatial querying. Geohash workarounds for the app's core query is the wrong trade. |
| Convex | Good DX, but no PostGIS |
| Bare React Native | Loses EAS, config plugins, and OTA updates for no gain |
| `react-native-maps` | Fallback only. Cannot deliver the custom cartography or offline packs. |
| Redux | Overkill for this surface area |
| Mapbox | Better DX than MapLibre, but paid, and MapLibre covers the need |

---

## 8. Setup order for day one

Do these in sequence. The first three are the ones that block everything else.

1. `create-expo-app` with TypeScript, add `expo-dev-client`, get a development build onto a physical device.
2. Stand up Supabase, enable PostGIS, create `locations` and `claims`, write and unit-test the pioneer allocation function against concurrent calls.
3. Get MapLibre rendering a custom style inside the dev build, and confirm New Architecture compatibility.
4. Port the v4 design tokens into a theme module (colours, radii, type scale, the four rarity colours, the six set colours).
5. Build the tab shell and the explore map, which together prove the hardest part of the stack works.
6. Then the trek loop: start, background record, arrive, claim, points.

Everything after step 6 is screens over a working spine.

---

## 9. Known risks

| Risk | Mitigation |
|---|---|
| MapLibre vs New Architecture friction | Verify in hour one. Fall back to `react-native-maps` for the demo. |
| iOS background location review | Write honest permission strings now. Not a hackathon blocker. |
| Battery drain during treks | Tiered accuracy, escalate only during an active trek |
| GPS spoofing | Server-side track validation, mock-location flag |
| Offline sync conflicts | Server is authoritative on numbers and points. Client never assigns either. |
| First EAS build is slow | Kick it off before you need it, not when you need it |
