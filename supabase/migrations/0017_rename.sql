-- Renaming: the display_name field on profiles.
--
-- An UPDATE policy already lets a session touch its own profile row, but that
-- door also opens explorer_number and home_city_id -- the permanent facts the
-- whole product rests on. Renaming goes through this SECURITY DEFINER function
-- instead, which can see only the name and normalises it before anything is
-- stored. The policy stays; nothing in this migration widens what a client
-- could write directly.
--
-- Validation is deliberately thin: trim, collapse whitespace runs to single
-- spaces, and a length window. No alphabet policing -- a name the user's own
-- keyboard cannot type is a bug, not an injection risk (text parameters are
-- parameterised all the way down).

create or replace function rename_display_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));

  if char_length(v_name) < 2 then
    raise exception 'Name must be at least 2 characters';
  end if;
  if char_length(v_name) > 30 then
    raise exception 'Name must be 30 characters or fewer';
  end if;

  update profiles set display_name = v_name where id = auth.uid();
  if not found then
    raise exception 'No profile exists for this session';
  end if;

  return v_name;
end;
$$;

revoke all on function rename_display_name(text) from public;
grant execute on function rename_display_name(text) to authenticated;
