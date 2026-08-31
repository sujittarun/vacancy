-- ─────────────────────────────────────────────────────────────────────────────
-- One shared log, and names to put on it
--
-- The book is run by two people who until now kept it in a shared spreadsheet.
-- A spreadsheet has one property this app did not: both of them can see what
-- the other just did. Three things stood in the way, and all three were
-- deliberate decisions that were right when they were made.
--
-- 1. Telemetry was readable only by the platform owner, on the reasoning that
--    "nothing about one host's usage can leak through a shared table". That
--    protects hosts from EACH OTHER, which still matters — so this does not
--    open telemetry. It opens exactly one thing: the activity events, to the
--    people whose own actions they are, scoped to their own host. Errors,
--    sessions, launches and screen views stay closed.
--
-- 2. A member could read only their own membership row. That is enough to know
--    which host you belong to and nothing else — so the app could see that
--    somebody else acted, and never who.
--
-- 3. There was nowhere to put a name. Two brothers share the manager role, so
--    "Manager did this" is ambiguous precisely between the two people who most
--    need telling apart. display_name is the label the log actually shows;
--    role stays the thing permissions are decided by.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── who each person is ───────────────────────────────────────────────────────
-- Nullable, and the app falls back to the role when it is unset, so an operator
-- added without one is still labelled rather than anonymous.
alter table public.memberships
  add column if not exists display_name text;

comment on column public.memberships.display_name is
  'The name the activity log shows for this person. Not an identity and not '
  'used for permissions — role does that. Null falls back to the role.';

-- ── a member may see who else is on their host ───────────────────────────────
-- Still host-scoped, so this tells you about the people you already work with
-- and nobody else. Without it the shared log can only ever say "someone else".
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (
    host_id in (select private.user_host_ids())
    or private.is_platform_admin()
  );

-- ── a member may read their own host's ACTIVITY, and only that ───────────────
-- `name = 'act'` is the whole of the opening. These are the rows the operator
-- wrote about their own work — "Booked Ramesh into LP-3" — and the ones the
-- other person needs to see. app_open, screen_view and every diagnostic event
-- remain admin-only, because they answer "why did it break", which is not a
-- question an operator is being asked to help with.
--
-- Policies are OR'd, so the existing admin-read policy is untouched and the
-- platform owner still sees everything.
drop policy if exists app_events_member_activity on public.app_events;
create policy app_events_member_activity on public.app_events
  for select to authenticated
  using (
    name = 'act'
    and host_id in (select private.user_host_ids())
  );

-- The activity read is by (host_id, name, created_at desc); the existing
-- app_events_host_time_idx covers host and time but leaves `name` to a filter
-- over every event the host has ever sent.
create index if not exists app_events_host_activity_idx
  on public.app_events (host_id, created_at desc)
  where name = 'act';
