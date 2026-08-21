-- Summit: points earned, attributed back to the claim that earned them.
--
-- The Explore map is getting a location detail popover (name, set, whether
-- it's discovered) and it should show what a claim actually paid, not a
-- number invented for the pin. points_ledger already carries every source
-- that award_claim_points() writes, but it is only keyed by trek_id, and a
-- trek can carry more than one claim (a single walk that passes several
-- locations). Grouping by trek_id in that case would hand every claim on the
-- trek the sum of all of them.
--
-- The trigger already has the specific claim (`new`) in scope when it writes
-- each row, so this adds claim_id and stamps it there. distance/moving_time
-- stay attributed to whichever claim triggered them first, which matches how
-- they already work: paid once per trek, not once per claim.

begin;
set local search_path = public, extensions, pg_temp;

alter table points_ledger add column if not exists claim_id uuid references claims(id) on delete cascade;
create index if not exists points_claim_idx on points_ledger (claim_id);

create or replace function award_claim_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_per_100m       constant integer := 1;
  c_per_minute     constant integer := 2;

  c_first_ten      constant integer := 500;
  c_first_hundred  constant integer := 200;
  c_pioneer        constant integer := 50;

  c_secret_spot    constant integer := 300;
  c_new_set        constant integer := 100;
  c_beat_average   constant integer := 120;

  v_trek     treks%rowtype;
  v_location locations%rowtype;
  v_set_total integer;
  v_set_held  integer;
begin
  select * into v_location from locations where id = new.location_id;
  select * into v_trek     from treks     where id = new.trek_id;

  -- --- trek-level, once per trek --------------------------------------------

  if v_trek.id is not null then
    if coalesce(v_trek.distance_m, 0) >= 100 then
      insert into points_ledger (user_id, trek_id, claim_id, source, amount)
      values (new.user_id, v_trek.id, new.id, 'distance',
              floor(v_trek.distance_m / 100)::integer * c_per_100m)
      on conflict do nothing;
    end if;

    if coalesce(v_trek.moving_time_s, 0) >= 60 then
      insert into points_ledger (user_id, trek_id, claim_id, source, amount)
      values (new.user_id, v_trek.id, new.id, 'moving_time',
              floor(v_trek.moving_time_s / 60)::integer * c_per_minute)
      on conflict do nothing;
    end if;
  end if;

  -- --- the claim itself -----------------------------------------------------

  if new.pioneer_number is not null then
    insert into points_ledger (user_id, trek_id, claim_id, source, amount)
    values (new.user_id, new.trek_id, new.id, 'first_discovery',
            case
              when new.pioneer_number <= 10  then c_first_ten
              when new.pioneer_number <= 100 then c_first_hundred
              else c_pioneer
            end);
  end if;

  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, claim_id, source, amount)
    values (new.user_id, new.trek_id, new.id, 'secret_spot', c_secret_spot);
  end if;

  -- First location in a set you had never touched. Rewards breadth, which is
  -- what stops the sets board being six people's home reservoir.
  if v_location.set_id is not null then
    if not exists (
      select 1 from claims c
      join locations l on l.id = c.location_id
      where c.user_id = new.user_id
        and c.id <> new.id
        and l.set_id = v_location.set_id
    ) then
      insert into points_ledger (user_id, trek_id, claim_id, source, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', c_new_set);
    end if;

    -- And the other end: the claim that finishes a set.
    select count(*) into v_set_total
    from locations where set_id = v_location.set_id and status = 'open';

    select count(*) into v_set_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.set_id = v_location.set_id and l.status = 'open';

    if v_set_total > 0 and v_set_held >= v_set_total then
      insert into points_ledger (user_id, trek_id, claim_id, source, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', set_complete_bonus_points());
    end if;
  end if;

  -- Faster than the posted average for the route.
  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, claim_id, source, amount)
    values (new.user_id, new.trek_id, new.id, 'beat_average', c_beat_average);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- locations_near(): a points_earned column, alongside claimed
-- ---------------------------------------------------------------------------
--
-- Null when unclaimed, same as everywhere else in the app that shows a claim
-- fact: a location's points are not knowable before the walk (distance and
-- time both feed the total), so there is nothing honest to show but "not yet".

drop function if exists locations_near(double precision, double precision, integer);

create or replace function locations_near(
  p_lat    double precision,
  p_lng    double precision,
  p_radius integer default 5000
)
returns table (
  id            uuid,
  name          text,
  slug          text,
  lng           double precision,
  lat           double precision,
  set_id        uuid,
  set_key       text,
  set_name      text,
  rarity        rarity,
  difficulty    smallint,
  distance_m    double precision,
  pioneer_taken integer,
  pioneer_cap   integer,
  status        text,
  claimed       boolean,
  pioneer_number integer,
  points_earned integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    l.id, l.name, l.slug,
    st_x(l.geom::geometry), st_y(l.geom::geometry),
    l.set_id, s.key, s.name,
    l.rarity, l.difficulty,
    st_distance(l.geom, st_point(p_lng, p_lat)::geography) as distance_m,
    l.pioneer_taken, l.pioneer_cap, l.status,
    c.id is not null,
    c.pioneer_number,
    (select sum(pl.amount)::integer from points_ledger pl where pl.claim_id = c.id)
  from locations l
  left join location_sets s on s.id = l.set_id
  -- auth.uid() is null for an unauthenticated caller, which the left join
  -- handles the same as "not found": every row simply comes back unclaimed.
  left join claims c on c.location_id = l.id and c.user_id = auth.uid()
  where not l.is_secret                    -- secret spots never ship coordinates
    and st_dwithin(l.geom, st_point(p_lng, p_lat)::geography, p_radius)
  order by distance_m;
$$;

revoke all on function locations_near(double precision, double precision, integer) from public;
grant execute on function locations_near(double precision, double precision, integer) to anon, authenticated;

commit;
