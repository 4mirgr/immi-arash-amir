-- Administrative allowlist only; no actual email addresses in source control.
create schema if not exists immi_private;
revoke all on schema immi_private from public,anon,authenticated;
create table immi_private.approved_accounts (
  email text primary key check(email=lower(btrim(email)) and position('@' in email)>1),
  profile_id text not null unique check(profile_id in ('arash','amir'))
);
alter table immi_private.approved_accounts enable row level security;
revoke all on immi_private.approved_accounts from public,anon,authenticated;
-- Auth's verified email is the sole identity source, never editable user metadata.
-- This tightly scoped private function is elevated because auth triggers cannot
-- otherwise insert administrative-only membership/profile rows.
create function immi_private.provision_verified_account()
returns trigger language plpgsql security definer set search_path='' as $$
declare approved_profile text; display_name text; role_label text;
begin
  if new.email_confirmed_at is null or new.email is null or new.is_anonymous is true then return new; end if;
  select a.profile_id into approved_profile from immi_private.approved_accounts a where a.email=lower(btrim(new.email));
  if approved_profile is null then return new; end if;
  insert into public.immi_memberships(user_id,profile_id) values(new.id,approved_profile) on conflict do nothing;
  if not exists(select 1 from public.immi_memberships m where m.user_id=new.id and m.profile_id=approved_profile) then return new; end if;
  display_name:=case approved_profile when 'arash' then 'Dr Arash Entezar' else 'Dr Amir Houshang Gerami' end;
  role_label:=case approved_profile when 'arash' then 'GP / PESCI' else 'Internal medicine / specialist pathways' end;
  insert into public.immi_profiles(profile_id,user_id,data) values(approved_profile,new.id,pg_catalog.jsonb_build_object('id',approved_profile,'name',display_name,'role',role_label,'cvText','','verification','pending_documents')) on conflict do nothing;
  return new;
end $$;
revoke all on function immi_private.provision_verified_account() from public,anon,authenticated;
create trigger immi_on_verified_account
  after insert or update of email_confirmed_at on auth.users
  for each row execute function immi_private.provision_verified_account();
