-- Closure status on the read APIs (0020): a closed/seasonal location must
-- still be visible to the client, carrying its status_note, rather than
-- silently vanishing from set_locations() the way it did before this
-- migration. claim_location() rejecting it server-side already had
-- coverage via the client error path; this file is about what the client
-- can see *before* that rejection happens.
--
-- Same harness as 40/50/60: identity switched through request.jwt.claim.sub,
-- everything inside a transaction that rolls back.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_user       uuid;
  v_loc        uuid;
  v_set        uuid;
  v_trek       uuid;
  v_status     text;
  v_note       text;
  v_seen       boolean;
begin
  select id, set_id into v_loc, v_set from locations where slug = 'everestbasecamptrek';

  update locations set status = 'seasonal', status_note = 'Closed for the monsoon, reopens in October.'
   where id = v_loc;

  select make_user('status-' || floor(random() * 1e6)::int || '@t') into v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -------------------------------------------------------------------- locations_near

  select status, status_note into v_status, v_note
    from locations_near((select st_y(geom::geometry) from locations where id = v_loc),
                         (select st_x(geom::geometry) from locations where id = v_loc),
                         50)
   where id = v_loc;

  if v_status <> 'seasonal' or v_note is distinct from 'Closed for the monsoon, reopens in October.' then
    raise notice 'FAIL locations_near() status/status_note: got % / %', v_status, v_note;
  else
    raise notice 'ok   locations_near() returns status_note';
  end if;

  -------------------------------------------------------------------- set_locations

  v_seen := false;
  if v_set is not null then
    select (status, status_note) is not distinct from ('seasonal', 'Closed for the monsoon, reopens in October.')
      into v_seen
      from set_locations(v_set)
     where id = v_loc;
  end if;

  if v_set is null then
    raise notice 'skip set_locations() -- fixture location has no set_id';
  elsif v_seen is not true then
    raise notice 'FAIL set_locations() dropped or mis-stated the closed location';
  else
    raise notice 'ok   set_locations() still lists a closed location, with status_note';
  end if;

  -------------------------------------------------------------------- server backstop unchanged

  select make_trek(v_user, v_loc) into v_trek;

  begin
    perform claim_location(v_loc, v_trek);
    raise notice 'FAIL claim_location() accepted a non-open location';
  exception when others then
    if sqlerrm like 'location is closed:%' then
      raise notice 'ok   claim_location() still refuses it (%)', sqlerrm;
    else
      raise notice 'FAIL unexpected error: %', sqlerrm;
    end if;
  end;
end $$;

rollback;
