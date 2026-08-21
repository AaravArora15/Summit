-- Summit: what Explore actually needs from locations_near().
--
-- The screen doc for Explore (src/app/(tabs)/explore.tsx) describes four
-- signals a card carries without collision - set stripe, rarity chip, peak
-- row, pioneer count - plus "a forest tick marks something already claimed".
-- None of that is answerable from the original locations_near(), which never
-- returned a coordinate to plot, a set to stripe by, or a claimed flag to tick.
-- It shipped as a list-only query; this is what turns it into a map query too.

begin;
set local search_path = public, extensions;

-- `create or replace` cannot change a function's return type. See 0006 for the
-- same note; this is the first migration that has to drop locations_near()
-- rather than replace it, because it existed since 0001.
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
  claimed       boolean
)
language sql
stable
as $$
  select
    l.id, l.name, l.slug,
    st_x(l.geom::geometry), st_y(l.geom::geometry),
    l.set_id, s.key, s.name,
    l.rarity, l.difficulty,
    st_distance(l.geom, st_point(p_lng, p_lat)::geography) as distance_m,
    l.pioneer_taken, l.pioneer_cap, l.status,
    -- auth.uid() is null for an unauthenticated caller, which exists() handles
    -- the same as "not found": every row simply comes back unclaimed.
    exists (
      select 1 from claims c where c.location_id = l.id and c.user_id = auth.uid()
    )
  from locations l
  left join location_sets s on s.id = l.set_id
  where not l.is_secret                    -- secret spots never ship coordinates
    and st_dwithin(l.geom, st_point(p_lng, p_lat)::geography, p_radius)
  order by distance_m;
$$;

commit;
