-- Server-key-gated current account check. No personal data or secret is seeded.
create schema if not exists immi_automation_private;
revoke all on schema immi_automation_private from public, anon, authenticated;
create table immi_automation_private.server_keys (
 id text primary key check(id='membership'),
 key_sha256 text not null check(key_sha256 ~ '^[0-9a-f]{64}$')
);
alter table immi_automation_private.server_keys enable row level security;
revoke all on immi_automation_private.server_keys from public, anon, authenticated;

create function immi_automation_private.owner_active(p_owner uuid,p_profile text,p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
 if p_owner is null or p_profile is null or p_profile not in ('amir','arash')
    or p_key is null or p_key !~ '^[-A-Za-z0-9_]{32,256}$' then return false; end if;
 if not exists (
  select 1 from immi_automation_private.server_keys k
  where k.id='membership'
    and k.key_sha256=pg_catalog.encode(extensions.digest(p_key,'sha256'),'hex')
 ) then return false; end if;
 return exists (
  select 1 from public.immi_memberships m
  join auth.users u on u.id=m.user_id
  where m.user_id=p_owner and m.profile_id=p_profile
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=pg_catalog.now())
 );
end;
$$;
revoke all on function immi_automation_private.owner_active(uuid,text,text) from public, anon, authenticated;
grant usage on schema immi_automation_private to anon, authenticated;
grant execute on function immi_automation_private.owner_active(uuid,text,text) to anon, authenticated;

create function public.immi_automation_owner_active(p_owner uuid,p_profile text,p_key text)
returns boolean
language sql
security invoker
set search_path = ''
as $$ select immi_automation_private.owner_active(p_owner,p_profile,p_key); $$;
revoke all on function public.immi_automation_owner_active(uuid,text,text) from public, anon, authenticated;
grant execute on function public.immi_automation_owner_active(uuid,text,text) to anon, authenticated;
