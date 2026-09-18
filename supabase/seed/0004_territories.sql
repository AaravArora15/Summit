-- Starter content for Capture Territory (0025_territories.sql): auto-detect
-- a few tight real-world clusters out of the already-seeded locations.
--
-- Not part of the migration itself: migrations run before
-- seed/0001_world_locations.sql does (see deploy.sh/tests/run.sh), so a
-- clustering pass inside the migration would run against an empty
-- locations table and find nothing. This runs after that seed, same as
-- seed/0002 and 0003 already do for their own one-time backfills.
--
-- ST_ClusterDBSCAN, eps in degrees (~2km — a rough approximation that is
-- fine here: this only ever groups locations already known to be close, it
-- does not need to be precise at every latitude). Only clusters of exactly
-- 3 or 4 open, non-secret, not-already-assigned locations become
-- territories; anything smaller or larger is left for an admin to curate
-- deliberately via create_territory() instead of guessing at how to split
-- it. Capped at 8 territories and skipped entirely if any already exist,
-- so re-running this is a no-op rather than a second, different set of
-- clusters from a re-shuffled algorithm.

begin;
set local search_path = public, extensions, pg_temp;

do $$
declare
  v_cluster           record;
  v_new_territory_id  uuid;
begin
  if exists (select 1 from territories) then
    return;
  end if;

  for v_cluster in
    with clustered as (
      select
        l.id,
        l.city_id,
        st_clusterdbscan(l.geom::geometry, 0.018, 3) over () as cluster_id
      from locations l
      where l.status = 'open' and not l.is_secret and l.territory_id is null
    )
    select city_id, array_agg(id) as location_ids
    from clustered
    where cluster_id is not null
    group by cluster_id, city_id
    having count(*) between 3 and 4
    limit 8
  loop
    -- Named after one real member rather than a generic "Territory N": with
    -- no admin-authored name yet, the alphabetically-first location in the
    -- cluster is at least a true, specific thing rather than a placeholder.
    insert into territories (city_id, name, centre)
    select
      v_cluster.city_id,
      (select l.name from locations l where l.id = any(v_cluster.location_ids) order by l.name limit 1) || ' area',
      st_centroid(st_collect(geom::geometry))::geography
    from locations where id = any(v_cluster.location_ids)
    returning id into v_new_territory_id;

    update locations set territory_id = v_new_territory_id where id = any(v_cluster.location_ids);
  end loop;
end $$;

commit;
