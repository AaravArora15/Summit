-- Summit: itemized points on the reward screen.
--
-- points_ledger has always carried a real per-source breakdown for every
-- claim (see award_claim_points(), 0012) — distance, moving time, badge,
-- new route, difficulty, and so on — but nothing ever read it back itemized.
-- The only existing consumers (my_profile(), locations_near(),
-- my_treks()/my_badges()) each collapse it to one pre-summed total. The
-- arrival screen wants the individual lines, so this is a small new read
-- API rather than a change to any of those.
--
-- XP only, matching locations_near()'s existing points_earned (the
-- permanent total) rather than the monthly figure that feeds the league:
-- the reward screen is telling someone what they permanently earned by
-- claiming this specific badge, the same number Explore already shows for
-- a claimed location, just broken out by source instead of pre-summed.
--
-- SECURITY DEFINER bypasses points_ledger's "own points" RLS policy
-- (0001), so the ownership check below is load-bearing, not redundant with
-- it — without `pl.user_id = auth.uid()` this would hand back anyone's
-- breakdown given any claim_id.

begin;
set local search_path = public, extensions;

create or replace function claim_points_breakdown(p_claim_id uuid)
returns table (
  source text,
  amount integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select pl.source, pl.amount
  from points_ledger pl
  where pl.claim_id = p_claim_id
    and pl.system = 'xp'
    and pl.user_id = auth.uid()
  order by pl.amount desc;
$$;

revoke all on function claim_points_breakdown(uuid) from public;
grant execute on function claim_points_breakdown(uuid) to authenticated;

commit;
