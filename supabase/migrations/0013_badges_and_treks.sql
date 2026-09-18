-- Summit: two read-API additions for screens that didn't exist yet.
--
-- my_badges() backs a full, searchable badge browser (Collect's "Search your
-- badges" button had nothing to search — the tab is a dashboard of counts,
-- not a list). No p_limit: a climber's held badges are bounded by how many
-- open locations exist in their city, the same quantity my_collection()'s
-- `total` already reports, so there is no scale problem this cap-vs-no-cap
-- other read-API functions weigh.
--
-- my_treks() backs a trek journal. Its one deliberate departure from a plain
-- join: a claim on a secret spot never surfaces the spot's real name here
-- either, matching the rule everywhere else in the app (secret_spots_near(),
-- geofence.ts's notification, explore.tsx's hunt cards) — a trek journal is
-- still a UI a screenshot of which could leak the answer.

begin;
set local search_path = public, extensions, pg_temp;

create or replace function my_badges()
returns table (
  claim_id       uuid,
  location_id    uuid,
  slug           text,
  name           text,
  rarity         rarity,
  difficulty     smallint,
  set_key        text,
  set_name       text,
  set_colour     text,
  pioneer_number integer,
  claimed_at     timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select c.id, l.id, l.slug, l.name, l.rarity, l.difficulty, s.key, s.name, s.colour,
         c.pioneer_number, c.claimed_at
  from claims c
  join locations l on l.id = c.location_id
  left join location_sets s on s.id = l.set_id
  where c.user_id = auth.uid()
  order by c.claimed_at desc;
$$;

revoke all on function my_badges() from public;
grant execute on function my_badges() to authenticated;

create or replace function my_treks(p_limit integer default 30)
returns table (
  id             uuid,
  started_at     timestamptz,
  ended_at       timestamptz,
  distance_m     numeric,
  moving_time_s  integer,
  status         trek_status,
  location_name  text,
  pioneer_number integer,
  points_earned  integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    t.id, t.started_at, t.ended_at, t.distance_m, t.moving_time_s, t.status,
    case when l.is_secret then 'Secret spot' else l.name end,
    c.pioneer_number,
    (select sum(pl.amount)::integer from points_ledger pl where pl.trek_id = t.id and pl.system = 'xp')
  from treks t
  left join claims c on c.trek_id = t.id
  left join locations l on l.id = c.location_id
  where t.user_id = auth.uid()
  order by t.started_at desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function my_treks(integer) from public;
grant execute on function my_treks(integer) to authenticated;

commit;
