-- Initial provisioning test; requires arash membership to be unclaimed. Never remove a real membership to rerun it.
-- Fully rolled-back synthetic test. Does not send verification mail.
begin;
update immi_private.approved_accounts set email='onboarding-test@example.invalid',profile_data='{"id":"arash","cvText":"Synthetic staged CV"}' where profile_id='arash';
insert into auth.users(id,email) values('33333333-3333-4333-8333-333333333333','onboarding-test@example.invalid');
do $$ begin
 if exists(select 1 from public.immi_memberships where user_id='33333333-3333-4333-8333-333333333333') then raise exception 'Unverified user provisioned'; end if;
end $$;
update auth.users set email_confirmed_at=now() where id='33333333-3333-4333-8333-333333333333';
do $$ begin
 if not exists(select 1 from public.immi_profiles where user_id='33333333-3333-4333-8333-333333333333' and data->>'cvText'='Synthetic staged CV') then raise exception 'Verified staged onboarding failed'; end if;
end $$;
rollback;
