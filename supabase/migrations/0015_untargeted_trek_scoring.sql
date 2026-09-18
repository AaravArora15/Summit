-- Summit: a trek with no target still has to count.
--
-- syncTrek() (features/trek/sync.ts) already handles locationId: null and its
-- own comment already says "the walk still counts for distance, time, and the
-- league" — but nothing in the schema backed that up. Every point Summit has
-- ever awarded runs through award_claim_points() (0012), which is an AFTER
-- INSERT trigger on `claims`. No claim, no trigger, no points, regardless of
-- how far or how honestly someone walked. And treks.status — the column the
-- league's own trek counter (apply_trek_to_league(), 0005) and the
-- personal-best comparison in award_claim_points() both key off — is never
-- set to 'validated' anywhere in this schema at all, targeted or not. That
-- second half is the same root bug and affects the primary claim flow too,
-- so this migration closes both rather than leaving an inconsistency where
-- an untargeted walk counts toward the league and a claimed one does not.
--
-- Split into two independent paths to *becoming* validated, and one shared
-- trigger for what happens once a trek gets there:
--
--   1. claim_location() (redefined below, otherwise identical to 0003's
--      version) now marks the trek validated on a successful claim.
--   2. validate_trek(), new here, is what an untargeted trek calls once it
--      finishes: the same track-integrity checks claim_location() already
--      does that do not require a target location (minimum point count, no
--      mocked fixes, no implausible speed) — there is nothing to dwell-check
--      or trail-coverage-check without a place to check it against.
--
-- Either path ending in status = 'validated' fires the same trigger below,
-- which is what actually inserts the distance/moving_time points. That
-- trigger duplicates award_claim_points()'s trek-level block rather than
-- refactoring it out: award_claim_points() also reuses its multiplier
-- computation for claim-level rows (badge, new_route), so extracting just
-- the trek-level piece would mean threading multipliers back out through a
-- return value — more surface area for an unrelated regression than
-- duplicating four constants and a formula that is not going to drift
-- (the unique index from 0012 makes whichever path gets there first win;
-- the other is a harmless no-op).

begin;
set local search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- What happens once a trek becomes validated
-- ---------------------------------------------------------------------------

create or replace function award_trek_activity_points()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- Same rates and multiplier formula as award_claim_points() (0012) —
  -- see that migration's header for where these numbers came from.
  c_xp_per_300m     constant integer := 20;
  c_xp_per_minute   constant integer := 4;
  c_mo_per_300m     constant integer := 28;
  c_mo_per_minute   constant integer := 8;

  c_pb_mult_xp      constant numeric := 1.5;
  c_pb_mult_monthly constant numeric := 2.0;
  c_partner_mult    constant numeric := 1.2;
  c_streak_mult     constant numeric := 2.0;
  c_multiplier_cap  constant numeric := 3.0;

  v_is_pb   boolean;
  v_streak3 boolean;
  v_mult_xp numeric;
  v_mult_mo numeric;
