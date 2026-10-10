-- Meta Manager cloud scheduling — isolated from Advertpreneur Connect.
-- Supabase Free: no paid add-ons, no separate project.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

create schema if not exists mm_private;
revoke all on schema mm_private from public, anon, authenticated;
grant usage on schema mm_private to service_role;

create table if not exists mm_private.credentials (
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  provider text not null check(provider in ('facebook','instagram','linkedin')),
  token_encrypted bytea not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id, account_id, provider)
);
revoke all on mm_private.credentials from public, anon, authenticated;
grant select, insert, update, delete on mm_private.credentials to service_role;
alter table mm_private.credentials enable row level security;

create table if not exists public.mm_cloud_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  account_id text not null,
  provider text not null check(provider in ('facebook','instagram','linkedin')),
  provider_mode text not null default 'standard' check(provider_mode in ('standard','instagram_direct')),
  remote_account_id text not null,
  title text not null check (char_length(title) between 1 and 200),
  caption text not null default '',
  hashtags jsonb not null default '[]'::jsonb,
  media_url text,
  link_url text,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled'
    check(status in ('scheduled','publishing','published','failed','needs_review','cancelled')),
  attempts smallint not null default 0,
  lease_until timestamptz,
  last_error text,
  published_remote_id text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, source_id, provider)
);
alter table public.mm_cloud_posts enable row level security;
revoke all on public.mm_cloud_posts from anon, authenticated;
grant all on public.mm_cloud_posts to service_role;
create index if not exists mm_cloud_due on public.mm_cloud_posts(scheduled_for)
 where status='scheduled';
create index if not exists mm_cloud_owner on public.mm_cloud_posts(owner_id, created_at desc);

-- Protect encryption keys in Vault; do not return the generated values.
do $$
begin
  if not exists (select 1 from vault.secrets where name='mm_cloud_token_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'mm_cloud_token_key');
  end if;
  if not exists (select 1 from vault.secrets where name='mm_cloud_worker_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'mm_cloud_worker_key');
  end if;
end $$;

-- Service-role-only RPC: accepts tokens over HTTPS and encrypts at rest.
create or replace function public.mm_store_credential(
  p_owner uuid,p_account text,p_provider text,p_token text
) returns void language plpgsql security definer set search_path='' as $$
declare k text;
begin
  if length(p_token)<10 or length(p_token)>4096 or length(p_account)>180
    or p_provider not in ('facebook','instagram','linkedin') then
    raise exception 'Invalid credential';
  end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='mm_cloud_token_key';
  if k is null then raise exception 'Encryption not configured'; end if;
  insert into mm_private.credentials(owner_id,account_id,provider,token_encrypted)
  values(p_owner,p_account,p_provider,extensions.pgp_sym_encrypt(p_token,k))
  on conflict(owner_id,account_id,provider)
  do update set token_encrypted=excluded.token_encrypted,updated_at=now();
end $$;

create or replace function public.mm_get_credential(
  p_owner uuid,p_account text,p_provider text
) returns text language plpgsql security definer set search_path='' as $$
declare k text; encrypted bytea;
begin
  select token_encrypted into encrypted from mm_private.credentials
  where owner_id=p_owner and account_id=p_account and provider=p_provider;
  if encrypted is null then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name='mm_cloud_token_key';
  return extensions.pgp_sym_decrypt(encrypted,k);
end $$;

create or replace function public.mm_delete_credential(
  p_owner uuid,p_account text,p_provider text
) returns void language plpgsql security definer set search_path='' as $$
begin
  delete from mm_private.credentials
  where owner_id=p_owner and account_id=p_account and provider=p_provider;
  update public.mm_cloud_posts set status='cancelled',updated_at=now(),
    last_error='Publishing connection revoked'
  where owner_id=p_owner and account_id=p_account and provider=p_provider
    and status='scheduled';
end $$;

create or replace function public.mm_authorize_worker(p_key text)
returns boolean language sql security definer set search_path='' as $$
  select coalesce(length(p_key)=64 and p_key =
    (select decrypted_secret from vault.decrypted_secrets where name='mm_cloud_worker_key'),false)
$$;

-- Atomic leasing avoids two overlapping worker invocations publishing the same post.
create or replace function public.mm_claim_posts(p_limit int default 5)
returns setof public.mm_cloud_posts
language plpgsql security definer set search_path='' as $$
begin
  return query
  with picked as (
    select id from public.mm_cloud_posts
    where status='scheduled' and scheduled_for<=now()
    order by scheduled_for asc limit least(greatest(p_limit,1),5)
    for update skip locked
  )
  update public.mm_cloud_posts p set
    status='publishing', attempts=p.attempts+1,
    lease_until=now()+interval '3 minutes',updated_at=now()
  from picked where p.id=picked.id returning p.*;
end $$;

-- Do not retry a timed-out, ambiguous publish automatically: prevents duplicates.
create or replace function public.mm_expire_leases()
returns int language plpgsql security definer set search_path='' as $$
declare n int;
begin
  update public.mm_cloud_posts set status='needs_review',
    last_error='Publishing worker timed out; verify on social network before retrying',
    updated_at=now()
  where status='publishing' and lease_until<now();
  get diagnostics n=row_count;
  return n;
end $$;

-- Explicitly restrict privileged RPCs. PostgREST exposes public schema,
-- but only service_role can call these functions.
revoke all on function public.mm_store_credential(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.mm_get_credential(uuid,text,text) from public,anon,authenticated;
revoke all on function public.mm_delete_credential(uuid,text,text) from public,anon,authenticated;
revoke all on function public.mm_authorize_worker(text) from public,anon,authenticated;
revoke all on function public.mm_claim_posts(int) from public,anon,authenticated;
revoke all on function public.mm_expire_leases() from public,anon,authenticated;
grant execute on function public.mm_store_credential(uuid,text,text,text) to service_role;
grant execute on function public.mm_get_credential(uuid,text,text) to service_role;
grant execute on function public.mm_delete_credential(uuid,text,text) to service_role;
grant execute on function public.mm_authorize_worker(text) to service_role;
grant execute on function public.mm_claim_posts(int) to service_role;
grant execute on function public.mm_expire_leases() to service_role;

-- Public image hosting, write access scoped to authenticated user's folder.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mm-public-media','mm-public-media',true,10485760,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

create policy mm_media_upload on storage.objects for insert to authenticated
with check(bucket_id='mm-public-media'
 and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy mm_media_update on storage.objects for update to authenticated
using(bucket_id='mm-public-media'
 and (storage.foldername(name))[1]=(select auth.uid())::text)
with check(bucket_id='mm-public-media'
 and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy mm_media_delete on storage.objects for delete to authenticated
using(bucket_id='mm-public-media'
 and (storage.foldername(name))[1]=(select auth.uid())::text);

create policy mm_media_select on storage.objects for select to authenticated
using(bucket_id='mm-public-media'
 and (storage.foldername(name))[1]=(select auth.uid())::text);

-- The free-tier minute scheduler is activated separately after the worker
-- endpoint has been deployed and checked. No queue items are auto-enrolled.
