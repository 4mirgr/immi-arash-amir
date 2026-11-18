-- Minimal owner writing snapshot for the already authorized background worker.
-- This is not a session, a service-role key, a send approval or a CV update.
create function immi_automation_private.writing_context(p_owner uuid,p_profile text,p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 p jsonb;
 c record;
begin
 if p_profile is distinct from 'arash'
    or not immi_automation_private.owner_active(p_owner,p_profile,p_key) then
   return null;
 end if;
 select pr.data into p from public.immi_profiles pr
 where pr.user_id=p_owner and pr.profile_id=p_profile;
 if p is null then return null; end if;
 select v.id,v.version,v.text,(d.version_id is not null) as is_default
 into c
 from public.immi_cv_versions v
 left join public.immi_cv_defaults d
   on d.user_id=v.user_id and d.profile_id=v.profile_id and d.version_id=v.id
 where v.user_id=p_owner and v.profile_id=p_profile
 order by (d.version_id is not null) desc,v.version desc limit 1;
 return pg_catalog.jsonb_build_object(
  'ownerId',p_owner,'profileId',p_profile,
  'profile',pg_catalog.jsonb_build_object(
   'name',p->'name',
   'planning',pg_catalog.jsonb_build_object(
    'gpApplicationWriting',p#>'{planning,gpApplicationWriting}',
    'gpGoals',p#>'{planning,gpGoals}')),
  'cv',case when c.id is null then null else pg_catalog.jsonb_build_object(
    'id',c.id,'version',c.version,'text',pg_catalog.left(c.text,200000),
    'isDefault',c.is_default) end,
  'snapshotAt',pg_catalog.now(),'transportApproved',false);
end;
$$;
revoke all on function immi_automation_private.writing_context(uuid,text,text) from public,anon,authenticated;
grant execute on function immi_automation_private.writing_context(uuid,text,text) to anon,authenticated;

create function public.immi_automation_writing_context(p_owner uuid,p_profile text,p_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select immi_automation_private.writing_context(p_owner,p_profile,p_key); $$;
revoke all on function public.immi_automation_writing_context(uuid,text,text) from public,anon,authenticated;
grant execute on function public.immi_automation_writing_context(uuid,text,text) to anon,authenticated;
