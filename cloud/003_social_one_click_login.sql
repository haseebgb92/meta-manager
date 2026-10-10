-- Passwordless cloud sign-in using a social account already connected in Meta Manager.
-- Only the backend can create, verify, or revoke sessions.
create table if not exists mm_private.social_identities (
 provider text not null check(provider in ('linkedin','instagram','facebook')),
 provider_subject text not null,
 owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(provider,provider_subject)
);
create table if not exists mm_private.cloud_sessions (
 session_hash text primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists mm_cloud_sessions_expiry on mm_private.cloud_sessions(expires_at);
revoke all on mm_private.social_identities, mm_private.cloud_sessions from public, anon, authenticated;
grant select, insert, update, delete on mm_private.social_identities, mm_private.cloud_sessions to service_role;
alter table mm_private.social_identities enable row level security;
alter table mm_private.cloud_sessions enable row level security;

create or replace function public.mm_identity_owner(p_provider text, p_subject text)
returns uuid language sql security definer set search_path='' as $$
 select owner_id from mm_private.social_identities
 where provider=p_provider and provider_subject=p_subject
$$;
create or replace function public.mm_register_identity(p_provider text, p_subject text, p_owner uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if p_provider not in ('linkedin','instagram','facebook') or length(p_subject)>200 or length(p_subject)<1 then
  raise exception 'Invalid identity';
 end if;
 insert into mm_private.social_identities(provider,provider_subject,owner_id)
 values(p_provider,p_subject,p_owner)
 on conflict(provider,provider_subject) do nothing;
 select owner_id into existing from mm_private.social_identities
 where provider=p_provider and provider_subject=p_subject;
 return existing;
end $$;
create or replace function public.mm_register_session(p_owner uuid,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if length(p_hash)!=64 or p_hash !~ '^[0-9a-f]+$' then
  raise exception 'Invalid session';
 end if;
 insert into mm_private.cloud_sessions(session_hash,owner_id,expires_at)
 values(p_hash,p_owner,now()+interval '60 days')
 on conflict(session_hash) do nothing;
end $$;
create or replace function public.mm_authenticate_session(p_hash text)
returns uuid language sql security definer set search_path='' as $$
 select owner_id from mm_private.cloud_sessions
 where session_hash=p_hash and revoked_at is null and expires_at>now()
$$;
create or replace function public.mm_revoke_session(p_hash text)
returns void language sql security definer set search_path='' as $$
 update mm_private.cloud_sessions set revoked_at=now() where session_hash=p_hash and revoked_at is null
$$;
revoke all on function public.mm_identity_owner(text,text) from public,anon,authenticated;
revoke all on function public.mm_register_identity(text,text,uuid) from public,anon,authenticated;
revoke all on function public.mm_register_session(uuid,text) from public,anon,authenticated;
revoke all on function public.mm_authenticate_session(text) from public,anon,authenticated;
revoke all on function public.mm_revoke_session(text) from public,anon,authenticated;
grant execute on function public.mm_identity_owner(text,text) to service_role;
grant execute on function public.mm_register_identity(text,text,uuid) to service_role;
grant execute on function public.mm_register_session(uuid,text) to service_role;
grant execute on function public.mm_authenticate_session(text) to service_role;
grant execute on function public.mm_revoke_session(text) to service_role;