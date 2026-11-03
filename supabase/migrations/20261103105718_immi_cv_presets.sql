create table public.immi_cv_versions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, profile_id text not null,
  version integer not null check(version>0), data jsonb not null, text text not null,
  unique(profile_id,version), unique(id,user_id,profile_id),
  foreign key(user_id,profile_id) references public.immi_memberships(user_id,profile_id) on delete cascade
);
create table public.immi_cv_defaults (
  profile_id text primary key, user_id uuid not null, version_id uuid not null,
  foreign key(version_id,user_id,profile_id) references public.immi_cv_versions(id,user_id,profile_id) on delete cascade
);
create table public.immi_presets (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, profile_id text not null,
  name text not null, revision integer not null check(revision>0), data jsonb not null,
  unique(profile_id,name,revision), unique(id,user_id,profile_id),
  foreign key(user_id,profile_id) references public.immi_memberships(user_id,profile_id) on delete cascade
);
create table public.immi_preset_defaults (
  profile_id text primary key, user_id uuid not null, preset_id uuid not null,
  foreign key(preset_id,user_id,profile_id) references public.immi_presets(id,user_id,profile_id) on delete cascade
);
alter table public.immi_cv_versions enable row level security;
alter table public.immi_cv_defaults enable row level security;
alter table public.immi_presets enable row level security;
alter table public.immi_preset_defaults enable row level security;
revoke all on public.immi_cv_versions,public.immi_cv_defaults,public.immi_presets,public.immi_preset_defaults from anon,authenticated;
grant select,insert on public.immi_cv_versions,public.immi_presets to authenticated;
grant select,insert,update on public.immi_cv_defaults,public.immi_preset_defaults to authenticated;
create policy cv_owner_read on public.immi_cv_versions for select to authenticated using((select auth.uid())=user_id);
create policy cv_owner_insert on public.immi_cv_versions for insert to authenticated with check((select auth.uid())=user_id and exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid()) and m.profile_id=immi_cv_versions.profile_id));
create policy preset_owner_read on public.immi_presets for select to authenticated using((select auth.uid())=user_id);
create policy preset_owner_insert on public.immi_presets for insert to authenticated with check((select auth.uid())=user_id and exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid()) and m.profile_id=immi_presets.profile_id));
create policy cv_default_owner_read on public.immi_cv_defaults for select to authenticated using((select auth.uid())=user_id);
create policy cv_default_owner_insert on public.immi_cv_defaults for insert to authenticated with check((select auth.uid())=user_id);
create policy cv_default_owner_update on public.immi_cv_defaults for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy preset_default_owner_read on public.immi_preset_defaults for select to authenticated using((select auth.uid())=user_id);
create policy preset_default_owner_insert on public.immi_preset_defaults for insert to authenticated with check((select auth.uid())=user_id);
create policy preset_default_owner_update on public.immi_preset_defaults for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
-- Invoker RPCs use current authenticated role and RLS, never elevated privileges.
-- Advisory transaction locks make per-profile revision allocation atomic.
create function public.immi_create_cv_version(p_name text,p_expected_hash text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p text; source jsonb; cv_text text; digest text; next_version integer; new_id uuid; result jsonb;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]' then raise exception 'Invalid template name' using errcode='22023'; end if;
  select profile_id into p from public.immi_memberships where user_id=auth.uid();
  if p is null then raise exception 'Membership required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':cv',0));
  select data into source from public.immi_profiles where user_id=auth.uid() and profile_id=p;
  cv_text:=source->>'cvText';
  if cv_text is null or btrim(cv_text)='' or char_length(cv_text)>200000 then raise exception 'Import a CV before saving a version' using errcode='22023'; end if;
  digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(cv_text,'UTF8')),'hex');
  if p_expected_hash is not null and p_expected_hash<>digest then raise exception 'CV source changed; refresh first' using errcode='22023'; end if;
  select coalesce(max(version),0)+1 into next_version from public.immi_cv_versions where profile_id=p;
  new_id:=pg_catalog.gen_random_uuid();
  result:=pg_catalog.jsonb_build_object('id',new_id,'profileId',p,'version',next_version,'name',btrim(p_name),'sourceHash',digest,'sourceFilename',coalesce(source->>'cvSource',''),'verification',coalesce(source->>'verification','user_supplied_unverified'),'createdAt',pg_catalog.now());
  insert into public.immi_cv_versions(id,user_id,profile_id,version,data,text) values(new_id,auth.uid(),p,next_version,result,cv_text);
  return result||'{"isDefault":false}'::jsonb;
end $$;
revoke all on function public.immi_create_cv_version(text,text) from public,anon;
grant execute on function public.immi_create_cv_version(text,text) to authenticated;
create function public.immi_save_preset(p_name text,p_subject text,p_body text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p text; next_revision integer; new_id uuid; result jsonb;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 or p_subject is null or char_length(btrim(p_subject)) not between 1 and 500 or p_subject ~ E'[\\r\\n]' or p_body is null or char_length(btrim(p_body)) not between 1 and 50000 then raise exception 'Invalid preset content' using errcode='22023'; end if;
  select profile_id into p from public.immi_memberships where user_id=auth.uid();
  if p is null then raise exception 'Membership required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':preset',0));
  select coalesce(max(revision),0)+1 into next_revision from public.immi_presets where profile_id=p and name=btrim(p_name);
  new_id:=pg_catalog.gen_random_uuid();
  result:=pg_catalog.jsonb_build_object('id',new_id,'name',btrim(p_name),'revision',next_revision,'subject',btrim(p_subject),'body',btrim(p_body),'createdAt',pg_catalog.now());
  insert into public.immi_presets(id,user_id,profile_id,name,revision,data) values(new_id,auth.uid(),p,btrim(p_name),next_revision,result);
  return result;
end $$;
revoke all on function public.immi_save_preset(text,text,text) from public,anon;
grant execute on function public.immi_save_preset(text,text,text) to authenticated;
