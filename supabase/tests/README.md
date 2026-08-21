# Schema tests

These run against a throwaway local Postgres, not against the Supabase project.
Supabase is not required, and nothing here should ever be pointed at it.

## Why local rather than a hosted branch

The thing most worth testing is the pioneer number allocation under genuine
concurrency, and that needs many backends hitting one row at the same instant.
A local instance makes that cheap and repeatable.

## Setup

PostGIS must be built for the same major version as the server you run.

```bash
brew install postgresql@17 postgis
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

initdb -D /tmp/summitpg -U postgres
mkdir -p /tmp/sgpg
pg_ctl -D /tmp/summitpg -o "-p 5433 -k /tmp/sgpg -c listen_addresses=127.0.0.1" -l /tmp/summitpg.log start
```

Note the short socket directory. A Unix socket path is capped at 103 bytes and
a data directory nested a few levels deep will exceed it.

## Build the database

From the `supabase/` directory:

```bash
createdb -h 127.0.0.1 -p 5433 -U postgres summit_test

# A shell function, not a PSQL="..." variable: zsh does not word-split an
# unquoted variable the way bash does, so the variable form fails outright
# under the default macOS shell.
q() { psql -h 127.0.0.1 -p 5433 -U postgres -d summit_test -v ON_ERROR_STOP=1 -q "$@"; }

q -c 'create extension postgis; create extension pgcrypto;'
q -f tests/00_auth_stub.sql          # stands in for Supabase's auth schema
q -f migrations/0001_init.sql
q -f migrations/0002_osm_elevation.sql
q -f seed/0001_singapore_locations.sql
q -f seed/0002_singapore_trails.sql
q -f tests/10_fixtures.sql
q -f tests/20_try_claim.sql
```

## What the fixtures give you

`make_trek(user, location, realistic, altitude, speed)` builds a synthetic
track. With `realistic => true` it walks the 600 m of real OSM trail that ends
nearest the location; with `false` it draws a straight line, which is the shape
a naive spoofer produces.

Timestamps come from the actual distance between consecutive fixes. An earlier
version spaced them evenly in time on a 600 m assumption, so wherever the
nearest trail ran for kilometres the fixture "walked" at 20 m/s and every claim
was rejected for implausible speed. A fixture has to be plausible before it can
test anything else.

`try_claim(user, trek, location)` sets the caller identity and returns either
`ACCEPTED ...` or `rejected <message>`, so a whole matrix runs without the
first failure aborting the rest.

## Verified so far

Both of these were run and passed:

- **Allocation under concurrency.** 30 simultaneous claims on one location, all
  released from a shared advisory latch so they genuinely collide, produced 30
  distinct numbers 1..30 with zero duplicates. 12 simultaneous claims against a
  cap of 5 produced exactly 5 pioneers and 7 Explorer editions.
- **Rejections.** Mock-location flag, implausible speed, sea-level altitude at a
  179 m hill, and a duplicate claim are each refused, with readable messages.

## What each signal was measured to be worth

Every geometric check was measured across 40 locations, honest track versus
straight-line spoof, before being given any authority.

| Signal | Honest | Spoof | Verdict |
|---|---|---|---|
| Trail coverage | med 1.000 | med 0.471, max 0.886 | Useless here. Ranges overlap almost entirely: Singapore is so densely footpathed that a straight line is nearly always within 25 m of something. |
| Straightness | med 0.263, max 0.900 | 0.891 | Separates well in the middle, tails touch. Flags. |
| Clipping (path-aware) | med 0.000 | med 0.061 | Best of the three. Still only catches 6/40 spoofs at a 1/40 honest cost. Flags. |

The path exemption on clipping is what makes it usable. Measured without it,
12.5% of honest tracks "crossed water" (boardwalks and causeways over
reservoirs) and 45% "crossed buildings" (sheltered linkways, malls, MRT
concourses). A bridge is a path over water and a linkway is a path through a
building; both are mapped, so requiring the leg to be off-path too removes the
whole false-positive class.

**No geometric signal earned the right to reject.** Rejection is reserved for
things that are categorical rather than statistical: the Android mock-location
flag, speeds no walker reaches, no dwell at the place, a track too short to be a
walk, a duplicate claim, and a per-user rate limit.

## A signal that was built and removed

A pedometer cross-check lived here briefly. The step counter is a different
sensor from GPS, so a fabricated location feed does not move it, which would
have made "5 km covered, 0 steps" categorical rather than a threshold
judgement, the one property every geometric check above lacks.

It came out because it could not reject anyway. A cyclist produces the same
reading, as does a wheelchair user, so without a declared activity type it
cannot tell a spoofer from someone who rode the trail. And it does not work the
same on both platforms: `getStepCountAsync` is iOS-only, while Android's live
watch stops when the screen locks, which is most of a real trek. That is a
permanent platform split and a native dependency bought for one extra flag.

Worth revisiting once treks declare an activity type, when it could be a hard
reject for declared walks.

## Known gap

Every "honest" track here is synthetic. The soft signals in `claim_signals`
(trail coverage, straightness) cannot be calibrated against fixtures without
measuring my own assumptions, which is exactly why `claim_location()` records
them and rejects on none of them. Calibrate against real tracks before turning
either into a rejection.
