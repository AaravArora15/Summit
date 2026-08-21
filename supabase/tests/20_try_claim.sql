\pset tuples_only on
\pset format unaligned
create or replace function try_claim(p_user uuid, p_trek uuid, p_loc uuid)
returns text language plpgsql
set search_path = public, extensions
as $$
declare r record;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  select * into r from claim_location(p_loc, p_trek) limit 1;
  return 'ACCEPTED  pioneer=' || coalesce(r.pioneer_number::text,'null') || ' ' || r.edition;
exception when others then
  return 'rejected  ' || sqlerrm;
end; $$;
