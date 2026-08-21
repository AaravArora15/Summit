-- Summit: the monthly promotion/relegation job.
--
-- `leagues` is keyed by period, so a new month's divisions form themselves the
-- first time anyone in that tier earns a point (see league_for_user() in
-- 0005). What was still missing is the other half: moving people BETWEEN
-- tiers when a month ends. Until this ran, everyone stayed in Trailhead
-- forever, since profiles.league_tier only ever had one write path, the
-- column default.
--
-- Idempotency is the whole design constraint here. The job is scheduled, so it
-- WILL eventually run twice on the same period, whether from a manual replay,
-- a Supabase maintenance window, or someone rerunning this migration. The new
-- tier is therefore computed only from `leagues.tier` - the division's own
-- tier for that period, frozen at the time the division was created - never
-- from `profiles.league_tier`, which is the column this function writes. Read
-- from the fact that cannot change; write to the fact that can. A version that
-- read the destination column would double-promote on a second run.
begin;
set local search_path = public, extensions;

create or replace function run_league_rollover(p_period date default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_promote_top    constant integer := 8;   -- matches promotion_cutoff in my_league()
  c_relegate_bottom constant integer := 8;  -- matches relegation_cutoff's width

  -- Defaults to "the month that just ended". Scheduled for 00:10 on the 1st,
  -- so `now()` is already the new month by the time this runs.
  v_period    date := coalesce(p_period, (date_trunc('month', now()) - interval '1 month')::date);
  v_min_order integer;
  v_max_order integer;
  v_updated   integer;
begin
  select min(sort_order), max(sort_order) into v_min_order, v_max_order from league_tiers;

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
  -- +1 tier for the top 8, -1 for the bottom 8, unchanged otherwise. A
  -- division that never reached 9 members has no bottom 8 distinct from its
  -- top 8, so nobody in it relegates - the same "boundary outside the
  -- division" rule the League screen itself applies (see explore.tsx's
  -- sibling ZoneRule guard, or league.tsx's).
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
    -- Summit has nowhere to promote to; Trailhead has nowhere to relegate to.
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
  return v_updated;
end;
$$;

-- Not exposed to PostgREST: no grant to authenticated or anon, so this is
-- reachable only by whatever runs it directly (the cron job below, or a
-- manual call from the SQL editor), never by a client RPC.
revoke all on function run_league_rollover(date) from public;

-- Runs at 00:10 UTC on the 1st of every month, ten minutes after the new
-- period would otherwise start forming its own divisions. `cron.schedule`
-- upserts on job name, so re-running this migration edits the existing job
-- rather than creating a duplicate.
--
-- Guarded the same way 0004_storage.sql guards its `storage` schema check:
-- pg_cron is a compiled extension that a local Postgres will not have, so
-- this skips rather than fails the whole migration set locally. On Supabase
-- it is available; enabling it here (rather than requiring a dashboard toggle
-- like PostGIS or anonymous sign-ins) is safe because, unlike those, nothing
-- about pg_cron needs a decision from whoever runs this deploy.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available (local Postgres); skipping the rollover schedule';
    return;
  end if;

  create extension if not exists pg_cron with schema extensions;

  perform cron.schedule(
    'summit-league-rollover',
    '10 0 1 * *',
    $sql$select run_league_rollover();$sql$
  );
end $$;

commit;
