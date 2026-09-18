-- Summit: "what was that run like?" behind a held badge.
--
-- The badge browser only ever showed a shield and a name; tapping one now
-- opens it full-screen with the walk behind it — time, distance, pace.
-- my_badges() already returns claim_id, which is all the new read API needs:
-- claim_run_stats(p_claim_id) walks claims -> treks the same way my_treks()
-- (0013) already does.
--
-- Two cases never carry a genuine walked track, and both must say so rather
-- than show fabricated numbers as if they were real:
--   - a claim with no trek at all (trek_id null, or its row since deleted —
--     both column-permit this today);
--   - a claim made through the __DEV__-only fake-claim shortcut
--     (dev-fake-claim.ts), which parks every GPS point on the pin and
--     uploads a fixed 120 m / 55 s so the reward flow has something to
--     validate. That number is real in the sense that it went through
--     claim_location() honestly, but it is not a hike, so it should not be
--     shown as one. is_dev_fake marks exactly those treks.
--
-- For both, the client falls back to a generic estimate built from the
-- location's own distance_m/avg_time_min/difficulty (returned alongside so
-- the client can compute it — see features/trek/run-stats.ts) rather than
-- this function guessing a number itself: the same "raw data down, display
-- logic in the client" split every other read API here already keeps.

begin;
set local search_path = public, extensions, pg_temp;

alter table treks add column if not exists is_dev_fake boolean not null default false;

create or replace function claim_run_stats(p_claim_id uuid)
returns table (
  claimed_at             timestamptz,
  distance_m             numeric,
  moving_time_s          integer,
  location_distance_m    integer,
  location_avg_time_min  integer,
  difficulty             smallint
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with base as (
    select
      c.claimed_at,
      t.id as trek_id,
      coalesce(t.is_dev_fake, false) as is_dev_fake,
      t.distance_m as trek_distance_m,
      t.moving_time_s as trek_moving_time_s,
      l.distance_m as location_distance_m,
      l.avg_time_min as location_avg_time_min,
      l.difficulty
    from claims c
    join locations l on l.id = c.location_id
    left join treks t on t.id = c.trek_id
    where c.id = p_claim_id
      and c.user_id = auth.uid()
  )
  select
    claimed_at,
    case when trek_id is not null and not is_dev_fake
           and trek_distance_m is not null and trek_moving_time_s is not null
         then trek_distance_m end,
    case when trek_id is not null and not is_dev_fake
           and trek_distance_m is not null and trek_moving_time_s is not null
         then trek_moving_time_s end,
    location_distance_m,
    location_avg_time_min,
    difficulty
  from base;
$$;

revoke all on function claim_run_stats(uuid) from public;
grant execute on function claim_run_stats(uuid) to authenticated;

commit;
