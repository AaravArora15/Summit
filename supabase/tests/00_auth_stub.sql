-- Local stand-in for the parts of Supabase this schema touches.
-- Supabase provides auth.users, auth.uid(), and the authenticated role.
create schema if not exists auth;

create table auth.users (
  -- No default, deliberately: the real auth.users has none, because GoTrue
  -- always supplies the id. Defaulting it here would let a fixture that omits
  -- the id pass locally and fail against Supabase.
  id         uuid primary key,
  email      text,
  -- Supabase populates this. claim_location() reads it for the new-account
  -- heuristic, so the stub has to carry it too or the fixture diverges from
  -- production in exactly the place a test would not notice.
  created_at timestamptz not null default now(),
  -- Where GoTrue puts whatever the provider said about the person: full_name
  -- from Apple, name from Google, and an empty object for an anonymous
  -- sign-in. handle_new_user() reads it to name the profile, so leaving it out
  -- here made every insert fail with "record new has no field
  -- raw_user_meta_data" -- locally only, which is the worst place for a schema
  -- difference to live.
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- auth.uid() reads a request-scoped setting on Supabase. Same idea here, so
-- tests can switch identity with set_config('request.jwt.claim.sub', ...).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  create role authenticated;
exception when duplicate_object then null;
end $$;

-- Supabase's other default PostgREST role, granted execute on locations_near()
-- since it serves an unauthenticated Explore screen.
do $$ begin
  create role anon;
exception when duplicate_object then null;
end $$;
