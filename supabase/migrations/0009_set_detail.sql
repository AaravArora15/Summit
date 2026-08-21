-- Summit: the set detail screen.
--
-- Home's "Closest set" card and Collect's set-progress rows now link to a
-- dedicated screen (screen 15 in the v4 mockup, "Set detail"): the set's
-- reward, every location in it, and which of them are already claimed. This
-- is the read query behind that screen.
--
-- One deliberate departure from the mockup: a missing location renders as a
-- dimmed copy of its real badge (true glyph, true rarity colour, real name),
-- not the generic locked/mystery shield used for the empty "featured" slot
-- elsewhere in the app. The two carry different meanings - "you have not
-- unlocked this kind of thing yet" versus "you know exactly which place this
-- is and have not been there" - and the mockup's locked-triangle treatment
-- was written for the first, not the second.

begin;
set local search_path = public, extensions;

-- The set-complete bonus, read by both the scorer (0005) and this screen, so
-- the number this screen promises and the number award_claim_points() pays
-- out can never drift apart by one being edited without the other.
create or replace function set_complete_bonus_points()
returns integer
language sql
immutable
as $$
  select 750;
$$;

-- award_claim_points() carried its own copy of this constant; it now reads
-- the single source of truth above. `create or replace` cannot change a
-- trigger function's signature (it has none to change here), so this is a
-- normal replace, not a drop-and-recreate.
create or replace function award_claim_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Distance and time pay a floor rate: showing up is worth something, and it
  -- is the only source available on a walk to a place already claimed.
  c_per_100m       constant integer := 1;
  c_per_minute     constant integer := 2;

  -- Scarcity pays. A low number is the thing the product is about, and the
  -- ladder is steep on purpose: #7 should feel unlike #400.
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
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, v_trek.id, 'distance',
              floor(v_trek.distance_m / 100)::integer * c_per_100m)
      on conflict do nothing;
    end if;

    if coalesce(v_trek.moving_time_s, 0) >= 60 then
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, v_trek.id, 'moving_time',
              floor(v_trek.moving_time_s / 60)::integer * c_per_minute)
      on conflict do nothing;
    end if;
  end if;

  -- --- the claim itself -----------------------------------------------------

  if new.pioneer_number is not null then
    insert into points_ledger (user_id, trek_id, source, amount)
    values (new.user_id, new.trek_id, 'first_discovery',
            case
              when new.pioneer_number <= 10  then c_first_ten
              when new.pioneer_number <= 100 then c_first_hundred
              else c_pioneer
            end);
  end if;

  if v_location.is_secret then
    insert into points_ledger (user_id, trek_id, source, amount)
    values (new.user_id, new.trek_id, 'secret_spot', c_secret_spot);
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
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, new.trek_id, 'new_route', c_new_set);
    end if;

    -- And the other end: the claim that finishes a set.
    select count(*) into v_set_total
    from locations where set_id = v_location.set_id and status = 'open';

    select count(*) into v_set_held
    from claims c
    join locations l on l.id = c.location_id
    where c.user_id = new.user_id and l.set_id = v_location.set_id and l.status = 'open';

    if v_set_total > 0 and v_set_held >= v_set_total then
      insert into points_ledger (user_id, trek_id, source, amount)
      values (new.user_id, new.trek_id, 'set_complete', set_complete_bonus_points());
    end if;
  end if;

  -- Faster than the posted average for the route.
  if v_location.avg_time_min is not null
     and v_trek.moving_time_s is not null
     and v_trek.moving_time_s < v_location.avg_time_min * 60 then
    insert into points_ledger (user_id, trek_id, source, amount)
    values (new.user_id, new.trek_id, 'beat_average', c_beat_average);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Every location in a set, held or not
-- ---------------------------------------------------------------------------
--
-- Secret spots are excluded the same way locations_near() excludes them: a
-- set detail screen is exactly the kind of place someone would go looking for
-- "which one is still missing", and a secret spot's coordinates and identity
-- are never shipped to the client regardless of who is asking.

create or replace function set_locations(p_set_id uuid)
returns table (
  id             uuid,
  name           text,
  slug           text,
  rarity         rarity,
  difficulty     smallint,
  pioneer_taken  integer,
  pioneer_cap    integer,
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
    c.id is not null,
    c.pioneer_number,
    c.claimed_at
  from locations l
  left join claims c on c.location_id = l.id and c.user_id = auth.uid()
  where l.set_id = p_set_id
    and l.status = 'open'
    and not l.is_secret
  order by (c.id is null), c.claimed_at desc nulls last, l.difficulty, l.name;
$$;

revoke all on function set_complete_bonus_points() from public;
revoke all on function set_locations(uuid) from public;

grant execute on function set_complete_bonus_points() to authenticated;
grant execute on function set_locations(uuid) to authenticated;

commit;
