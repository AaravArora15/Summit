#!/bin/bash
#
# Build a throwaway database and run the whole suite. Nothing here touches
# Supabase; it is all local.
#
#   ./tests/run.sh            rebuild everything and run (first time, ~30s)
#   ./tests/run.sh --fast     reuse the existing database, skip the 15MB seed
#
# Bash, not zsh: the concurrency test relies on process substitution and job
# control that behave differently under zsh.
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
cd "$(dirname "$0")/.."

PORT=5433
DB=summit_test
FAST=${1:-}

q()  { psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -v ON_ERROR_STOP=1 -q "$@"; }

# Run a file and stop if it failed. Piping psql through `grep -v NOTICE || true`
# takes grep's exit status, so a migration could error and the run would carry
# on printing "ok" and then fail confusingly ten steps later.
load() {
  local out
  if ! out=$(q -f "$1" 2>&1); then
    echo "FAILED loading $1"
    echo "$out" | grep -v NOTICE | head -20
    exit 1
  fi
}
val() { psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -tAc "$1"; }

if ! pg_isready -h 127.0.0.1 -p $PORT >/dev/null 2>&1; then
  echo "No Postgres on port $PORT. See tests/README.md for the one-time setup."
  exit 1
fi

if [ "$FAST" != "--fast" ]; then
  echo "building $DB ..."
  dropdb   -h 127.0.0.1 -p $PORT -U postgres --if-exists $DB
  createdb -h 127.0.0.1 -p $PORT -U postgres $DB
  for f in tests/00_auth_stub.sql \
           migrations/0001_init.sql migrations/0002_osm_elevation.sql migrations/0003_antispoof.sql migrations/0004_storage.sql \
           migrations/0005_identity_points_league.sql migrations/0006_read_api.sql \
           migrations/0007_explore_map.sql migrations/0008_league_rollover.sql \
           migrations/0009_set_detail.sql migrations/0010_location_points.sql \
           migrations/0011_location_elevation.sql migrations/0012_points_split.sql \
           seed/0001_singapore_locations.sql seed/0002_singapore_trails.sql seed/0003_singapore_no_go.sql; do
    load "$f"
  done
fi

load tests/10_fixtures.sql
load tests/20_try_claim.sql

echo
echo "seeded: $(val "select count(*) from locations") locations, $(val "select count(*) from trails") trails, $(val "select count(*) from no_go_areas") no-go areas"
echo

# --------------------------------------------------------------------------
echo "=== What gets refused ==="
LOC=$(val "select id from locations where slug='bukittimahhill';")

# $2 is the make_trek argument list verbatim:
#   realistic, altitude, speed_mps, flat_altitude
check() {
  local name="$1" args="$2"
  local u t
  u=$(val "select make_user('${name// /-}-$RANDOM@t');")
  t=$(val "select make_trek('$u'::uuid,'$LOC'::uuid,$args);")
  printf '  %-22s %s\n' "$name" "$(val "select try_claim('$u'::uuid,'$t'::uuid,'$LOC'::uuid);")"
}

check "honest walk"         "true,  null, 1.3, false"
check "straight-line spoof" "false, null, 1.3, false"
check "sea-level altitude"  "true,  0,    1.3, false"
check "driving pace"        "true,  null, 20,  false"
check "flat altitude"       "true,  null, 1.3, true"

U=$(val "select make_user('mock-$RANDOM@t');")
T=$(val "select make_trek('$U'::uuid,'$LOC'::uuid);")
val "update trek_points set is_mocked=true where trek_id='$T'::uuid;" >/dev/null
printf '  %-22s %s\n' "mock-location flag" "$(val "select try_claim('$U'::uuid,'$T'::uuid,'$LOC'::uuid);")"

U2=$(val "select make_user('dupe-$RANDOM@t');")
T2=$(val "select make_trek('$U2'::uuid,'$LOC'::uuid);")
val "select try_claim('$U2'::uuid,'$T2'::uuid,'$LOC'::uuid);" >/dev/null
T3=$(val "select make_trek('$U2'::uuid,'$LOC'::uuid);")
printf '  %-22s %s\n' "claiming twice" "$(val "select try_claim('$U2'::uuid,'$T3'::uuid,'$LOC'::uuid);")"

echo
echo "  signals recorded (accepted claims are scored, never rejected on it):"
val "select '    '||case when s.flagged then 'FLAG ' else 'ok   ' end||
     'straight='||coalesce(round(s.straightness::numeric,2)::text,'-')||
     ' cover='||coalesce(round(s.trail_coverage::numeric,2)::text,'-')||
     ' clip='||coalesce(round(s.clipping::numeric,2)::text,'-')||
     ' altSD='||coalesce(round(s.altitude_spread::numeric,2)::text,'-')||
     ' cadCV='||coalesce(round(s.cadence_cv::numeric,2)::text,'-')||
     coalesce(E'\n         -> '||s.flag_reason,'')
     from claim_signals s order by s.recorded_at desc limit 5;"

# --------------------------------------------------------------------------
echo
echo "=== Pioneer numbers under genuine concurrency ==="

race() {
  local slug="$1" cap="$2" n="$3" label="$4"
  local loc; loc=$(val "select id from locations where slug='$slug';")
  val "update locations set pioneer_cap=$cap, pioneer_taken=0 where id='$loc'::uuid;" >/dev/null
  val "delete from claims where location_id='$loc'::uuid;" >/dev/null
  val "drop table if exists fx; create table fx(u uuid, t uuid);" >/dev/null
  val "do \$\$ declare u uuid; t uuid; i int; begin
         for i in 1..$n loop
           u := make_user('$slug-'||i||'-$RANDOM@t');
           t := make_trek(u, '$loc'::uuid);
           insert into fx values (u,t);
         end loop; end \$\$;" >/dev/null

  # Each backend blocks on one shared advisory lock, then all are released at
  # the same instant. Without this they arrive in a queue and the test proves
  # nothing about contention.
  while read -r u t; do
    psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -tAc \
      "select pg_advisory_lock_shared(42); select try_claim('$u'::uuid,'$t'::uuid,'$loc'::uuid);" \
      >/dev/null 2>&1 &
  done < <(val "select u||' '||t from fx;")

  sleep 0.4
  val "select pg_advisory_unlock_all();" >/dev/null
  wait

  echo "  $label"
  val "select '    '||count(*)||' claims, '||
       count(pioneer_number)||' numbered ('||coalesce(min(pioneer_number)::text,'-')||'..'||
       coalesce(max(pioneer_number)::text,'-')||'), '||
       count(*) filter (where pioneer_number is null)||' explorer, '||
       (count(pioneer_number)-count(distinct pioneer_number))||' DUPLICATES'
       from claims where location_id='$loc'::uuid;"
}

race gangsahill  500 30 "30 at once, cap 500  -> expect 1..30, 0 duplicates"
race granitehill 5   12 "12 at once, cap 5    -> expect 5 numbered, 7 explorer"
echo

# --------------------------------------------------------------------------
echo
echo "=== Scoring and league placement ==="

# Runs in its own transaction and rolls back, so it can point at a real project
# as well as this throwaway one. That is the point: the scoring in 0005 is the
# piece that had never run anywhere when it was written.
#
#   psql "$SUPABASE_DB_URL" -f tests/30_points_and_league.sql
# ERROR is in the pattern deliberately. Grepping only for NOTICE meant a test
# that died on its first statement printed an empty section and the run carried
# on looking green, which is worse than having no test at all.
q -f tests/30_points_and_league.sql 2>&1 |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /'
echo
