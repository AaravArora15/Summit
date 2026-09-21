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

# Only prepend the Homebrew path when that install is actually there. On any
# other machine the Postgres client has to come from PATH, and pointing at a
# directory that does not exist would just shadow nothing.
if [ -d /opt/homebrew/opt/postgresql@17/bin ]; then
  export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
fi
cd "$(dirname "$0")/.."

# Overridable so the suite can run against a local server that is not on the
# Homebrew port. PGPORT/PGDATABASE are the standard names, so a machine with
# Postgres already configured needs no edit here at all.
PORT="${PGPORT:-5433}"
DB="${PGDATABASE:-summit_test}"
FAST=${1:-}

# ---------------------------------------------------------------------------
# Per-suite accounting
# ---------------------------------------------------------------------------
#
# Every suite below runs through this. Two things it must not do:
#
#  1. Let one failing suite end the run. It used to: a suite that raises an
#     exception exits psql 3, and with `set -e` + pipefail that killed the
#     runner mid-list, so 120_territories and 130_league_rollover never ran at
#     all while the output still looked like a complete run.
#  2. Report success for a suite that never executed. The count below is the
#     evidence; "all N suites passed" is only printed when N is the number of
#     files actually run.
#
# The EXIT trap prints the summary even when the run stops early, so a partial
# run can never be mistaken for a green one.
SUITES_RUN=0
SUITES_FAILED=0
SUITE_NAMES=()

report_suites() {
  if [ "${SUITES_RUN:-0}" -eq 0 ]; then
    return 0
  fi
  local total
  total=${#SUITE_NAMES[@]}
  echo
  echo "=== Suite summary ==="
  echo "  ran $SUITES_RUN of $total suites, $SUITES_FAILED problem(s) reported"
  if [ "$SUITES_FAILED" -gt 0 ]; then
    echo "  FAILED: see the FAIL line(s) above"
    return 1
  fi
  echo "  all $total suites passed"
  return 0
}

trap 'report_suites || exit 1' EXIT

q()  { psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -w -v ON_ERROR_STOP=1 -q "$@"; }

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
val() { psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -w -tAc "$1" | tr -d '\r'; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
#
# Every client call below passes -w, and this block runs before anything
# destructive. That is deliberate: psql, dropdb and createdb all sit on a
# password prompt forever when the server asks for one and stdin is a terminal,
# which is indistinguishable from a slow test run -- the first symptom here was
# a 120-second hang with an orphaned dropdb left behind. Each of the five things
# that can be wrong is named instead, so the message alone says what to fix.

die() { printf '\n%s\n\n' "$1" >&2; exit 1; }

if ! command -v psql >/dev/null 2>&1; then
  die "psql is not on PATH.
  Add the PostgreSQL bin directory, e.g. on Windows / Git Bash:
    export PATH=\"/c/Program Files/PostgreSQL/18/bin:\$PATH\""
fi

if ! command -v pg_isready >/dev/null 2>&1; then
  die "pg_isready is not on PATH (it ships alongside psql)."
fi

if ! pg_isready -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1; then
  die "No PostgreSQL is accepting connections on 127.0.0.1:$PORT.
  Start the server, or point PGPORT at the port it is actually on.
  See tests/README.md for the one-time setup."
fi

# -w so a missing password is reported rather than waited on.
probe() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -w -tAc "$1" 2>&1; }

if ! auth_out=$(probe 'select 1'); then
  case "$auth_out" in
    *"no password supplied"*)
      die "PostgreSQL on :$PORT requires a password and none was supplied.
  Supply it for this shell without putting it in the repo, e.g.:
    export PGPASSWORD=...        # or add an entry to your pgpass file
  The suite deliberately never prompts, so a missing password cannot look
  like a hang." ;;
    *"password authentication failed"*)
      die "PostgreSQL rejected the credentials for user \"postgres\" on :$PORT." ;;
    *)
      die "Cannot connect to PostgreSQL on :$PORT:
  $auth_out" ;;
  esac
fi

# PostGIS is not optional: 0001_init.sql creates the extension and every
# spatial read and check depends on it. Checked up front because otherwise the
# failure surfaces ~40 statements into the first migration, as
# `type "geography" does not exist`.
server_version=$(probe 'show server_version')
if [ "$(probe "select count(*) from pg_available_extensions where name = 'postgis'")" != "1" ]; then
  die "PostGIS is not installed for PostgreSQL $server_version on :$PORT.
  Install the PostGIS build matching that major version, then re-run.
  The suite cannot run without it: 0001_init.sql creates the extension and
  every spatial query uses geography(Point,4326) and ST_DWithin."
fi

