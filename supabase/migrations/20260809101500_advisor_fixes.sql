-- Advisor follow-ups.
--
-- platform_admins is deliberately left with RLS on and no policies: that is a
-- deny-all table, managed out of band. The advisor flags it as INFO; it is the
-- intended state, not an oversight.

-- btree_gist does not belong in public
alter extension btree_gist set schema extensions;

-- foreign keys the advisor found without a covering index
create index if not exists app_errors_user_idx    on public.app_errors   (user_id);
create index if not exists app_events_user_idx    on public.app_events   (user_id);
create index if not exists app_sessions_host_idx  on public.app_sessions (host_id);
create index if not exists app_sessions_user_idx  on public.app_sessions (user_id);
create index if not exists flats_building_idx     on public.flats        (building_id);
create index if not exists memberships_host_idx   on public.memberships  (host_id);
create index if not exists stays_created_by_idx   on public.stays        (created_by);
