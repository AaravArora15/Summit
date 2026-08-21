# Setting up the Supabase project

Everything in `migrations/` and `seed/` has been verified against a local
Postgres configured to match Supabase's layout, but has never run against
Supabase itself. This is the list of what to do, in order.

Budget about 20 minutes, most of it waiting on the seed upload.

---

## 1. Create the project

<https://supabase.com/dashboard> → **New project**.

| Field | Value | Why |
|---|---|---|
| Region | **Southeast Asia (Singapore)** | Every seeded location is in Singapore. A US region adds ~200 ms to every spatial query for no benefit. This cannot be changed later without recreating the project. |
| Database password | generate one, save it | Needed for the connection string in step 3. It is not recoverable, only resettable. |
| Plan | Free | The full seed is **84 MB** against a 500 MB limit, measured locally. It fits. |

## 2. Enable PostGIS

Dashboard → **Database** → **Extensions** → search `postgis` → enable.

It installs into a schema called `extensions`, not `public`. This matters more
than it sounds: `geography` and `st_dwithin` are then not resolvable by default,
and every migration here carries `set search_path = public, extensions` because
of it. An earlier version did not, and failed on the very first table with
`type "geography" does not exist`.

`migrations/0001_init.sql` will also create the extension itself if you skip
this step, so it is belt and braces.

## 3. Get the connection string

Dashboard → **Connect** (top bar).

Newer projects show **Direct connection** prominently; the pooler strings are
under the same dialog, sometimes behind a dropdown or further down the page.
Either works — every migration and seed file here is a single transaction that
sets its own `search_path` with `set local`, so none of them depend on session
state surviving between statements.

Which one you can actually use depends on your network:

| String | Host | Network |
|---|---|---|
| Direct connection | `db.<ref>.supabase.co` | **IPv6 only** on the free tier |
| Transaction pooler | `*.pooler.supabase.com:6543` | IPv4, works everywhere |
| Session pooler | `*.pooler.supabase.com:5432` | IPv4, if your project offers it |

**This machine has no IPv6 route** (checked: no global IPv6 address, and
`ipv6.google.com` is unreachable). So the direct connection will fail here with
"network is unreachable" no matter what else is correct. Use a
`*.pooler.supabase.com` string.

If you only see the direct string in the dialog, the pooler host follows a fixed
shape you can also read off the dashboard's connection settings:

```
postgresql://postgres.<project-ref>:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Note the username is `postgres.<project-ref>` for the pooler, not plain
`postgres` as it is for the direct connection. Getting that wrong gives an
authentication failure that looks like a wrong password.

`deploy.sh` runs a preflight and, if it cannot connect, tells you which of these
cases you are in rather than passing the raw error through.

## 4. Apply schema and seed

Do **not** paste the seed files into the dashboard SQL editor. `seed/0003` is
39 MB and the editor will not take it.

```bash
cd supabase
./deploy.sh "postgresql://postgres.abcd:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
```

If it dies halfway on a flaky connection, re-run it: the seed files and
migrations 0004 onward are written to be re-appliable (`if not exists`, `on
conflict do nothing`, `create or replace`, `drop policy if exists`).

`0001` through `0003` are **not**. They use bare `create table` and `create
type`, so on a database that already has them the run stops at
`relation "cities" already exists`. That is safe — it fails before changing
anything — but it means the recovery for a half-applied deploy is to run the
remaining files by hand rather than to re-run the script. Worth fixing with a
`schema_migrations` ledger before a second environment exists.

It prints a verification summary at the end:

```
  locations      163
  trails         81369
  no-go areas    127317
  sets           6
  profiles       5 of 5 auth users
  league tiers   5
  RLS enabled on 14 tables
  database size  83 MB
