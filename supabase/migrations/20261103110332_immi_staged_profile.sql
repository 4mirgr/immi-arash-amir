-- Store optional pre-imported profile material in the unexposed administrative
-- roster. Actual documents, names, CV text and email addresses are seeded
-- privately by the project owner and never included in this migration.
alter table immi_private.approved_accounts
  add column profile_data jsonb,
  add constraint approved_profile_data_shape check (
    profile_data is null or
    (jsonb_typeof(profile_data)='object' and
     coalesce(profile_data->>'id'=profile_id,false))
  );
create or replace function immi_private.provision_verified_account()
returns trigger language plpgsql security definer set search_path='' as $$
declare approved_profile text; staged_profile jsonb; display_name text; role_label text; initial_profile jsonb;
begin
  if new.email_confirmed_at is null or new.email is null or new.is_anonymous is true then return new; end if;
  select a.profile_id,a.profile_data into approved_profile,staged_profile
    from immi_private.approved_accounts a
    where a.email=lower(btrim(new.email));
  if approved_profile is null then return new; end if;
  insert into public.immi_memberships(user_id,profile_id)
    values(new.id,approved_profile) on conflict do nothing;
  if not exists(select 1 from public.immi_memberships m where m.user_id=new.id and m.profile_id=approved_profile) then return new; end if;
  display_name:=case approved_profile when 'arash' then 'Dr Arash Entezar' else 'Dr Amir Houshang Gerami' end;
  role_label:=case approved_profile when 'arash' then 'GP / PESCI' else 'Internal medicine / specialist pathways' end;
  initial_profile:=coalesce(staged_profile,pg_catalog.jsonb_build_object(
    'id',approved_profile,'name',display_name,'role',role_label,
    'cvText','','verification','pending_documents'));
  -- The approved administrative binding always wins over staged JSON identity.
  initial_profile:=initial_profile||pg_catalog.jsonb_build_object('id',approved_profile);
  insert into public.immi_profiles(profile_id,user_id,data)
    values(approved_profile,new.id,initial_profile) on conflict do nothing;
  return new;
end $$;
revoke all on function immi_private.provision_verified_account() from public,anon,authenticated;
-- CREATE OR REPLACE preserves the existing trigger and its invocation grants.
