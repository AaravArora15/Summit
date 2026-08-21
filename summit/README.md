# Summit

Trek to places worth walking to, hunt the spots nobody signposts, and put your
number on them first.

The design is `../design-mockup-v4.html` (35 screens). It is the source of truth
for anything visual; `src/theme/tokens.ts` is a transcription of it, not a
reinterpretation. The stack and its reasoning are in `../TECH-STACK.md`.

## Running it

This app **cannot run in Expo Go**. Background location and (later) MapLibre are
native modules Expo Go does not contain. You need a development build:

```bash
npm install
cp .env.example .env          # fill in from your Supabase project
npx eas build --profile development --platform ios
npx expo start --dev-client
```

Once the dev build is on the device, JS changes hot-reload as normal. You only
rebuild when a native module is added.

## Layout

```
src/
  app/            expo-router routes; (tabs) holds the five-tab shell
  components/     ui.tsx primitives, icons, the custom tab bar
  theme/          design tokens ported from the v4 mockup
  features/
    auth/         anonymous sessions, and the upgrade path off them
    trek/         background recording, the part that must work offline
  lib/            supabase client, typed RPC wrappers, and queries.ts
../supabase/migrations/   schema, RLS, and the pioneer allocation function
```

`lib/queries.ts` is where the screens get their data. Every hook there returns
the shape the screen already renders, so a tab moves from placeholder to live
by changing its source and nothing else.

Home, Collect, Explore, and League read live. Explore's map pins, filters and
secret-spot hunt list are real (`locations_near()` now returns coordinates and
a claimed flag; secret spots are found the same way public locations are, via
`startTrekTo`/`startHuntFor` in `explore.tsx`, just aimed at a fuzzed circle
instead of a named place). A secret-spot claim asks for a photo before it ever
tries to sync (`trek/arrival.tsx`), which `sync.ts` uploads to the
`claim-photos` bucket.

Still placeholder, because it has no table yet rather than because the query
is unwritten: the nearby secret-spot count on Home, and the Groups segment of
the League tab.

Two more routes sit outside the tabs: `set/[id]` (a set's full badge board —
collected and missing, the missing ones drawn as a dimmed copy of the real
badge rather than a mystery shield) and the Profile passport's trophy road (a
short stretch of upcoming levels in place of a plain percentage bar). Home
links to both: the closest-set card opens `set/[id]`, and the avatar and the
explorer-level tile both open Profile.

## Two things to keep true

**The server decides.** The client submits a trek; it never computes a pioneer
number, a points total, or a league position. See `claim_location()` in the
migration for why the allocation is locked and constrained.

**Depth is hairlines.** No shadows, and never a coloured glow. The v4 pass
existed to remove exactly that, and it is the fastest way back to looking like a
toy.

**"No backend" and "nothing yet" are different answers.** Demo data stands in
only while there is nobody to ask. Once a query succeeds its answer is used,
empty included, and the screen shows the empty state it was designed with. A
new account holds no badges; filling its Latest strip with three invented ones
is not graceful degradation, it is a lie, and it is the exact bug that hides a
broken query behind a screen that looks fine.
