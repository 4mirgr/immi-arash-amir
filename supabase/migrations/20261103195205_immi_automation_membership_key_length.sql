-- PostgreSQL regex repetition bounds stop at255; enforce key length separately.
create or replace function immi_automation_private.owner_active(p_owner uuid,p_profile text,p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
 if p_owner is null or p_profile is null or p_profile not in ('amir','arash')
    or p_key is null or pg_catalog.char_length(p_key)<32 or pg_catalog.char_length(p_key)>256
    or p_key !~ '^[-A-Za-z0-9_]+$' then return false; end if;
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
