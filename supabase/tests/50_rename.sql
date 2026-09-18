-- Renaming: what the RPC accepts, what it stores, and who may call it.
--
-- Same harness as 40: identity switched through request.jwt.claim.sub between
-- steps, everything inside a transaction that rolls back, so this can point at
-- the throwaway database or a real project. What must NOT be possible is the
-- interesting part here: a one-letter name, a whitespace-only name, anything
-- over the cap, a caller with no profile -- and the name that comes back out
-- of the read API must be the normalised form, not whatever was sent.
\pset tuples_only on
\pset format unaligned

begin;
set local search_path = public, extensions;

do $$
declare
  v_user    uuid;
  v_stored  text;
begin
  select make_user('rename-' || floor(random() * 1e6)::int || '@t') into v_user;
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -------------------------------------------------------------------- happy path

  perform rename_display_name('   Aarav' || chr(9) || '   K   ');
  select display_name into v_stored from profiles where id = auth.uid();
  if v_stored <> 'Aarav K' then
    raise notice 'FAIL expected "Aarav K", got "%"', v_stored;
  else
    raise notice 'ok   whitespace collapses to "Aarav K"';
  end if;

  -- The read API derives initials from display_name live, so they follow.
  if (select initials from my_profile()) <> 'AK' then
    raise notice 'FAIL my_profile initials did not follow the rename';
  else
    raise notice 'ok   initials follow the rename';
  end if;

  -------------------------------------------------------------------- refusals

  begin
    perform rename_display_name('a');
    raise notice 'FAIL one-character name accepted';
  exception when others then
    raise notice 'ok   one-character name refused (%)', sqlerrm;
  end;

  begin
    perform rename_display_name('     ');
    raise notice 'FAIL whitespace-only name accepted';
  exception when others then
    raise notice 'ok   whitespace-only name refused (%)', sqlerrm;
  end;

  begin
    perform rename_display_name(repeat('x', 31));
    raise notice 'FAIL 31-character name accepted';
  exception when others then
    raise notice 'ok   over-cap name refused (%)', sqlerrm;
  end;

  begin
    perform rename_display_name(null);
    raise notice 'FAIL null accepted';
  exception when others then
    raise notice 'ok   null refused (%)', sqlerrm;
  end;

  -- The stored name survived every refusal above.
  select display_name into v_stored from profiles where id = auth.uid();
  if v_stored <> 'Aarav K' then
    raise notice 'FAIL failed renames changed the stored name to "%"', v_stored;
  else
    raise notice 'ok   refusals left the stored name untouched';
  end if;

  ------------------------------------------------------------- no profile case

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform rename_display_name('Ghost Walker');
    raise notice 'FAIL session without profile renamed something';
  exception when others then
    raise notice 'ok   no-profile session refused (%)', sqlerrm;
  end;
end;
$$;

rollback;
