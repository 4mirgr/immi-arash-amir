-- Dedicated workspace only. No credentials or personal data. Provision membership
-- with privileged administrative SQL after verifying the actual user's identity.
create table public.immi_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_id text not null unique check (profile_id in ('arash','amir')),
  created_at timestamptz not null default now(),
  unique (user_id,profile_id)
);
create table public.immi_clinics (
  id text primary key check (id ~ '^cl_[a-f0-9]{20}$'),
  data jsonb not null check (jsonb_typeof(data)='object' and coalesce(data->>'id'=id,false)),
  updated_at timestamptz not null default now()
);
create table public.immi_profiles (
  profile_id text primary key,
  user_id uuid not null,
  data jsonb not null check (jsonb_typeof(data)='object' and coalesce(data->>'id'=profile_id,false)),
  foreign key(user_id,profile_id) references public.immi_memberships(user_id,profile_id) on delete cascade
);
create table public.immi_drafts (
  id uuid primary key,
  profile_id text not null,
  user_id uuid not null,
  data jsonb not null check (jsonb_typeof(data)='object' and coalesce(data->>'id'=id::text and data->>'profileId'=profile_id and data->>'status'='draft',false)),
  created_at timestamptz not null default now(),
  foreign key(user_id,profile_id) references public.immi_memberships(user_id,profile_id) on delete cascade
);
create table public.immi_settings (
  profile_id text primary key,
  user_id uuid not null,
  data jsonb not null check (jsonb_typeof(data)='object'),
  foreign key(user_id,profile_id) references public.immi_memberships(user_id,profile_id) on delete cascade
);
create index immi_drafts_owner_created on public.immi_drafts(user_id,created_at desc);
alter table public.immi_memberships enable row level security;
alter table public.immi_clinics enable row level security;
alter table public.immi_profiles enable row level security;
alter table public.immi_drafts enable row level security;
alter table public.immi_settings enable row level security;
-- Explicit grants are needed when automatic Data API grants are disabled.
revoke all on public.immi_memberships,public.immi_clinics,public.immi_profiles,public.immi_drafts,public.immi_settings from anon,authenticated;
grant select on public.immi_memberships,public.immi_clinics,public.immi_profiles to authenticated;
grant select,insert,update on public.immi_drafts,public.immi_settings to authenticated;
create policy membership_owner_read on public.immi_memberships for select to authenticated using ((select auth.uid())=user_id);
create policy clinic_member_read on public.immi_clinics for select to authenticated using (exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid())));
create policy profile_owner_read on public.immi_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy draft_owner_read on public.immi_drafts for select to authenticated using ((select auth.uid())=user_id);
create policy draft_owner_insert on public.immi_drafts for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid()) and m.profile_id=immi_drafts.profile_id));
create policy draft_owner_update on public.immi_drafts for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id and exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid()) and m.profile_id=immi_drafts.profile_id));
create policy settings_owner_read on public.immi_settings for select to authenticated using ((select auth.uid())=user_id);
create policy settings_owner_insert on public.immi_settings for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid()) and m.profile_id=immi_settings.profile_id));
create policy settings_owner_update on public.immi_settings for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id and exists(select 1 from public.immi_memberships m where m.user_id=(select auth.uid()) and m.profile_id=immi_settings.profile_id));
