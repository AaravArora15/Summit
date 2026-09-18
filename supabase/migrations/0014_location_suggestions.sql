-- Summit: user-submitted location suggestions.
--
-- A suggestion is not a location yet. Nothing here promises the coordinate
-- sits on real, walkable, public ground the way every row in `locations`
-- does (dwell-checked terrain, no-go clipping, the hand-curated exclusion
-- list in scripts/seed-osm.mjs). So a suggestion waits in its own table
-- rather than touching `locations` directly, until someone reviews it by
-- hand and either promotes it in (the same insert path every other location
-- arrived by) or rejects it. There is no reviewer UI yet — for now that
-- review is a manual `update location_suggestions set status = ...` against
-- the live project, the same way EXCLUDED_OSM_KEYS in seed-osm.mjs is
-- curated by hand rather than through an admin screen.
--
-- RPC-only, same as everywhere else in this schema: both the write and the
-- read below run inside security definer functions, so `location_suggestions`
-- itself is RLS-enabled with zero policies and nothing here has to reason
-- about a client crafting its own select or insert.

begin;
set local search_path = public, extensions;

create type suggestion_status as enum ('pending', 'approved', 'rejected');

create table location_suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  notes       text check (notes is null or char_length(notes) <= 1000),
  geom        geography(Point, 4326) not null,
  -- Same bucket and path convention as claims.photo_path (see 0004_storage.sql):
  -- `<user-id>/...`, enforced by that bucket's existing storage policy, so this
  -- table needs no storage change of its own.
  photo_path  text,
  status      suggestion_status not null default 'pending',
  review_note text,
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz
);

create index location_suggestions_user_idx on location_suggestions (user_id, created_at desc);

alter table location_suggestions enable row level security;
-- No policies: suggest_location() and my_location_suggestions() below are the
-- only way in or out.

/**
 * Submit a suggestion. Anyone signed in may call this, including an
 * anonymous session — the same bar as claiming a location, not a higher one.
 */
create or replace function suggest_location(
  p_name       text,
  p_lat        double precision,
  p_lng        double precision,
  p_notes      text default null,
  p_photo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to suggest a location.' using errcode = '28000';
  end if;

  if p_lat is null or p_lat < -90 or p_lat > 90 or p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'That does not look like a real coordinate.' using errcode = 'P0001';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Give it a name.' using errcode = 'P0001';
  end if;

  insert into location_suggestions (user_id, name, notes, geom, photo_path)
  values (
    auth.uid(),
    btrim(p_name),
    nullif(btrim(coalesce(p_notes, '')), ''),
    st_point(p_lng, p_lat)::geography,
    p_photo_path
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function suggest_location(text, double precision, double precision, text, text) from public;
grant execute on function suggest_location(text, double precision, double precision, text, text) to authenticated;

/** Your own suggestions and their review status. Never anyone else's — there
 *  is no version of this that takes a user id, same rule as every other
 *  function in the read API (0006_read_api.sql). */
create or replace function my_location_suggestions()
returns table (
  id          uuid,
  name        text,
  notes       text,
  lat         double precision,
  lng         double precision,
  status      suggestion_status,
  review_note text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    s.id, s.name, s.notes,
    st_y(s.geom::geometry), st_x(s.geom::geometry),
    s.status, s.review_note, s.created_at
  from location_suggestions s
  where s.user_id = auth.uid()
  order by s.created_at desc;
$$;

revoke all on function my_location_suggestions() from public;
grant execute on function my_location_suggestions() to authenticated;

commit;
