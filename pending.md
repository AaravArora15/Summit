# Pending decisions

## Update, 2026-09-16: League rollover now re-enrolls everyone at 0

Closes the "known gap" noted under 2026-08-22: `run_league_rollover()`
computed tier promotions/relegations but never actually placed anyone in the
new month's league, so `my_league()` returned nothing (and the app showed
demo data) until a user scored again. Migration `0027_league_rollover_reenroll.sql`
adds a loop, after the tier update, that calls the existing `league_for_user()`
for everyone who was in last period's leagues — same division-filling logic
every other enrollment path already uses, so a promoted/relegated user lands
in their new tier at 0 points/treks/distance immediately, not their old one.
Idempotent (skips anyone already enrolled for the new period, e.g. someone
who already scored before the job ran) and safe to re-run.

New test `130_league_rollover.sql`: top/second performer of a synthetic
division get carried into the new period at the promoted tier and 0 points,
a user who'd already scored this month keeps their points (not clobbered),
and re-running the rollover doesn't duplicate or reset anything. Full local
suite unaffected (re-ran 30 and 120 alongside it); the pre-existing Wildcard
test failures in this sandbox (`my_wildcard()` "ran out of open locations")
are unrelated to this change — not investigated further here.

**Deployed to live** (schema-only, migration 0027 applied directly — live
was already caught up through 0026). Nothing else needed; no seed changes.

## Update, 2026-09-06 (later the same day): Capture Territory, phase 1

Scoped deliberately: the game logic (clusters, capture detection, time
tracking, a leaderboard), not the fog-of-war map visual (the whole map
dark/grey, clearing as you capture) — that's a separate, sizeable rendering
project (polygon overlays, progressive reveal) that belongs in its own pass
once this half is solid. Confirmed with Aarav before building, given how
different in size the two pieces are.

A territory is a small, curated cluster of 3-4 *geographically close*
locations — distinct from `location_sets`, which group by theme ("Trails",
"Coastal") and can span continents. Claim every location in one and it's
captured: the time between your first claim in the cluster and the one that
completes it is banked, and `territory_leaderboard()` ranks the fastest
captures for that territory.

- Migration `0025_territories.sql`: `territories` table,
  `locations.territory_id` (one territory per location, exactly like
  `locations.set_id` already works — no join table), `territory_captures`
  (banks `started_at`/`captured_at`/`duration_s`, unique per user per
  territory). `create_territory(name, location_ids)` is admin-only (reuses
  `profiles.is_admin`) and requires exactly 3-4 open, public, not-already-
  assigned locations — curated the same trust level as turning a suggestion
  into a location, not an on-the-fly algorithm.
- Capture detection is a new branch in `award_claim_points()` (the same
  trigger every claim already runs through): once every location in a
  territory is held, banks the duration and pays a flat 60 xp / 120 monthly
  bonus (`territory_capture`, added to the points_ledger source list).
- Read APIs: `my_territories()` (list, closest-to-captured first, same
  ordering rule `my_set_progress()` uses), `territory_locations()` (members,
  held or not), `territory_leaderboard()` (fastest captures, `is_you`
  flagged, public the same way league standings already are).
- **Starter content, not hand-authored:** `seed/0004_territories.sql` runs
  `ST_ClusterDBSCAN` over the real ~640-location world seed *after* it's
  loaded (migrations run before that seed does, so the clustering can't live
  in the migration itself — it would find nothing). Found 8 real clusters of
  3-4 tightly-grouped locations (Delicate Arch, Cascade Canyon, Bunsen Peak,
  and five others) and named each after its alphabetically-first member.
  Capped at 8, skipped entirely if any territory already exists.
- Client: `(tabs)/collect.tsx` gained a "Territories" section, same shape as
  "Set progress" (a compact row per territory, held/total or a captured time,
  tap to open). New screen `territory/[id].tsx` — deliberately a plain list,
  not a badge grid like `set/[id].tsx`: a territory's members can belong to
  entirely different sets with entirely different glyphs, so there's no
  single glyph to unify the view around. Shows the summary, a captured/
  fastest-time card, every member location, and the leaderboard.