begin
  if new.status <> 'validated' or coalesce(old.status, 'recording') = 'validated' then
    return new;
  end if;

  v_is_pb := coalesce(new.distance_m, 0) > coalesce((
    select max(distance_m) from treks
    where user_id = new.user_id and status = 'validated' and id <> new.id
  ), 0);

  v_streak3 :=
    exists (
      select 1 from treks t
      where t.user_id = new.user_id and t.status = 'validated'
        and date_trunc('day', t.started_at) = date_trunc('day', new.started_at) - interval '1 day'
    )
    and exists (
      select 1 from treks t
      where t.user_id = new.user_id and t.status = 'validated'
        and date_trunc('day', t.started_at) = date_trunc('day', new.started_at) - interval '2 days'
    );

  v_mult_xp := least(c_multiplier_cap,
    (case when v_is_pb then c_pb_mult_xp else 1 end) *
    (case when new.with_partner then c_partner_mult else 1 end));

  v_mult_mo := least(c_multiplier_cap,
    (case when v_is_pb then c_pb_mult_monthly else 1 end) *
    (case when new.with_partner then c_partner_mult else 1 end) *
    (case when v_streak3 then c_streak_mult else 1 end));

  if coalesce(new.distance_m, 0) >= 100 then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.id, null, 'distance', 'xp',
            round(floor(new.distance_m / 300)::integer * c_xp_per_300m * v_mult_xp)::integer)
    on conflict do nothing;

    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.id, null, 'distance', 'monthly',
            round(floor(new.distance_m / 300)::integer * c_mo_per_300m * v_mult_mo)::integer)
    on conflict do nothing;
  end if;

  if coalesce(new.moving_time_s, 0) >= 60 then
    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.id, null, 'moving_time', 'xp',
            round(floor(new.moving_time_s / 60)::integer * c_xp_per_minute * v_mult_xp)::integer)
    on conflict do nothing;

    insert into points_ledger (user_id, trek_id, claim_id, source, system, amount)
    values (new.user_id, new.id, null, 'moving_time', 'monthly',
            round(floor(new.moving_time_s / 60)::integer * c_mo_per_minute * v_mult_mo)::integer)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_trek_validated_activity_points on treks;
create trigger on_trek_validated_activity_points
  after update of status on treks
  for each row execute function award_trek_activity_points();

-- ---------------------------------------------------------------------------
-- Path 1: a successful claim validates its trek
-- ---------------------------------------------------------------------------
-- Identical to 0003's claim_location() with one addition at the end: marking
-- the trek validated, which is what makes the league's trek counter and the
-- personal-best comparison above actually see it.

