-- Deleting one saved template version is owner-only. Existing composite FK
-- deletes only its default pointer; prepared mail keeps its immutable snapshot.
grant delete on public.immi_presets to authenticated;
create policy preset_owner_delete on public.immi_presets
for delete to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.immi_memberships m
    where m.user_id = (select auth.uid())
      and m.profile_id = immi_presets.profile_id
  )
);
