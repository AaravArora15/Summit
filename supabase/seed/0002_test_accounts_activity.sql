-- Summit: synthetic August activity for the 18 test accounts.
--
-- NOT run by deploy.sh, and not for production users. Opt-in only:
--
--   psql "$SUPABASE_DB_URL" -f seed/0002_test_accounts_activity.sql
--
-- Why it exists: the live project has 18 test profiles (explorer numbers
-- 1-18) and, as of 2026-08-22, zero treks and zero points. The League tab
-- therefore had nothing to rank. Worse, those 18 were not even in August's
-- division: divisions are per city (leagues.city_id ... on delete cascade),
-- and deleting the Singapore city on 2026-08-21 cascaded their division
-- away. Only the two profiles created afterwards (#0020, #0021) were placed.
--
-- How it works: it does not write points directly. It inserts treks as
-- 'recording' and flips them to 'validated', which is exactly what
-- validate_trek()/claim_location() do for a real walk. The two AFTER UPDATE
-- triggers on treks then do what they always do: award_trek_activity_points()
-- (0015) writes the distance/moving-time rows into points_ledger, and
-- apply_trek_to_league() (0005) bumps the division's trek and distance
-- counters. Rank, promotion cutoff, streak and PB multipliers all come out
-- of the same code a real trek would go through; nothing here is a number
-- typed into the standings.
--
-- Idempotent: only profiles with no treks at all are touched, so a re-run is
-- a no-op, and an account that has ever recorded a real walk is never seeded.
-- Distances, durations and dates are a deterministic function of the
-- explorer number, so the same spread comes out every time.
--
-- To undo: delete from treks where user_id in (<the 18>); points_ledger rows
-- cascade on trek_id, but league_members.points/treks/distance_m do not
-- (they are counters, not views), so recompute or zero those rows after.

begin;
set local search_path = public, extensions, pg_temp;

-- 1. Re-enrol anyone who has fallen out of this month's division. Same
--    statement 0005 ran at deploy time; league_for_user() is a no-op for
--    anyone already placed, so this is safe for #0020/#0021 too.
select league_for_user(p.id)
from profiles p
where not exists (
  select 1 from league_members m
  join leagues l on l.id = m.league_id
  where m.user_id = p.id and l.period = date_trunc('month', now())::date
);

-- 2. Between one and six validated treks each, all dated inside the current
--    month and before today, so they land in this month's league.
do $$
declare
  p        record;
  i        integer;
  n        integer;
  v_dist   numeric;
  v_mins   integer;
  v_start  timestamptz;
  v_trek   uuid;
  v_month  timestamptz := date_trunc('month', now());
  v_today  integer := extract(day from now())::integer;
begin
  for p in
    select id, explorer_number
    from profiles
    where explorer_number between 1 and 18
      and not exists (select 1 from treks t where t.user_id = profiles.id)
    order by explorer_number
  loop
    n := 1 + (p.explorer_number * 7) % 6;
    for i in 1..n loop
      -- 2.5 km to 16.5 km, at 11 to 16 min/km.
      v_dist  := 2500 + ((p.explorer_number * 131 + i * 977) % 14000);
      v_mins  := round(v_dist / 1000 * (11 + (p.explorer_number + i) % 6))::integer;
      -- A morning somewhere between the 1st and yesterday.
      v_start := v_month
                 + (((p.explorer_number * 3 + i * 5) % greatest(1, v_today - 1)) * interval '1 day')
                 + interval '7 hours';

      insert into treks (user_id, started_at, ended_at, distance_m, moving_time_s, status)
      values (p.id, v_start, v_start + v_mins * interval '1 minute', v_dist, v_mins * 60, 'recording')
      returning id into v_trek;

      -- The flip is what fires the scoring and league triggers.
      update treks set status = 'validated' where id = v_trek;
    end loop;
  end loop;
end $$;

commit;
