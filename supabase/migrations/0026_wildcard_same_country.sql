-- Summit: the daily Wildcard (0024) must only ever pick somewhere the caller
-- is actually in a position to walk to today.
--
-- With locations scattered worldwide (scripts/seed-csv.mjs), an unfiltered
-- pick has ~640 candidates on every continent and the odds of landing
-- anywhere near the caller are close to zero. That defeats the whole point
-- of the feature: a "go find this today" prompt nobody can act on today.
--
-- locations.country_code is the country the location's own point actually
-- reverse-geocodes to (scripts/backfill-country-codes.mjs; the CSV's own
-- free-text Country column is not trusted here since a few rows name a
-- multi-country range and the geocoded point can land just across a border
-- from what the name implies). The client resolves its own current country
-- the same way, from the device's live position (see
-- features/geo/country.ts's getCurrentCountryCode()), and passes it in.
--
-- A null country_code (not yet backfilled) or a null p_country_code (device
-- location denied or unresolved) both mean "unknown," and unknown is treated
-- as "excluded," not "any": a wrong-country pick is worse than no pick at
-- all, so my_wildcard()/reroll_wildcard() would rather return nothing today
-- than guess. This only affects picking a *new* assignment (or picking a
-- reroll target); a wildcard already assigned earlier today is read back
-- as-is regardless of what country_code the caller passes on a later call.

begin;
set local search_path = public, extensions, pg_temp;

alter table locations add column if not exists country_code text;

create index if not exists locations_country_code_idx on locations (country_code);

-- create or replace can't change a function's signature: my_wildcard(text)
-- is a distinct overload from the old zero-arg my_wildcard(), not a
-- replacement of it. Drop the old ones outright so the unfiltered,
-- any-country version stops being a callable RPC at all.
drop function if exists my_wildcard();
drop function if exists reroll_wildcard();

create or replace function my_wildcard(p_country_code text default null)
returns table (
  wildcard_id uuid,
  location_id uuid,
  slug        text,
  name        text,
  rarity      rarity,
  difficulty  smallint,
  set_key     text,
  set_name    text,
  assigned_at timestamptz,
  expires_at  timestamptz,
  rerolled    boolean,
  claimed     boolean
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_today  date := (now() at time zone 'utc')::date;
  v_row    daily_wildcards%rowtype;
  v_pick   uuid;
begin
  select * into v_row from daily_wildcards
  where user_id = auth.uid() and wildcard_date = v_today;

  if not found then
    if p_country_code is not null then
      select l.id into v_pick
      from locations l
      where l.status = 'open'
        and not l.is_secret
        and l.country_code = p_country_code
        and not exists (
          select 1 from claims c where c.user_id = auth.uid() and c.location_id = l.id
        )
      order by l.pioneer_taken asc, random()
      limit 1;
    end if;

    -- Nothing left to pick (every open, non-secret location in the caller's
    -- country already claimed, the country is unknown, or it has none open
    -- at all) -- no row today rather than a nonsense repeat or a
    -- wrong-country pick.
    if v_pick is null then
      return;
    end if;

    insert into daily_wildcards (user_id, wildcard_date, location_id)
    values (auth.uid(), v_today, v_pick)
    returning * into v_row;
  end if;

  return query
  select
    v_row.id, l.id,
    case when v_row.claim_id is not null then l.slug end,
    case when v_row.claim_id is not null then l.name end,
    l.rarity, l.difficulty,
    case when v_row.claim_id is not null then s.key end,
    case when v_row.claim_id is not null then s.name end,
    v_row.assigned_at, v_row.assigned_at + interval '24 hours', v_row.rerolled,
    v_row.claim_id is not null
  from locations l
  left join location_sets s on s.id = l.set_id
  where l.id = v_row.location_id;
end;
$$;

revoke all on function my_wildcard(text) from public;
grant execute on function my_wildcard(text) to authenticated;

create or replace function reroll_wildcard(p_country_code text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_row   daily_wildcards%rowtype;
  v_pick  uuid;
begin
  select * into v_row from daily_wildcards
  where user_id = auth.uid() and wildcard_date = v_today
  for update;

  if not found then
    raise exception 'no wildcard assigned yet today' using errcode = 'P0001';
  end if;
  if v_row.rerolled then
    raise exception 'already rerolled today''s wildcard' using errcode = 'P0001';
  end if;
  if v_row.claim_id is not null then
    raise exception 'today''s wildcard is already claimed' using errcode = 'P0001';
  end if;

  if p_country_code is not null then
    select l.id into v_pick
    from locations l
    where l.status = 'open'
      and not l.is_secret
      and l.country_code = p_country_code
      and l.id <> v_row.location_id
      and not exists (
        select 1 from claims c where c.user_id = auth.uid() and c.location_id = l.id
      )
    order by l.pioneer_taken asc, random()
    limit 1;
  end if;

  if v_pick is null then
    raise exception 'nothing else to reroll to' using errcode = 'P0001';
  end if;

  update daily_wildcards set location_id = v_pick, rerolled = true where id = v_row.id;
end;
$$;

revoke all on function reroll_wildcard(text) from public;
grant execute on function reroll_wildcard(text) to authenticated;

commit;