if [ "$FAST" != "--fast" ]; then
  echo "building $DB ..."
  dropdb   -h 127.0.0.1 -p $PORT -U postgres -w --if-exists $DB
  createdb -h 127.0.0.1 -p $PORT -U postgres -w $DB
  for f in tests/00_auth_stub.sql \
           migrations/0001_init.sql migrations/0002_osm_elevation.sql migrations/0003_antispoof.sql migrations/0004_storage.sql \
           migrations/0005_identity_points_league.sql migrations/0006_read_api.sql \
           migrations/0007_explore_map.sql migrations/0008_league_rollover.sql \
           migrations/0009_set_detail.sql migrations/0010_location_points.sql \
           migrations/0011_location_elevation.sql migrations/0012_points_split.sql \
           migrations/0013_badges_and_treks.sql \
           migrations/0014_location_suggestions.sql \
           migrations/0015_untargeted_trek_scoring.sql \
           migrations/0016_groups.sql \
           migrations/0017_rename.sql \
           migrations/0018_speed_window.sql \
           migrations/0019_raise_pioneer_cap.sql \
           migrations/0020_location_status_note.sql \
           migrations/0021_claim_points_breakdown.sql \
           migrations/0022_titles_and_review.sql \
           migrations/0023_badge_run_stats.sql \
           migrations/0024_daily_wildcard.sql \
           migrations/0025_territories.sql \
           migrations/0026_wildcard_same_country.sql \
           migrations/0027_league_rollover_reenroll.sql \
           migrations/0028_revert_pioneer_cap.sql \
           migrations/0029_territory_map_data.sql \
           migrations/0030_groups_leave_delete_kick.sql \
           seed/0001_world_locations.sql \
           seed/0004_territories.sql \
           seed/0005_macritchie_signage.sql \
           seed/0006_location_country_codes.sql; do
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
LOC=$(val "select id from locations where slug='everestbasecamptrek';")

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
    psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -w -tAc \
      "select pg_advisory_lock_shared(42); select try_claim('$u'::uuid,'$t'::uuid,'$loc'::uuid);" \
      >/dev/null 2>&1 &
  done < <(val "select u||' '||t from fx;")

  sleep 0.4
  val "select pg_advisory_unlock_all();" >/dev/null
  wait

  # These jobs are the entire point of the test, so "nothing landed" is a
  # failure, never a result. It used to print "0 claims, 0 numbered ... 0
  # DUPLICATES" and carry on looking green: psql writes CRLF on Windows, so
  # `read -r u t` left a trailing \r on the last field of every row and each
  # '$t'::uuid cast in the loop above died with "invalid input syntax for type
  # uuid" into /dev/null. The test ran, proved nothing, and said so only in
  # digits nobody was checking.
  #
  # (The advisory lock above is inert for the same reason it is easy to miss:
  # nothing in the schema ever takes key 42, so these backends never actually
  # contend on it. They do contend on the location row inside claim_location(),
  # which is what this asserts.)
  local n_jobs n_claims
  n_jobs=$(val "select count(*) from fx;")
  n_claims=$(val "select count(*) from claims where location_id='$loc'::uuid;")
  if [ "${n_claims:-0}" != "${n_jobs:-0}" ]; then
    echo "  FAIL $label: $n_claims of $n_jobs concurrent claims landed"
    SUITES_FAILED=$((SUITES_FAILED+1))
  fi

  echo "  $label"
  val "select '    '||count(*)||' claims, '||
       count(pioneer_number)||' numbered ('||coalesce(min(pioneer_number)::text,'-')||'..'||
       coalesce(max(pioneer_number)::text,'-')||'), '||
       count(*) filter (where pioneer_number is null)||' explorer, '||
       (count(pioneer_number)-count(distinct pioneer_number))||' DUPLICATES'
       from claims where location_id='$loc'::uuid;"
}

race annapurnacircuit 500 30 "30 at once, cap 500  -> expect 1..30, 0 duplicates"
race threepassestrek  5   12 "12 at once, cap 5    -> expect 5 numbered, 7 explorer"
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
SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Scoring and league"); suite_out=$(q -f tests/30_points_and_league.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

# --------------------------------------------------------------------------
echo
echo "=== Groups ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Groups"); suite_out=$(q -f tests/40_groups.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Groups: leave, delete, kick ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Groups lifecycle"); suite_out=$(q -f tests/45_groups_lifecycle.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

# --------------------------------------------------------------------------
echo
echo "=== Renaming ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Renaming"); suite_out=$(q -f tests/50_rename.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Speed gating ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Speed gating"); suite_out=$(q -f tests/60_speed.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Location status ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Location status"); suite_out=$(q -f tests/70_location_status.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Claim points breakdown ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Claim points breakdown"); suite_out=$(q -f tests/80_claim_points_breakdown.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Titles and suggestion review ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Titles and review"); suite_out=$(q -f tests/90_titles_and_review.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Badge run stats ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Badge run stats"); suite_out=$(q -f tests/100_claim_run_stats.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Wildcard ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Wildcard"); suite_out=$(q -f tests/110_wildcard.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== Capture Territory ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("Territories"); suite_out=$(q -f tests/120_territories.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo

echo "=== League rollover re-enrollment ==="

SUITES_RUN=$((SUITES_RUN+1)); SUITE_NAMES+=("League rollover"); suite_out=$(q -f tests/130_league_rollover.sql 2>&1) || SUITES_FAILED=$((SUITES_FAILED+1)); printf '%s\n' "$suite_out" |
  grep -E "NOTICE:|ERROR:|FAIL" |
  sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /  /' || true
echo
