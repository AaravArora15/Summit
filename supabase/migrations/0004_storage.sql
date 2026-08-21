-- Photo storage for claims.
--
-- claim_location() refuses a secret spot without a photo, and until now nothing
-- could supply one: there was no bucket. This creates it.
--
-- The whole file is conditional on the `storage` schema existing, because that
-- schema is provided by Supabase and is absent from a plain local Postgres.
-- Guarding it means the migration set stays runnable end to end in tests
-- instead of needing a "skip this one locally" note that someone will miss.
-- Wrapped in a single transaction with `set local search_path`, rather than a
-- bare session-level SET at the top.
--
-- The reason is connection pooling. Supabase's direct connection is IPv6-only
-- on the free tier, so many networks can only reach the transaction pooler,
-- and in transaction mode each statement can land on a different backend. A
-- session-level SET would then apply to one statement and be gone for the next,
-- and every reference to `geography` or `st_dwithin` after it would fail. One
-- transaction pins the whole file to one backend, and `set local` scopes the
-- path to exactly that transaction.
begin;
set local search_path = public, extensions;

do $$
begin
  if to_regnamespace('storage') is null then
    raise notice 'storage schema not present (local Postgres); skipping bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'claim-photos',
    'claim-photos',
    false,                      -- private: a secret spot photo is evidence, not a gallery
    5 * 1024 * 1024,            -- 5 MB, enough for a phone JPEG at the trailhead
    array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
  )
  on conflict (id) do nothing;

  -- Paths are "<user-id>/<trek-id>.jpg". Keying the policy on the first path
  -- segment is what stops one user writing into another's folder, so the client
  -- must not be free to choose the prefix.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'own claim photos: upload'
  ) then
    create policy "own claim photos: upload" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'claim-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'own claim photos: read'
  ) then
    create policy "own claim photos: read" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'claim-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;

commit;
