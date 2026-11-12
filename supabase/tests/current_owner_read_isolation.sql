-- Read-only, rolled-back verification against the project's current two owners.
-- No profile contents, addresses, credentials or identifiers are returned.
begin;
do $$ begin
 if (select count(*) from public.immi_memberships where profile_id in ('arash','amir'))<>2 then
  raise exception 'Both provisioned owners are required for this audit';
 end if;
 perform set_config('immi_audit.arash', (select user_id::text from public.immi_memberships where profile_id='arash'), true);
 perform set_config('immi_audit.amir', (select user_id::text from public.immi_memberships where profile_id='amir'), true);
end $$;
set local role authenticated;
do $$
declare owner_value text; table_value text; foreign_visible boolean;
begin
 foreach owner_value in array array[current_setting('immi_audit.arash'),current_setting('immi_audit.amir')] loop
  perform set_config('request.jwt.claim.sub',owner_value,true);
  perform set_config('request.jwt.claims',json_build_object('sub',owner_value,'role','authenticated')::text,true);
  if (select count(*) from public.immi_memberships)<>1 then raise exception 'Membership read is not isolated'; end if;
  foreach table_value in array array['immi_memberships','immi_profiles','immi_cv_versions','immi_cv_defaults','immi_presets','immi_preset_defaults','immi_drafts','immi_settings'] loop
   execute format('select exists(select 1 from public.%I where user_id<>$1::uuid)',table_value) into foreign_visible using owner_value;
   if foreign_visible then raise exception 'Foreign owner visible in %',table_value; end if;
  end loop;
 end loop;
end $$;
rollback;
select 'PASS: both current owners see no foreign private rows' as audit_result;
