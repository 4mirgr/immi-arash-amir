-- Run through administrative SQL access after migrations. Produces no roster data.
-- Each application role must be denied even before row filtering.
begin;
set local role authenticated;
do $$
begin
  perform 1 from immi_private.approved_accounts limit 1;
  raise exception 'FAIL: authenticated can read private roster';
exception when insufficient_privilege then
  null;
end $$;
set local role anon;
do $$
begin
  perform 1 from immi_private.approved_accounts limit 1;
  raise exception 'FAIL: anon can read private roster';
exception when insufficient_privilege then
  null;
end $$;
rollback;
