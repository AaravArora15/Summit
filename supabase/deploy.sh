#!/bin/bash
#
# Apply the schema and seed to a Supabase project.
#
#   ./deploy.sh "postgresql://postgres.abcd:PASSWORD@aws-0-...pooler.supabase.com:6543/postgres"
#   ./deploy.sh "$SUPABASE_DB_URL" --schema-only     # skip the 54MB of seed data
#
# Any connection string works: direct, session pooler or transaction pooler.
# Every migration and seed file is a single transaction that sets its own
# search_path with `set local`, so none of them depend on session state
# surviving between statements.
#
# Which one you can actually use depends on your network. Supabase's direct
# connection (db.<ref>.supabase.co) is IPv6-only on the free tier, so on an
# IPv4-only network it fails with "network is unreachable" and the pooler is the
# only option. The preflight below tells you which case you are in.
#
# Re-running is safe: it fails closed rather than corrupting anything. Migrations
# 0004 onward and every seed file are re-appliable, so a run that died on a
# flaky connection can simply be repeated. 0001-0003 use bare `create table`
# and will stop at "relation already exists" on a database that has them --
# that check happens before any write, so nothing is half-applied, but the
# recovery is to run the remaining files by hand. See SETUP.md.
set -euo pipefail

cd "$(dirname "$0")"

# The connection string carries a live database password. Prefer reading it
# from an untracked file so it never has to be pasted into a terminal that
# someone else may be reading, or into shell history.
#
#   echo 'SUPABASE_DB_URL=postgresql://...' > .env.deploy
#   ./deploy.sh
#
# An explicit argument still wins, for one-off use.
if [ -f .env.deploy ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env.deploy; set +a
fi

DB_URL="${1:-${SUPABASE_DB_URL:-}}"
MODE="${2:-}"

if [ -z "$DB_URL" ]; then
  cat <<'USAGE'
usage: ./deploy.sh [connection-string] [--schema-only]

No connection string given and no .env.deploy found. Create one:

  cd supabase
  echo 'SUPABASE_DB_URL=postgresql://postgres.REF:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres' > .env.deploy
  ./deploy.sh

Get the string from the Supabase dashboard -> Connect. Use a
*.pooler.supabase.com host: the direct db.<ref>.supabase.co host is IPv6-only
and this machine has no IPv6 route.
USAGE
  exit 1
fi
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

run() {
  local file="$1" label="$2"
  printf '  %-42s' "$label"
  local out
  if out=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$file" 2>&1); then
    echo "ok"
  else
    echo "FAILED"
    echo "$out" | grep -v NOTICE | head -20
    exit 1
  fi
}

echo "checking connection..."
if ! psql "$DB_URL" -tAc "select 'connected to ' || current_database();" 2>/tmp/summit-conn.err | sed 's/^/  /'; then
  echo
  echo "could not connect. What the error usually means:"
  echo
  if grep -qi "unreachable\|no route to host\|could not translate" /tmp/summit-conn.err; then
    host=$(printf '%s' "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
    echo "  Cannot reach $host."
    if printf '%s' "$host" | grep -q "^db\."; then
      echo "  This is the DIRECT connection host, which is IPv6-only on the free tier."
      if ! curl -s -m 6 -6 -o /dev/null https://ipv6.google.com 2>/dev/null; then
        echo "  This machine has no IPv6 route, so direct will never work from here."
        echo "  Use the pooler string instead: Connect -> the *.pooler.supabase.com host."
      fi
    fi
  else
    sed 's/^/  /' /tmp/summit-conn.err | head -5
  fi
  exit 1
fi

echo
echo "schema:"
run migrations/0001_init.sql        "0001 core tables + pioneer allocation"
run migrations/0002_osm_elevation.sql "0002 OSM, elevation, claim signals"
run migrations/0003_antispoof.sql   "0003 no-go areas, behavioural signals"
run migrations/0004_storage.sql     "0004 claim photo bucket"
run migrations/0005_identity_points_league.sql "0005 profiles, points, league"
run migrations/0006_read_api.sql    "0006 read API for the tabs"
run migrations/0007_explore_map.sql "0007 map coordinates + claimed flag"
run migrations/0008_league_rollover.sql "0008 monthly promotion/relegation"
run migrations/0009_set_detail.sql "0009 set detail screen"
run migrations/0010_location_points.sql "0010 points earned, per claim"
run migrations/0011_location_elevation.sql "0011 elevation on locations_near()"
run migrations/0012_points_split.sql "0012 XP / Monthly points split"

if [ "$MODE" != "--schema-only" ]; then
  echo
  echo "seed (this is ~54MB, allow a few minutes):"
  run seed/0001_singapore_locations.sql "0001 163 locations"
  run seed/0002_singapore_trails.sql    "0002 81k trail ways"
  run seed/0003_singapore_no_go.sql     "0003 127k building/water polygons"
fi

echo
echo "verifying:"
psql "$DB_URL" -tAc "
select
  '  locations      ' || (select count(*) from locations) || E'\n' ||
  '  trails         ' || (select count(*) from trails) || E'\n' ||
  '  no-go areas    ' || (select count(*) from no_go_areas) || E'\n' ||
  '  sets           ' || (select count(*) from location_sets) || E'\n' ||
  '  profiles       ' || (select count(*) from profiles) || ' of '
                      || (select count(*) from auth.users) || ' auth users' || E'\n' ||
  '  league tiers   ' || (select count(*) from league_tiers) || E'\n' ||
  '  RLS enabled on ' || (select count(*) from pg_tables t
                          join pg_class c on c.relname = t.tablename
                          where t.schemaname = 'public' and c.relrowsecurity) || ' tables' || E'\n' ||
  '  database size  ' || pg_size_pretty(pg_database_size(current_database()));"

echo
echo "done. Remaining manual step: enable anonymous sign-ins."
echo "  Dashboard -> Authentication -> Sign In / Providers -> Anonymous sign-ins -> on"
echo "  Without it the app's 'Start walking' button fails with a generic error."
