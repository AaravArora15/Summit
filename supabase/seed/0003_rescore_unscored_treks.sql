-- Summit: re-score validated treks that earned nothing.
--
-- NOT run by deploy.sh. Opt-in repair:
--
--   psql "$SUPABASE_DB_URL" -f seed/0003_rescore_unscored_treks.sql
--
-- Why it exists: the live project ran migrations only up to 0012 until
-- 2026-08-22, so any trek validated before 0015 was deployed went through
-- apply_trek_to_league() (0005: trek and km counters) but never through
-- award_trek_activity_points() (0015: the points). Those treks show in the
-- division as "4 treks · 24 km" beside a score of 0.
--
-- Both triggers fire on UPDATE OF status and both ignore a row that was
-- already 'validated', so merely touching the rows does nothing. Instead,
-- for every user who has at least one validated trek with no ledger rows:
--
--   1. zero that user's division counters for every period involved, since
--      the re-validate below will rebuild them from scratch;
--   2. flip all of their validated treks back to 'submitted' (neither
--      trigger fires on the way down);
--   3. flip them to 'validated' again one at a time in chronological order,
--      so the personal-best and streak multipliers see the same history a
--      real sequence of walks would have.
--
-- Treks that already had ledger rows are re-flipped too, for the counters'
-- sake, but earn nothing twice: points_ledger's unique index on
-- (user, trek, source, system) makes the trigger's inserts no-ops.
--
-- Requires 0015 to be deployed. Idempotent: once every validated trek has
-- ledger rows, the driving query is empty and nothing happens.

begin;
set local search_path = public, extensions, pg_temp;

do $$
declare
  u record;
  t record;
begin
  for u in
    select distinct tr.user_id
    from treks tr
    where tr.status = 'validated'
      and not exists (select 1 from points_ledger pl where pl.trek_id = tr.id)
  loop
    update league_members lm
       set points = 0, treks = 0, distance_m = 0
      from leagues l
     where l.id = lm.league_id
       and lm.user_id = u.user_id
       and l.period in (
         select distinct date_trunc('month', coalesce(ended_at, started_at))::date
         from treks where user_id = u.user_id and status = 'validated'
       );

    update treks set status = 'submitted'
     where user_id = u.user_id and status = 'validated';

    for t in
      select id from treks
      where user_id = u.user_id and status = 'submitted'
      order by started_at, id
    loop
      update treks set status = 'validated' where id = t.id;
    end loop;
  end loop;
end $$;

commit;
