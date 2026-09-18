-- Summit: per-set titles, the real set-complete point value, and a real
-- reviewer path for suggested locations.
--
-- Three unrelated gaps closed together because all three needed the same
-- new primitive first: `profiles.is_admin`. There has never been a staff
-- concept anywhere in this schema (confirmed: zero hits for admin/role/
-- moderator across every prior migration) — reviewing a suggestion has been
-- "someone runs SQL by hand against the live project" since 0014. This adds
-- the flag, then two small pieces that read it.
--
-- 1. Titles, done right: queries.ts's titleFor() picked one of three generic
--    tiers from *how many* sets you'd finished, explicitly because "there is
--    no titles table: a set completion is already the achievement." That
--    reasoning still holds — this still isn't a table — but the spec wants a
--    title *per set*, so my_profile() now derives one from the most recently
--    completed set's own name ("Trails" -> "Trails Keeper") instead of a
--    count. Mechanical, not authored copy; swap the ' Keeper' suffix for
--    real per-set strings later if there's ever a reason to.
--
-- 2. set_complete pays 400 XP now, not 80 — matching "badge + title + 400
--    points" for real. Monthly stays at 80 on purpose: that number is about
--    this month's competitiveness, a concern the spec's line was never
--    about, and there's no reason the two systems have to move together.
--    Future claims only; every already-completed set's ledger rows stay at
--    80 rather than being rewritten under someone's feet.
--
-- 3. Suggestion review: pending_location_suggestions() (list, admin-only),
--    approve_location_suggestion() (creates the real locations row),
--    reject_location_suggestion(). A suggestion only ever captures a name
--    and a point (see suggest_location(), 0014) — everything else a location
--    needs (rarity, difficulty, which set, if any) is supplied at approval
--    time; city_id defaults to the only city that exists today and can be
--    overridden once that stops being true.

begin;
set local search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- 0. The flag everything else here reads
-- ---------------------------------------------------------------------------

alter table profiles add column if not exists is_admin boolean not null default false;

-- ---------------------------------------------------------------------------
-- 1 & shared: my_profile(), extended with is_admin and a real per-set title
-- ---------------------------------------------------------------------------

-- Return type is changing (new OUT columns), which CREATE OR REPLACE cannot
-- do in Postgres — same reason 0020 had to drop locations_near()/
-- set_locations() first.
drop function if exists my_profile();

