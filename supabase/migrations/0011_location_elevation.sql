-- Summit: elevation on the Explore location detail panel.
--
-- locations.elevation_m has existed since 0002 (it already drives difficulty
-- and the altitude anti-spoof check in claim_location()), but locations_near()
-- never sent it to the client — the Explore card had nowhere to show it.
-- Adding it is a straight passthrough, no new source of truth.

begin;
set local search_path = public, extensions, pg_temp;

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
  elevation_m   real,
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
    l.elevation_m,
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
