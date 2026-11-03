-- Small revision check instead of repeatedly downloading all clinic contacts.
create index immi_clinics_updated_desc on public.immi_clinics(updated_at desc);
create function public.immi_dataset_revision()
returns text language sql stable security invoker set search_path='' as $$
  select coalesce(max(c.updated_at)::text,'empty') from public.immi_clinics c;
$$;
revoke all on function public.immi_dataset_revision() from public,anon;
grant execute on function public.immi_dataset_revision() to authenticated;
-- Cover owner/default composite foreign keys for ownership lookups and cascades.
create index immi_cv_defaults_version_owner on public.immi_cv_defaults(version_id,user_id,profile_id);
create index immi_cv_versions_owner_profile on public.immi_cv_versions(user_id,profile_id);
create index immi_drafts_owner_profile on public.immi_drafts(user_id,profile_id);
create index immi_preset_defaults_version_owner on public.immi_preset_defaults(preset_id,user_id,profile_id);
create index immi_presets_owner_profile on public.immi_presets(user_id,profile_id);
create index immi_profiles_owner_profile on public.immi_profiles(user_id,profile_id);
create index immi_settings_owner_profile on public.immi_settings(user_id,profile_id);