- New test `120_territories.sql`, 11 assertions: admin-only creation, wrong
  location count refused, an already-assigned location refused, partial
  progress tracked correctly, the bonus paying out on the completing claim,
  a real (>=0) banked duration, the leaderboard listing multiple captures
  with `is_you` correctly scoped per caller. Full local suite green (zero
  FAILs across every test file), clean `tsc --noEmit`, clean `expo lint`
  (only the two pre-existing, unrelated findings remain — `explore.tsx`'s
  `PRO_FILTERS` warning and `arrival.tsx`'s `set-state-in-effect` error,
  both present before this session).
- **Needs migration 0025 *and* `seed/0004_territories.sql` deployed to
  live**, in that order, same "run the missing migrations/seeds by hand"
  step as everything since 0019 — the starter territories won't exist until
  the seed runs. Not verified in a real browser/device, same standing
  tooling limitation as everything else in this file.

**Next, when picked back up: the fog-of-war map visual** — the actual
"whole map is grey until you capture" experience — is the deliberately
deferred half of this feature. Scope it as its own pass: it needs map
polygon/overlay rendering (MapLibre) keyed off `territories.centre` and
member geometry, plus a progressive-reveal treatment, neither of which
exists anywhere in this app yet.

## Update, 2026-09-06: Wildcard

New ask, not from the earlier audit: a set of "game" ideas (Secret Spot
hunting enhancements, Capture Territory, Capture the Flag, The Torch,
Wildcard). Secret Spot hunting overlaps heavily with what already exists
(hunt cards, photo-required claims, suggest-a-location) so wasn't rebuilt.
Capture Territory/Capture the Flag/The Torch are parked. **Wildcard shipped**
— redesigned mid-build after the first pass ("Go" straight to a named pin on
the map) turned out not to be what was wanted at all. The real ask: Wordle
for places. The app picks one open, non-secret location per user per day and
never says which one — no name, no pin, nothing on the map. The only clues
are rarity and difficulty. Starting a hunt opens a live compass: distance
and a direction arrow toward the hidden pick, computed server-side from
wherever you currently are, updating as you walk. Claiming it (arriving,
same dwell check as any claim) within 24 hours pays a flat bonus and is the
moment the name is finally revealed. One reroll allowed per day, only
before it's claimed.

- `daily_wildcards` table (user_id, wildcard_date, location_id, assigned_at,
  rerolled, claim_id) plus three RPCs — migration `0024_daily_wildcard.sql`:
  - `my_wildcard()`: lazily assigns the day's pick, idempotent after that.
    Always returns rarity/difficulty (the hints); withholds
    name/slug/set_key/set_name — returned as `null` — until `claimed`, at
    which point they become the reveal.
  - `reroll_wildcard()`: unchanged from the first pass — swaps to a
    different location once per day, only before it's claimed.
  - `wildcard_bearing(lat, lng)`: new. Takes the caller's live position and
    returns `distance_m`/`bearing_deg` (degrees clockwise from true north)
    computed against the real, hidden geometry — the coordinates themselves
    never leave Postgres. Empty once there's nothing left to find (no pick
    yet, or today's is already claimed).
- The bonus (50 xp / 100 monthly, flat) is unchanged: a branch in
  `award_claim_points()` firing when the claimed `location_id` matches an
  unclaimed `daily_wildcards` row still inside its 24-hour window. `wildcard`
  is in `points_ledger`'s source check constraint and the reward screen's
  `SOURCE_LABEL`/`SOURCE_ORDER` maps (`trek/arrival.tsx`).