```

`profiles` and `auth users` must match. They are kept in step by the
`on_auth_user_created` trigger from migration 0005; if the counts diverge,
someone signed up while that trigger was missing and the backfill at the end of
0005 will fix it on the next run.

Schema only, if you want to iterate before committing to the 54 MB upload:

```bash
./deploy.sh "$DB_URL" --schema-only
```

## 5. Turn on anonymous sign-ins

Dashboard → **Authentication** → **Sign In / Providers** → **Anonymous
sign-ins** → enable.

This is off by default and it is the step most likely to be missed. The app's
only entry point is "Start walking", which calls `signInAnonymously()`, and the
error Supabase returns when this is disabled is generic enough to send you
looking in the wrong place. See `src/features/auth/session.ts` for why the app
uses anonymous sessions rather than an account wall.

## 6. Point the app at it

Dashboard → **Project Settings** → **API**.

```bash
cd summit
cp .env.example .env
```

Fill in:

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

The anon key belongs in the bundle. It identifies the project and grants
nothing on its own; RLS is what protects the data, and every table has it. Do
**not** put the `service_role` key here, which bypasses RLS entirely.

Restart the dev server after writing `.env`. Expo inlines `EXPO_PUBLIC_*` at
bundle time, so a running server will not pick it up.

## 7. Check it worked

```bash
psql "$DB_URL" -c "select name, rarity, elevation_m from locations order by elevation_m desc nulls last limit 5;"
```

Bukit Timah Hill should be top at 179 m. (The official summit is 163.6 m; SRTM
is a surface model and reads the canopy. The tolerance in `claim_location()` is
sized for exactly that.)

Then start the app. You should land on the sign-in gate rather than the tabs,
and "Start walking" should drop you into Home.

---

## Still to do after this

These are not part of project setup but are the next blockers.

- **EAS dev build.** `eas.json` now exists (development/preview/production
  profiles) but no build has ever run: that needs an interactive `eas login`,
  which nothing automated can do. Once logged in:
  `cd summit && npx eas build --profile development --platform ios`. This is
  the one that blocks everything else: the scoring in migration 0005 and the
  secret-spot photo flow in `trek/arrival.tsx` have never run against a real
  claim, because a real claim needs a real walk.
- **Photo capture for secret spots**, done. `trek/arrival.tsx` asks for a
  camera (or library) photo before syncing whenever the target is secret, and
  `sync.ts` uploads it to the `claim-photos` bucket once the trek row exists.
  Untested against a real claim for the same reason as the dev build above.
- **Apple / Google providers.** `attachIdentity()` is written and uses
  `linkIdentity` so a guest's pioneer numbers carry over, but neither provider
  is configured. Anonymous sessions live only in app storage, so until this is
  done, deleting the app destroys the numbers on it.
- **Crew and private groups.** Two of the three segments on the League tab are
  still placeholder. Unlike the league, neither is a query over existing data:
  both need membership tables and an invite flow.
- **Monthly rollover**, done. `run_league_rollover()` in migration 0008
  promotes the top eight and relegates the bottom eight into
  `profiles.league_tier`, computed from each division's own frozen `tier`
  column rather than from the column it writes, so a second run of the same
  period is a no-op instead of a double-promotion (verified: `tests/run.sh`
  does not exercise this one directly, but it was run against the live
  project inside a rolled-back transaction and confirmed idempotent). A
  `pg_cron` job (`summit-league-rollover`) calls it at 00:10 UTC on the 1st.
  pg_cron is unavailable on a local Postgres, so 0008 skips the schedule step
  there and only enables it where it exists — Supabase has it already
  enabled, unlike PostGIS, so this needed no dashboard step.

## Things that will bite you

- **Anonymous users accumulate.** Every "Start walking" on a fresh install is a
  new row in `auth.users`. Supabase does not clean them up. Worth a scheduled
  delete of anonymous users older than 30 days with no claims, before it becomes
  a large table of nothing.
- **The seed is not idempotent across regenerations.** `seed-osm.mjs` re-queries
  live OSM, so re-running it produces different `osm_id` sets as the map
  changes. `on conflict (slug) do nothing` protects existing rows, but a
  renamed OSM feature will insert as a second location. Regenerate deliberately.
- **`supabase/` is not in version control.** It sits outside the `summit/` git
  repo and the parent directory is not a repo at all. The migrations, the 54 MB
  seed and these scripts are currently unprotected.
