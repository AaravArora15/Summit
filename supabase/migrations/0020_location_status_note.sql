-- Summit: surface closure status to the client.
--
-- `locations.status`/`status_note` (0001) have always existed and
-- claim_location() has always refused a non-'open' location server-side, but
-- neither read API ever sent status_note down, and set_locations() silently
-- dropped closed/seasonal locations from the set-detail list entirely. A
-- closed location is exactly the "known place, not yet been there" case
-- set/[id].tsx already has a visual language for (see its own header
-- comment on faded vs locked) — it should still show up, just flagged, not
-- vanish.
--
-- Return-type changes aren't CREATE OR REPLACE-able in Postgres, so both
-- functions are dropped first.

begin;
set local search_path = public, extensions;

drop function if exists locations_near(double precision, double precision, integer);
drop function if exists set_locations(uuid);

create function locations_near(
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
  status_note   text,
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
    l.pioneer_taken, l.pioneer_cap, l.status, l.status_note,
    c.id is not null,
    c.pioneer_number,
    (select sum(pl.amount)::integer from points_ledger pl where pl.claim_id = c.id and pl.system = 'xp')
  from locations l
  left join location_sets s on s.id = l.set_id
  left join claims c on c.location_id = l.id and c.user_id = auth.uid()
  where not l.is_secret
    and st_dwithin(l.geom, st_point(p_lng, p_lat)::geography, p_radius)
  order by distance_m;
$$;

revoke all on function locations_near(double precision, double precision, integer) from public;
grant execute on function locations_near(double precision, double precision, integer) to anon, authenticated;

create function set_locations(p_set_id uuid)
returns table (
  id             uuid,
  name           text,
  slug           text,
  rarity         rarity,
  difficulty     smallint,
  pioneer_taken  integer,
  pioneer_cap    integer,
  status         text,
  status_note    text,
  claimed        boolean,
  pioneer_number integer,
  claimed_at     timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    l.id, l.name, l.slug, l.rarity, l.difficulty,
    l.pioneer_taken, l.pioneer_cap,
    l.status, l.status_note,
    c.id is not null,
    c.pioneer_number,
    c.claimed_at
  from locations l
  left join claims c on c.location_id = l.id and c.user_id = auth.uid()
  where l.set_id = p_set_id
    and not l.is_secret
  order by (c.id is null), c.claimed_at desc nulls last, l.difficulty, l.name;
$$;

revoke all on function set_locations(uuid) from public;
grant execute on function set_locations(uuid) to authenticated;

commit;