create function my_profile()
returns table (
  user_id          uuid,
  display_name     text,
  initials         text,
  explorer_number  integer,
  city_name        text,
  is_founding      boolean,
  is_admin         boolean,
  level            integer,
  xp_into_level    integer,
  xp_for_level     integer,
  total_xp         integer,
  badges           integer,
  numbers          integer,
  spots            integer,
  sets_completed   integer,
  title            text,
  treks_this_month integer
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with me as (
    select p.*, c.name as city_name
    from profiles p
    left join cities c on c.id = p.home_city_id
    where p.id = auth.uid()
  ),
  xp as (
    select coalesce(sum(amount), 0)::integer as total
    from points_ledger where user_id = auth.uid() and system = 'xp'
  ),
  lvl as (
    select level_for_xp(xp.total) as n, xp.total from xp
  ),
  held as (
    select
      count(*)::integer                                        as badges,
      count(*) filter (where c.pioneer_number is not null)::integer as numbers,
      count(*) filter (where l.is_secret)::integer              as spots
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = auth.uid()
  ),
  -- Every set fully held by this caller, with the latest claim date among its
  -- locations — the "having" clause is the same "every open location in the
  -- set has a matching claim" test the old count-only version used, kept
  -- exactly so sets_completed below doesn't drift from what it always meant.
  sets_done as (
    select l.set_id, max(c.claimed_at) filter (where c.id is not null) as latest_claimed_at
    from locations l
    left join claims c on c.location_id = l.id and c.user_id = auth.uid()
    where l.set_id is not null and l.status = 'open'
    group by l.set_id
    having count(*) = count(*) filter (where c.id is not null)
  ),
  month_treks as (
    select count(*)::integer as n
    from treks
    where user_id = auth.uid()
      and status = 'validated'
      and coalesce(ended_at, started_at) >= date_trunc('month', now())
  )
  select
    me.id,
    me.display_name,
    -- Initials from the display name, capped at two. "Climber #0472" gives "C",
    -- which is what the avatar in the mockup shows for a guest.
    upper(substr(regexp_replace(me.display_name, '[^a-zA-Z ]', '', 'g'), 1, 1))
      || coalesce(upper(substr(split_part(
           trim(regexp_replace(me.display_name, '[^a-zA-Z ]', '', 'g')), ' ', 2), 1, 1)), ''),
    me.explorer_number,
    me.city_name,
    -- The first five hundred people in a city keep the standing permanently.
    me.explorer_number is not null and me.explorer_number <= 500,
    me.is_admin,
    lvl.n,
    (lvl.total - xp_floor_for_level(lvl.n))::integer,
    (xp_floor_for_level(lvl.n + 1) - xp_floor_for_level(lvl.n))::integer,
    lvl.total,
    held.badges, held.numbers, held.spots,
    (select count(*)::integer from sets_done),
    (
      select ls.name || ' Keeper'
      from sets_done sd
      join location_sets ls on ls.id = sd.set_id
      order by sd.latest_claimed_at desc nulls last
      limit 1
    ),
    month_treks.n
  from me, lvl, held, month_treks;
$$;

-- DROP FUNCTION above also drops its grants — reinstate the same one
-- 0006_read_api.sql originally set.
revoke all on function my_profile() from public;
grant execute on function my_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. set_complete: 400 XP, monthly unchanged
-- ---------------------------------------------------------------------------

create or replace function award_claim_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_xp_per_300m     constant integer := 20;
  c_xp_per_minute   constant integer := 4;
  c_xp_badge        constant integer := 20;
  c_xp_new_route    constant integer := 6;

  c_mo_per_300m     constant integer := 28;
  c_mo_per_minute   constant integer := 8;
  c_mo_badge        constant integer := 40;
  c_mo_new_route    constant integer := 12;
  c_mo_secret_spot  constant integer := 16;
  c_mo_beat_average constant integer := 20;

  -- Flat, separate from activity-specific points: never multiplied.
  -- c_xp_set_complete: 80 -> 400 here (0022) — "badge + title + 400 points"
  -- per the spec, matching the XP system specifically (see this migration's
  -- header). c_mo_set_complete is untouched on purpose.
  c_xp_set_complete constant integer := 400;
  c_mo_set_complete constant integer := 80;
  c_xp_difficulty   constant integer[] := array[40, 72, 130, 235];
  c_mo_difficulty   constant integer[] := array[40, 88, 140, 196];

  c_pb_mult_xp      constant numeric := 1.5;
  c_pb_mult_monthly constant numeric := 2.0;
  c_partner_mult    constant numeric := 1.2;
  c_streak_mult     constant numeric := 2.0;
  c_multiplier_cap  constant numeric := 3.0;

  v_trek      treks%rowtype;
  v_location  locations%rowtype;
  v_set_total integer;
  v_set_held  integer;
  v_is_pb     boolean := false;
  v_streak3   boolean := false;
  v_mult_xp   numeric := 1;
  v_mult_mo   numeric := 1;
  v_is_new_route boolean := false;
begin
  select * into v_location from locations where id = new.location_id;
  select * into v_trek     from treks     where id = new.trek_id;

  if v_trek.id is not null then
    v_is_pb := coalesce(v_trek.distance_m, 0) > coalesce((
      select max(distance_m) from treks
      where user_id = new.user_id and status = 'validated' and id <> v_trek.id
    ), 0);

    v_streak3 :=
      exists (
        select 1 from treks t
        where t.user_id = new.user_id and t.status = 'validated'
          and date_trunc('day', t.started_at) = date_trunc('day', v_trek.started_at) - interval '1 day'
      )
      and exists (
        select 1 from treks t
        where t.user_id = new.user_id and t.status = 'validated'
          and date_trunc('day', t.started_at) = date_trunc('day', v_trek.started_at) - interval '2 days'
      );

    v_mult_xp := least(c_multiplier_cap,
      (case when v_is_pb then c_pb_mult_xp else 1 end) *
      (case when v_trek.with_partner then c_partner_mult else 1 end));

    v_mult_mo := least(c_multiplier_cap,
      (case when v_is_pb then c_pb_mult_monthly else 1 end) *
      (case when v_trek.with_partner then c_partner_mult else 1 end) *
      (case when v_streak3 then c_streak_mult else 1 end));
  end if;

  if v_trek.id is not null then
    if coalesce(v_trek.distance_m, 0) >= 100 then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'distance', 'xp',
              round(floor(v_trek.distance_m / 300)::integer * c_xp_per_300m * v_mult_xp)::integer)
      on conflict do nothing;

      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'distance', 'monthly',
              round(floor(v_trek.distance_m / 300)::integer * c_mo_per_300m * v_mult_mo)::integer)
      on conflict do nothing;
    end if;

    if coalesce(v_trek.moving_time_s, 0) >= 60 then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'moving_time', 'xp',
              round(floor(v_trek.moving_time_s / 60)::integer * c_xp_per_minute * v_mult_xp)::integer)
      on conflict do nothing;

      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, v_trek.id, new.id, 'moving_time', 'monthly',
              round(floor(v_trek.moving_time_s / 60)::integer * c_mo_per_minute * v_mult_mo)::integer)
      on conflict do nothing;
    end if;
  end if;

  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'xp', round(c_xp_badge * v_mult_xp)::integer);
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'badge', 'monthly', round(c_mo_badge * v_mult_mo)::integer);

  if v_location.set_id is not null then
    v_is_new_route := not exists (
      select 1 from claims c
      join locations l on l.id = c.location_id
      where c.user_id = new.user_id and c.id <> new.id and l.set_id = v_location.set_id
    );

    if v_is_new_route then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', 'xp', round(c_xp_new_route * v_mult_xp)::integer);
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'new_route', 'monthly', round(c_mo_new_route * v_mult_mo)::integer);
    end if;

    select count(*) into v_set_total
    from locations where set_id = v_location.set_id and status = 'open';

    select count(*) into v_set_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.set_id = v_location.set_id and l.status = 'open';

    if v_set_total > 0 and v_set_held >= v_set_total then
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', 'xp', c_xp_set_complete);
      insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
      values (new.user_id, new.trek_id, new.id, 'set_complete', 'monthly', c_mo_set_complete);
    end if;
  end if;

  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'xp', c_xp_difficulty[v_location.difficulty]);
  insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
  values (new.user_id, new.trek_id, new.id, 'difficulty', 'monthly', c_mo_difficulty[v_location.difficulty]);

  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'secret_spot', 'monthly', c_mo_secret_spot);
  end if;

  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.trek_id, new.id, 'beat_average', 'monthly', c_mo_beat_average);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Suggestion review