create or replace function claim_location(
  p_location_id uuid,
  p_trek_id uuid,
  p_photo_path text default null
)
returns table (
  claim_id       uuid,
  pioneer_number integer,
  edition        text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  c_default_radius_m   constant integer := 90;
  c_dwell_seconds      constant integer := 45;
  c_min_dwell_points   constant integer := 3;
  c_max_accuracy_m     constant real    := 60;
  c_max_speed_mps      constant real    := 6.0;
  c_min_track_points   constant integer := 10;
  c_alt_below_dem_m    constant real    := 60;
  c_alt_above_dem_m    constant real    := 45;

  c_max_claims_per_hour constant integer := 5;

  c_flag_straightness  constant real := 0.80;
  c_flag_coverage      constant real := 0.50;
  c_flag_clipping      constant real := 0.10;
  c_flag_cadence_cv    constant real := 0.05;
  c_flag_new_account_h constant integer := 24;

  v_user_id     uuid := auth.uid();
  v_location    locations%rowtype;
  v_trek        treks%rowtype;
  v_radius_m    integer;
  v_dwell_count integer;
  v_dwell_span  integer;
  v_mocked      integer;
  v_points      integer;
  v_max_speed   real;
  v_coverage    real;
  v_straight    real;
  v_clipping    real;
  v_alt_spread  real;
  v_cadence     real;
  v_alt         real;
  v_alt_delta   real;
  v_age_days    integer;
  v_recent      integer;
  v_flags       text[] := '{}';
  v_number      integer;
  v_claim_id    uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_location from locations where id = p_location_id for update;
  if not found then
    raise exception 'unknown location' using errcode = 'P0002';
  end if;

  if v_location.status <> 'open' then
    raise exception 'location is closed: %', coalesce(v_location.status_note, v_location.status)
      using errcode = 'P0001';
  end if;

  if exists (select 1 from claims where user_id = v_user_id and location_id = p_location_id) then
    raise exception 'you have already claimed %', v_location.name using errcode = 'P0001';
  end if;

  select * into v_trek from treks where id = p_trek_id and user_id = v_user_id;
  if not found then
    raise exception 'trek does not belong to caller' using errcode = '42501';
  end if;

  if v_location.is_secret and p_photo_path is null then
    raise exception 'secret spots require a photo' using errcode = 'P0001';
  end if;

  select count(*) into v_recent
  from claims where user_id = v_user_id and claimed_at > now() - interval '1 hour';

  if v_recent >= c_max_claims_per_hour then
    raise exception 'too many claims in the last hour, try again shortly'
      using errcode = 'P0001';
  end if;

  select count(*) into v_points from trek_points where trek_id = p_trek_id;
  if v_points < c_min_track_points then
    raise exception 'track too short to be a trek' using errcode = 'P0001';
  end if;

  select count(*) into v_mocked from trek_points where trek_id = p_trek_id and is_mocked;
  if v_mocked > 0 then
    raise exception 'mocked location reported' using errcode = 'P0001';
  end if;

  select max(speed) into v_max_speed
  from (
    select st_distance(geom, lag(geom) over w)
           / nullif(extract(epoch from recorded_at - lag(recorded_at) over w), 0) as speed
    from trek_points where trek_id = p_trek_id
    window w as (order by recorded_at)
  ) legs;

  if v_max_speed > c_max_speed_mps then
    raise exception 'implausible speed on track' using errcode = 'P0001';
  end if;

  v_radius_m := coalesce(v_location.arrival_radius_m, c_default_radius_m);

  select count(*),
         coalesce(extract(epoch from max(recorded_at) - min(recorded_at)), 0),
         avg(altitude_m)
    into v_dwell_count, v_dwell_span, v_alt
  from trek_points
  where trek_id = p_trek_id
    and coalesce(accuracy_m, 0) <= c_max_accuracy_m
    and st_dwithin(geom, v_location.geom, v_radius_m);

  if v_dwell_count < c_min_dwell_points or v_dwell_span < c_dwell_seconds then
    raise exception 'did not dwell at the location' using errcode = 'P0001';
  end if;

  if v_location.elevation_m is not null and v_alt is not null then
    v_alt_delta := v_alt - v_location.elevation_m;
    if v_alt_delta < -c_alt_below_dem_m or v_alt_delta > c_alt_above_dem_m then
      raise exception 'reported altitude does not match the terrain' using errcode = 'P0001';
    end if;
  end if;

  v_coverage   := track_trail_coverage(p_trek_id, p_location_id);
  v_straight   := track_straightness(p_trek_id, p_location_id);
  v_clipping   := track_clipping(p_trek_id, p_location_id);
  v_alt_spread := track_altitude_spread(p_trek_id);
  v_cadence    := track_cadence_regularity(p_trek_id);

  if v_straight is not null and v_straight > c_flag_straightness then
    v_flags := v_flags || format('straight track (%s)', round(v_straight::numeric, 3));
  end if;

  if v_coverage is not null and v_coverage < c_flag_coverage then
    v_flags := v_flags || format('low trail coverage (%s)', round(v_coverage::numeric, 3));
  end if;

  if v_clipping is not null and v_clipping > c_flag_clipping then
    v_flags := v_flags || format('crosses buildings or water off-path (%s)', round(v_clipping::numeric, 3));
  end if;

  if v_alt_spread is not null and v_alt_spread = 0 then
    v_flags := v_flags || 'altitude identical on every fix'::text;
  end if;

  if v_cadence is not null and v_cadence < c_flag_cadence_cv then
    v_flags := v_flags || format('machine-regular fix timing (cv %s)', round(v_cadence::numeric, 4));
  end if;

  if v_trek.device_integrity in ('rooted', 'emulator') then
    v_flags := v_flags || ('device reports ' || v_trek.device_integrity)::text;
  end if;

  select extract(day from now() - u.created_at)::integer into v_age_days
  from auth.users u where u.id = v_user_id;

  if v_location.rarity in ('epic', 'legendary')
     and exists (
       select 1 from auth.users u
       where u.id = v_user_id and u.created_at > now() - make_interval(hours => c_flag_new_account_h)
     ) then
    v_flags := v_flags || format('account under %sh old claiming %s', c_flag_new_account_h, v_location.rarity);
  end if;

  if v_location.pioneer_taken < v_location.pioneer_cap then
    update locations set pioneer_taken = pioneer_taken + 1
     where id = p_location_id returning pioneer_taken into v_number;
  else
    v_number := null;
  end if;

  insert into claims (user_id, location_id, trek_id, pioneer_number, photo_path)
  values (v_user_id, p_location_id, p_trek_id, v_number, p_photo_path)
  returning id into v_claim_id;

  insert into claim_signals (
    claim_id, trail_coverage, straightness, max_speed_mps, point_count,
    altitude_delta, clipping, altitude_spread, cadence_cv,
    device_integrity, account_age_days, flagged, flag_reason
  )
  values (
    v_claim_id, v_coverage, v_straight, v_max_speed, v_points,
    v_alt_delta, v_clipping, v_alt_spread, v_cadence,
    v_trek.device_integrity, v_age_days,
    array_length(v_flags, 1) is not null,
    array_to_string(v_flags, '; ')
  );

  -- The one addition over 0003's version: a claim is proof enough that this
  -- trek was real, so it is what finally sets the status the league counter
  -- and the personal-best comparison above have been waiting on.
  update treks set status = 'validated' where id = p_trek_id and status <> 'validated';

  return query
  select v_claim_id, v_number,
         case when v_number is null then 'explorer' else 'pioneer' end;
end;
$$;

revoke all on function claim_location(uuid, uuid, text) from public;
grant execute on function claim_location(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Path 2: an untargeted trek validates itself
-- ---------------------------------------------------------------------------

create or replace function validate_trek(p_trek_id uuid)
returns table (status trek_status, reason text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  -- The subset of claim_location()'s hard checks that do not require a
  -- target location: nothing here can dwell-check or trail-coverage-check
  -- against a place that was never named.
  c_max_speed_mps    constant real    := 6.0;
  c_min_track_points constant integer := 10;

  v_user_id   uuid := auth.uid();
  v_trek      treks%rowtype;
  v_points    integer;
  v_mocked    integer;
  v_max_speed real;
  v_reason    text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_trek from treks where id = p_trek_id and user_id = v_user_id;
  if not found then
    raise exception 'trek does not belong to caller' using errcode = '42501';
  end if;

  -- Idempotent: a retried client call after a flaky connection returns
  -- whatever was already decided rather than re-running the checks.
  if v_trek.status in ('validated', 'rejected') then
    return query select v_trek.status, null::text;
    return;
  end if;

  select count(*) into v_points from trek_points where trek_id = p_trek_id;
  if v_points < c_min_track_points then
    v_reason := 'track too short to be a trek';
  end if;

  if v_reason is null then
    select count(*) into v_mocked from trek_points where trek_id = p_trek_id and is_mocked;
    if v_mocked > 0 then
      v_reason := 'mocked location reported';
    end if;
  end if;

  if v_reason is null then
    select max(speed) into v_max_speed
    from (
      select st_distance(geom, lag(geom) over w)
             / nullif(extract(epoch from recorded_at - lag(recorded_at) over w), 0) as speed
      from trek_points where trek_id = p_trek_id
      window w as (order by recorded_at)
    ) legs;

    if v_max_speed > c_max_speed_mps then
      v_reason := 'implausible speed on track';
    end if;
  end if;

  if v_reason is not null then
    update treks set status = 'rejected' where id = p_trek_id;
    return query select 'rejected'::trek_status, v_reason;
    return;
  end if;

  update treks set status = 'validated' where id = p_trek_id;
  return query select 'validated'::trek_status, null::text;
end;
$$;

revoke all on function validate_trek(uuid) from public;
grant execute on function validate_trek(uuid) to authenticated;

commit;
