-- Run only on a fresh/disposable project before real profile membership exists.
-- Profile IDs are unique; on a populated workspace this test intentionally fails rather than deleting real memberships.
-- Synthetic live-database smoke check. All rows roll back; no email is sent.
begin;
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.immi_memberships(user_id,profile_id) values('11111111-1111-4111-8111-111111111111','arash'),('22222222-2222-4222-8222-222222222222','amir');
insert into public.immi_profiles values('arash','11111111-1111-4111-8111-111111111111','{"id":"arash","cvText":"Synthetic CV only"}'),('amir','22222222-2222-4222-8222-222222222222','{"id":"amir","cvText":"Other synthetic CV"}');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$
declare result jsonb; n integer;
begin
  select count(*) into n from public.immi_profiles;
  if n<>1 then raise exception 'RLS profile isolation failed'; end if;
  select count(*) into n from public.immi_memberships;
  if n<>1 then raise exception 'RLS membership isolation failed'; end if;
  result:=public.immi_create_cv_version('Synthetic version');
  if result->>'profileId'<>'arash' then raise exception 'CV owner failed'; end if;
  result:=public.immi_save_preset('Synthetic','Hello','Not a sent message');
  if result->>'revision'<>'1' then raise exception 'Preset revision failed'; end if;
  begin
    insert into public.immi_settings values('amir','22222222-2222-4222-8222-222222222222','{}');
    raise exception 'Foreign write unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform * from public.immi_clinics;
    raise exception 'Anonymous data read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
