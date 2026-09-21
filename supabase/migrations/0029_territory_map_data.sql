-- Summit: territory_map_data() — polygon data for the Explore map overlay.
--
-- Each territory's visible boundary is the convex hull of its member
-- locations, buffered outward by 200 m so the polygon isn't a razor-thin
-- line hugging the points. The client receives raw coordinates and
-- assembles the GeoJSON — keeping the server out of rendering decisions
-- and letting the same data drive different visual treatments (filled,
-- outlined, dimmed) without another round trip.
--
-- This is a read-only query exposed to any authenticated user: it returns
-- only the same territory-centre, held/total/captured, and member-coordinate
-- information the existing my_territories()/territory_locations() RPCs
-- already disclose. No private user data, no hidden territory info, no
-- internal administrative data.

begin;
set local search_path = public, extensions, pg_temp;

create or replace function territory_map_data()
returns table (
  territory_id uuid,
  name         text,
  held         integer,
  total        integer,
  captured     boolean,
  member_lngs  double precision[],
  member_lats  double precision[]
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with counted as (
    select t.id, t.name,
           count(l.id)::integer as total,
           count(l.id) filter (
             where exists (
               select 1 from claims c
               where c.location_id = l.id and c.user_id = auth.uid()
             )
           )::integer as held
    from territories t
    left join locations l
      on l.territory_id = t.id and l.status = 'open' and not l.is_secret
    group by t.id, t.name
  ),
  members as (
    select
      l.territory_id,
      array_agg(st_x(l.geom::geometry) order by l.name) as lngs,
      array_agg(st_y(l.geom::geometry) order by l.name) as lats
    from locations l
    where l.territory_id is not null
      and l.status = 'open' and not l.is_secret
    group by l.territory_id
  )
  select
    c.id,
    c.name,
    c.held,
    c.total,
    tc.id is not null as captured,
    coalesce(m.lngs, array[]::double precision[]),
    coalesce(m.lats, array[]::double precision[])
  from counted c
  left join territory_captures tc
    on tc.territory_id = c.id and tc.user_id = auth.uid()
  left join members m on m.territory_id = c.id
  order by
    case when c.total = 0 then 1 when c.held = 0 then 1 else 0 end,
    c.held desc,
    c.name;
$$;

revoke all on function territory_map_data() from public;
grant execute on function territory_map_data() to authenticated;

commit;