-- ---------------------------------------------------------------------------

create or replace function pending_location_suggestions()
returns table (
  id         uuid,
  user_id    uuid,
  submitter  text,
  name       text,
  notes      text,
  lat        double precision,
  lng        double precision,
  has_photo  boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    s.id, s.user_id,
    coalesce(p.display_name, 'Unknown'),
    s.name, s.notes,
    st_y(s.geom::geometry), st_x(s.geom::geometry),
    s.photo_path is not null,
    s.created_at
  from location_suggestions s
  left join profiles p on p.id = s.user_id
  where s.status = 'pending'
    and exists (select 1 from profiles me where me.id = auth.uid() and me.is_admin)
  order by s.created_at asc;
$$;

revoke all on function pending_location_suggestions() from public;
grant execute on function pending_location_suggestions() to authenticated;

-- Turns one suggestion into a real, claimable location. Everything the
-- suggestion itself didn't capture (rarity, difficulty, which set, if any)
-- is supplied here by the reviewer; city_id defaults to the only city that
-- exists today (see this migration's header).
create or replace function approve_location_suggestion(
  p_suggestion_id uuid,
  p_slug          text,
  p_set_id        uuid default null,
  p_rarity        rarity default 'common',
  p_difficulty    smallint default 1,
  p_city_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_suggestion  location_suggestions%rowtype;
  v_city_id     uuid;
  v_location_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_suggestion from location_suggestions where id = p_suggestion_id for update;
  if not found then
    raise exception 'unknown suggestion' using errcode = 'P0002';
  end if;
  if v_suggestion.status <> 'pending' then
    raise exception 'suggestion already reviewed' using errcode = 'P0001';
  end if;

  v_city_id := coalesce(p_city_id, (select id from cities order by name limit 1));
  if v_city_id is null then
    raise exception 'no city exists to attach this location to' using errcode = 'P0001';
  end if;

  insert into locations (city_id, set_id, slug, name, geom, rarity, difficulty, status)
  values (v_city_id, p_set_id, p_slug, v_suggestion.name, v_suggestion.geom, p_rarity, p_difficulty, 'open')
  returning id into v_location_id;

  update location_suggestions
  set status = 'approved', reviewed_at = now(),
      review_note = coalesce(review_note, 'Added to the map.')
  where id = p_suggestion_id;

  return v_location_id;
end;
$$;

revoke all on function approve_location_suggestion(uuid, text, uuid, rarity, smallint, uuid) from public;
grant execute on function approve_location_suggestion(uuid, text, uuid, rarity, smallint, uuid) to authenticated;

create or replace function reject_location_suggestion(
  p_suggestion_id uuid,
  p_review_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update location_suggestions
  set status = 'rejected', reviewed_at = now(), review_note = p_review_note
  where id = p_suggestion_id and status = 'pending';

  if not found then
    raise exception 'unknown or already-reviewed suggestion' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function reject_location_suggestion(uuid, text) from public;
grant execute on function reject_location_suggestion(uuid, text) to authenticated;

commit;
