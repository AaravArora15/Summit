-- MacRitchie Reservoir, added by hand rather than through
-- scripts/seed-csv.mjs: the CSV's "MacRitchie Nature Trail (TreeTop Walk)"
-- row failed to geocode (see scripts/.geocode-cache.json) and, even if it
-- had, Nominatim would have returned the reservoir's own centroid
-- (1.3448177, 103.8239379 - open water, not reachable on foot) rather than
-- anywhere a hiker actually stands.
--
-- Placed instead at the main entrance signage off Lornie Road (181 Lornie
-- Road, opposite Mount Alvernia Hospital), where the NParks "MacRitchie
-- Reservoir Park" board and the trailhead car park are. Elevation from
-- SRTM 30m via OpenTopoData, same source as seed/0001.

begin;
set local search_path = public, extensions;

insert into locations
  (city_id, set_id, slug, name, geom, rarity, difficulty, distance_m,
   elevation_m, elevation_source)
values
  ((select id from cities where name = 'World'),
   (select id from location_sets where key = 'park' and city_id = (select id from cities where name = 'World')),
   'macritchiereservoir', 'MacRitchie Reservoir',
   st_point(103.8326935, 1.3415891)::geography,
   'common', 1, 10000, 34, 'srtm30m')
on conflict (slug) do nothing;

commit;
