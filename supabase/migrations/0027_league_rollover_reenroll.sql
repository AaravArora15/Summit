-- run_league_rollover() computed promotions/relegations and updated
-- profiles.league_tier, but never actually enrolled anyone in the new
-- month's league — that only happened lazily, the next time a user's points
-- or trek landed via apply_points_to_league()/apply_trek_to_league(). Until
-- then my_league() finds no league_members row for the new period and
-- returns nothing, which the app reads as "not placed" and falls back to
-- showing demo league data. See pending.md, "known gap" under the
-- 2026-08-22 entry.
--
-- Fix: after moving tiers, re-enroll everyone who was in last period's
-- leagues into the new period's league at 0 points/treks/distance, via the
-- same league_for_user() every other enrollment path already goes through
-- (so division-filling stays the one place that logic lives). Reuses
-- profiles.league_tier, which the update above just set, so a promoted or
-- relegated user lands in their new tier immediately rather than their old
-- one.
create or replace function run_league_rollover(p_period date default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_promote_top     constant integer := 8;   -- matches promotion_cutoff in my_league()
  c_relegate_bottom constant integer := 8;   -- matches relegation_cutoff's width
  c_xp_league_top   constant integer := 120;

  v_period     date := coalesce(p_period, (date_trunc('month', now()) - interval '1 month')::date);
  v_new_period date := (v_period + interval '1 month')::date;
  v_min_order  integer;
  v_max_order  integer;
  v_updated    integer;
  rec          record;
begin
  select min(sort_order), max(sort_order) into v_min_order, v_max_order from league_tiers;

  -- The bonus, first: read-only against league_members, so it does not
  -- interact with the tier update below. Guarded against a second run of the
  -- same period by checking whether this user already got one this calendar
  -- month (the job runs once, at the start of the month after `v_period`).
  insert into points_ledger (user_id, source, system, amount, awarded_at)
  select lm.user_id, 'league_top', 'xp', c_xp_league_top, now()
  from league_members lm
  join leagues l on l.id = lm.league_id
  where l.period = v_period
    and lm.points > 0
    and lm.points = (
      select max(lm2.points) from league_members lm2 where lm2.league_id = l.id
    )
    and not exists (
      select 1 from points_ledger pl
      where pl.user_id = lm.user_id and pl.source = 'league_top'
        and date_trunc('month', pl.awarded_at) = date_trunc('month', now())
    );

  with ranked as (
    select
      lm.user_id,
      l.tier,
      row_number() over (partition by l.id order by lm.points desc, lm.joined_at, lm.user_id) as rnk,
      count(*) over (partition by l.id) as division_size
    from league_members lm
    join leagues l on l.id = lm.league_id
    where l.period = v_period
  ),
  delta as (
    select
      r.user_id,
      t.sort_order + (case
        when r.rnk <= c_promote_top then 1
        when r.division_size > c_promote_top
             and r.rnk > r.division_size - c_relegate_bottom then -1
        else 0
      end) as target_order
    from ranked r
    join league_tiers t on t.key = r.tier
  ),
  clamped as (
    select user_id, least(greatest(target_order, v_min_order), v_max_order) as target_order
    from delta
  ),
  transitions as (
    select c.user_id, nt.key as new_tier
    from clamped c
    join league_tiers nt on nt.sort_order = c.target_order
  )
  update profiles p
     set league_tier = t.new_tier
    from transitions t
   where p.id = t.user_id
     and p.league_tier is distinct from t.new_tier;

  get diagnostics v_updated = row_count;

  -- Carry every user active last period into the new one, at 0 points, in
  -- whatever tier they now sit in. Idempotent (league_for_user no-ops if
  -- they're already enrolled) and safe to re-run for the same period.
  for rec in
    select distinct lm.user_id
    from league_members lm
    join leagues l on l.id = lm.league_id
    where l.period = v_period
      and not exists (
        select 1
        from league_members lm2
        join leagues l2 on l2.id = lm2.league_id
        where l2.period = v_new_period and lm2.user_id = lm.user_id
      )
  loop
    perform league_for_user(rec.user_id, v_new_period);
  end loop;

  return v_updated;
end;
$$;

revoke all on function run_league_rollover(date) from public;