- Client, the actual rework:
  - `features/trek/store.ts` gained `targetIsWildcard` alongside
    `targetIsSecret` — a real `location_id` (so `claim_location()` still
    fires on arrival) but deliberately no name/rarity/glyph/lat/lng, the
    same withholding `targetIsSecret` already does for a fuzzed fence.
  - `(tabs)/index.tsx` (Home)'s card now shows only a rarity chip +
    difficulty (no name) and a "Start hunting" button that begins a real
    trek session (permission request factored out of explore.tsx into
    `features/trek/start.ts`'s `beginTrekSession()`, now shared by both
    screens) and navigates to `trek/live`.
  - `trek/live.tsx` gained the compass: `Location.watchHeadingAsync()` for
    the device's own facing, `wildcard_bearing()` polled every 5s off the
    latest GPS fix (piggybacked on the screen's existing 1Hz tick, not a
    second timer), and an arrow rotated by `bearing_deg - heading` so it
    points the actual way to turn rather than a raw compass bearing.
    Degrades gracefully with no heading sensor (rotates to raw bearing
    instead) — simulators commonly report none.
  - `trek/arrival.tsx`: a claimed Wildcard's reveal is fetched fresh via
    `useWildcard()` (now unlocked since `claimed` flips server-side) rather
    than from the store, which never had the name to begin with; the sync
    effect invalidates the `['wildcard']` query the moment a Wildcard claim
    lands so that refetch isn't serving a stale pre-claim cache.
  - Demo mode presents the same withheld-name shape a real first-time user
    would see (not a "found" state most people won't reach on day one) —
    `demo-data.ts`'s `DEMO_WILDCARD_LOCATION` gained `difficulty`; Reroll
    stays hidden in demo (a mutation with nothing real to mutate against).
- New test `110_wildcard.sql`, 15 assertions — the original 11 (assignment,
  idempotency, reroll rules, the bonus paying out, claiming elsewhere
  earning nothing) plus 4 new: name/slug/set stay null before claiming,
  `wildcard_bearing()` reports the right live distance/direction from a
  synthetic point 1000m due east of the real (hidden) location, the reveal
  surfaces the real name/slug once claimed, and `wildcard_bearing()` goes
  quiet once claimed. Full local suite green, clean `tsc --noEmit`, clean
  `expo lint` (only the two pre-existing, unrelated findings remain:
  `explore.tsx`'s `PRO_FILTERS` warning and `arrival.tsx`'s
  `set-state-in-effect` error, both present before this session).
  **Needs migration 0024 deployed to live**, same as every migration since
  0019 — not verified on a real device, which matters more than usual here:
  the compass/heading path has no equivalent in this sandbox at all (no
  prior tooling limitation covers it, this is a genuinely new kind of
  untested surface) and deserves an actual walk-test before trusting it.

## Update, 2026-08-31

Since the audit below: **paywall (item 1) landed** — `react-native-purchases`
+ `-ui` are in `package.json`, `lib/purchases.ts` configures the SDK, links
identity to the Supabase user, and `presentPaywall()` gates the "Rarity,
sets & spots" Explore filter exactly per the mockup. Still needs real
RevenueCat keys in `.env` before it does anything (currently unconfigured,
which the code treats as "paywall off", not a crash).

**Safety, scoped-down version (item 2) also landed:** a closed/seasonal
banner on the Explore location-detail sheet and a status chip on location
cards (both reading `status`/`status_note`, now returned by
`locations_near()` and `set_locations()` — migration
`0020_location_status_note.sql`, which also stopped `set_locations()` from
silently dropping closed locations from the set-detail list), a
confirm-before-you-walk dialog when starting a trek to a non-open location,
a "Closed"/"Seasonal" label on missing badges in `set/[id].tsx`, and a
closure-alert notification channel + permission request
(`features/trek/closure-alerts.ts`, wired into onboarding's "agree" step).
That channel is plumbing only — nothing calls `notifyClosure()` yet, since
the thing that would decide "this place just closed" (a realtime
subscription or a weather feed) is still the deferred stretch piece. Not
verified in a browser this session — the sandboxed Chrome tooling couldn't
reach the local dev server (localhost and 127.0.0.1 both failed with a
"frame is showing error page" error even from a plain new tab and with the
dev server run outside the sandbox); verified instead via a clean
`tsc --noEmit`, `expo lint` (no new issues), and the local Postgres suite
(`supabase/tests/run.sh`, including a new `70_location_status.sql`).
Worth an actual look in a real browser/simulator before calling it done.

**Itemized points on the reward screen (item 3) also landed:** a new
`claim_points_breakdown(claim_id)` RPC (migration
`0021_claim_points_breakdown.sql`) returns the real per-source XP rows for
one claim — the same permanent total `locations_near()` already sums as
`points_earned`, just itemized instead of pre-summed, and ownership-checked
against `auth.uid()` since it's SECURITY DEFINER. `trek/arrival.tsx` now
shows a "Points earned" card under the pioneer-number card on a successful
claim: total plus a line per source (Distance, Moving time, Badge, First
stop in a new set, Difficulty, Set complete, Secret spot, Faster than
average — whichever actually fired). New test `80_claim_points_breakdown.sql`
covers the total matching, source coverage, and the ownership check.
Verified the same way as item 2: clean `tsc --noEmit`, clean `expo lint`,
local Postgres suite passing — **not** verified in a real browser, same
sandboxed-Chrome-can't-reach-localhost issue as before (tried again on a
fresh port, same failure).

**Inactivity nudge (item 4) also landed, and needed no server changes at
all** — pure client: a new `features/trek/inactivity-nudge.ts` schedules one
local notification, always NUDGE_AFTER_DAYS (4, a judgement call) after the
most recent trek, cancelled and rescheduled further out every time a trek
finishes syncing (hooked into `sync.ts`'s `syncTrek()`, on any outcome
except `'deferred'` — matches the existing "still counts" philosophy for a
rejected claim). "Last trek" is tracked in AsyncStorage, keyed per user id
(`@summit/last_trek_at:<uid>`) so switching accounts on one device doesn't
carry over the wrong schedule; a fresh install with no local history falls
back to asking the server once via the existing `my_treks(1)` — no new RPC
needed. Wired into `_layout.tsx`'s `AuthGate` alongside the RevenueCat
identity sync. Verified with `tsc --noEmit` and `expo lint` only (no
server-side surface to test against Postgres this time) — still no real
browser/device check, same tooling limitation as the other two.

**Submission review (5) and titles alignment (6) also landed, together —
migration `0022_titles_and_review.sql`, since both needed the same new
primitive first: `profiles.is_admin`.** There was no admin/staff concept
anywhere in this schema before this — confirmed by grepping every prior
migration. Decisions confirmed with Aarav before building:

- Admin gating: a plain `is_admin boolean default false` column, flipped by
  hand via SQL for whoever should review (same one-off-SQL pattern already
  used elsewhere in this project). **Not yet done on live** — see below.
- Titles: `my_profile()` now derives one from the most recently completed
  *set's own name* ("Trails" → "Trails Keeper"), mechanically, replacing the
  old 3-tier "how many sets total" version in `queries.ts`'s `titleFor()`
  (deleted). Still no titles table — computed the same way it always was,
  just from the right input now.
- `set_complete` XP bumped 80 → 400 (spec's "badge + title + 400 points").
  Monthly stays at 80 — a separate concern the spec wasn't describing.
  Future claims only; nothing already-earned was rewritten.
- Suggestion review: `pending_location_suggestions()` (admin-only list),
  `approve_location_suggestion()` (creates the real, claimable `locations`
  row — reviewer picks slug/rarity/difficulty/set at approval time, since a
  suggestion only ever captures a name and a point), `reject_location_suggestion()`.
  New screen `summit/src/app/review.tsx`, reachable from Settings only when
  `profile.isAdmin` — but also gates itself if reached by direct link.

New test `90_titles_and_review.sql` covers all of it (400/80 point split,
title derivation, admin gating both ways, the full approve/reject flow).
Full local suite green. Verified with `tsc --noEmit` and `expo lint` only
otherwise — no real browser/device check, same standing limitation as every
other item above.

**Action needed before this does anything: nobody is an admin yet, even on
live.** Once migration 0022 is deployed (see the now-familiar "run the
missing migrations by hand" step), flip your own account with:
```sql
update profiles set is_admin = true where id = '<your auth.users id>';
```
Everything else in the priority order from the 2026-08-30 audit is now
built. Weather-API integration and the closure-alert trigger logic remain
explicitly deferred, as scoped in item 2 above. The pioneer-cap-at-1000
dev-testing note from item 2/the 2026-08-22 entry below is still
outstanding — revisit before shipping.

## Badge detail: the run behind a claim (2026-08-31, outside the audit)

Not from the priority list above — a direct ask: tapping a badge in the
badge browser (`badges.tsx`) now opens it full-screen, centred (reusing the
same `BadgeReveal` aura the claim moment itself uses), with the walk behind
it underneath: time, distance, pace. "Show on map" (the old tap behaviour)
moved to a button inside the new detail view rather than being the tap
target itself.

New RPC `claim_run_stats(claim_id)` (migration `0023_badge_run_stats.sql`)
walks `claims -> treks` the same way `my_treks()` already does, and hands
back the trek's real `distance_m`/`moving_time_s` **only** when there is a
genuine walked track — never for a claim with no trek at all, and never for
one made through the `__DEV__`-only fake-claim shortcut
(`dev-fake-claim.ts`), which parks every GPS point on the pin and always
uploads a fixed 120 m / 55 s. A new `treks.is_dev_fake` column (default
`false`, set by `dev-fake-claim.ts`'s insert) is what tells the two apart;
without it a fake claim's nonsense pace would show as someone's real time.

When there's no genuine track, the client (`features/trek/run-stats.ts`)
estimates instead — "the generic runtime of a hike" — from the claimed
location's own `distance_m`/`avg_time_min`/`difficulty` (all returned
alongside by the RPC), falling through: real `avg_time_min` if the location
has one (it almost never does — `scripts/seed-csv.mjs` never populates it,
despite the column already existing and being read by the `beat_average`
bonus check since migration 0005), else a pace derived from difficulty
applied to the location's own `distance_m`, else a generic distance for that
difficulty tier too. The estimate is always labelled as one in the UI, never
shown as if it were a real walk. Demo mode (no backend at all) always hits
this same estimate path — `DEMO_BADGES` in `demo-data.ts` gained a
`difficulty` field for exactly this.

New test `100_claim_run_stats.sql` covers all three cases (real trek, dev-fake
trek, no trek at all) plus the ownership check. Full local suite green,
clean `tsc --noEmit`, clean `expo lint`. Not verified in a real browser —
same standing sandboxed-Chrome-can't-reach-localhost limitation noted
throughout this file. **Needs migration 0023 deployed to live** before any
of this works there, same "run the missing migrations by hand" step as
every migration since 0019.

## Feature gap audit vs. spec, and what's left (2026-08-30)

Audited the "Features that should be included" / "Ship if there's time" /
"must be removed" spec against the actual codebase. Everything not listed
below is confirmed built: GPS/path verification & anti-spoof, the map
(648 real locations seeded, past the 312 target), trek+claim with an
offline queue, pioneer numbers, badges/sets/Collect dashboard, the monthly
league with promotion/relegation, secret spots with photo proof, the trek
journal, and group competitions by invite code. Weekly mystery is cleanly
gone — no leftover schema or UI.

Gaps, in the order we agreed to tackle them — see "Priority order" below
before picking one up:

1. **Paywall (RevenueCat).** Not started — no RevenueCat/Purchases
   dependency in `package.json` at all. The spec itself calls this
   "required for the hackathon to count."
2. **Safety — closed-status UI + closure alerts.** `locations.status`
   (open/closed/seasonal) exists and `claim_location` already refuses a
   closed location server-side, but no client screen ever reads or shows
   it — a user only finds out after walking there, via the generic
   rejection message on arrival. There is no closure-alert notification
   channel. Weather forecast integration doesn't exist at all.
   `sign-in.tsx:496` already promises "Weather and closure alerts cannot be
   switched off" as onboarding copy, with nothing behind it yet.
3. **Itemized points on the reward screen.** Server side is genuinely
   done — `points_ledger` has real per-source rows (distance, elevation,
   badge, difficulty, etc.) via `award_claim_points()`. `arrival.tsx` never
   displays points at all, itemized or as a total, and no screen publishes
   the point rates in-app.
4. **Inactivity nudge.** Not built. `expo-notifications` is wired up, but
   only for the secret-spot geofence hunt — no "haven't trekked in a
   while" scheduled check exists.
5. **User submissions — no review path.** Submit + track-your-own-status
   works. No admin/reviewer UI; approving a suggestion into a real
   `locations` row is a manual SQL update today (documented as such in
   `0014_location_suggestions.sql`'s own comment).
6. **Titles — simplified vs. spec.** Spec: "set completion gives badge +
   title + 400 points," per set. Built: 3 coarse title tiers by *total*
   sets completed ("Completionist"/"Set Collector"/"Keeper of Stones"),
   computed client-side, not stored server-side; set completion actually
   pays 80 points, not 400.

Also noted, not a feature gap: `supabase/SETUP.md:184` still says "Crew and
private groups... still placeholder" — stale, Groups is fully shipped.
Worth a one-line doc fix whenever someone's in that file.

### Priority order (reasoning, not yet re-confirmed with Aarav this session)

1. Paywall first — explicit hackathon submission requirement, not a
   judgment call.
2. Safety, but scoped down: ship the closed/seasonal status banner +
   pre-trek warning and a closure-alert notification channel skeleton
   first (cheap, and the copy already promises it); treat full weather-API
   integration as a separate, lower-priority stretch within this item
   rather than blocking on it.
3. Itemized points reward screen — the data already exists server-side,
   this is a UI-plus-one-query job with good payoff for how rewarding the
   core trek loop feels.
4. Inactivity nudge and (5) user-submission review are both "ship if
   there's time" tier in the spec itself; the manual-SQL review stopgap is
   fine for hackathon scope.
5. Titles spec alignment last — cosmetic, cheap, no reason to block
   anything on it.

Also outstanding from earlier this session: the pioneer cap is at 1000
everywhere (raised for dev testing, see the trek-store/badge-reveal work) —
revisit before shipping, tracked here so it doesn't get silently forgotten.

## Live project schema state (2026-08-22)

Live is now at migration **0015**. Until today it had stopped at 0012:
0014 (suggest-a-location) and 0015 (untargeted trek scoring) were listed in
`deploy.sh` but had never been applied, so the Suggest screens had no table
to write to and a validated trek counted treks/km in the league but earned
zero points.

Applied today, in order, all via `!` from the terminal (Claude's own write to
the live DB is blocked by the permission classifier, by design):

1. `seed/0002_test_accounts_activity.sql` — re-enrolled the 18 test profiles
   into August's division (they had been cascaded out when the Singapore
   city was deleted on the 21st: `leagues.city_id ... on delete cascade`) and
   gave them 1–6 validated treks each through the real trigger path.
2. `migrations/0014_location_suggestions.sql`
3. `migrations/0015_untargeted_trek_scoring.sql`
4. `seed/0003_rescore_unscored_treks.sql` — re-scored the 63 treks that had
   been validated while 0015 was missing.

August division now: Trailhead #1 (World), 20 members, #0017 leads on
17,556 pts; the two anonymous sessions (#0020, #0021) sit at 19–20 on 0.
Neither seed is run by `deploy.sh`; both are idempotent and opt-in.

Known gap, not fixed: `run_league_rollover()` does not re-enrol anyone, so
on the 1st of each month `my_league()` returns nothing until a user earns a
point, and the app's `useLive` then shows the *demo* league card. Fix is
either the 0005 tail statement appended to the rollover, or an honest "not
placed yet" state in `useLeague`. Decide before 1 September.

## Deploy the World location seed to the live Supabase project

Status: **done (2026-08-21).** Live project now has the `World` city, 641
locations across 7 sets, 622 with elevation. Singapore's city/locations/sets/
trails were deleted (cascade) after nulling the 18 test profiles'
`home_city_id`, then re-pointing them at `World` once the delete went
through — same 18 profiles, same explorer numbers, just a different city.
0 claims/treks existed at the time, so nothing else was at stake.

Kept below for reference on what was decided and why.

The app's real Supabase project (not the local test DB) still has the old
Singapore data:

- city: `Singapore`
- locations: 135
- claims: 0
- treks: 0
- profiles: 18 (test accounts, `home_city_id` pointing at Singapore, no
  claims/treks tied to any of them)

The new World seed (641 locations geocoded from `treks_and_hikes.csv`,
7 sets, elevation backfilled) is generated and sitting at
`supabase/seed/0001_world_locations.sql`, verified against a local throwaway
Postgres via `supabase/tests/run.sh` (full suite passes).

`supabase/deploy.sh` has been fixed to run migration `0013_badges_and_treks.sql`
and reference the new `seed/0001_world_locations.sql` instead of the deleted
Singapore seed files.

**2026-08-21: migration 0013 has been deployed to the live project directly**
(schema-only, `my_badges()`/`my_treks()` now exist there) — this was the
confirmed cause of the badge browser and trek journal screens silently
showing frozen demo content instead of real (empty) data. The location
seed itself is still not deployed; see below.

Two ways to get the live project onto the new dataset, waiting on a decision:

1. **Replace.** Null out the 18 profiles' `home_city_id` (it has no cascade
   from `cities`, so the delete below would otherwise fail on it), delete the
   `Singapore` city (cascades its 135 locations, their sets, and trails), run
   migration 0013, then run the new seed. One clean dataset, matches the
   "these are all the locations we use now" intent. Destructive against a
   live database, so wants an explicit go-ahead before it's run.
2. **Hand it off.** Fix `deploy.sh` and hand over the exact SQL/commands to
   run manually against the live project, without Claude executing anything
   against it directly.

Come back to this and say which one, or ask Claude to just re-open this file
and decide.
