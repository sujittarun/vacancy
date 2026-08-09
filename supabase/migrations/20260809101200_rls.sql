-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- This is what makes one shared database as safe as separate ones: a host can
-- only ever see rows carrying its own host_id, enforced by Postgres rather
-- than by the application remembering to filter.
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- Helpers live in a NON-exposed schema. They are security definer so the
-- membership lookup itself does not re-trigger RLS (which would recurse), and
-- because they are outside `public` they are not callable through the API.
create or replace function private.user_host_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select host_id from public.memberships where user_id = (select auth.uid())
$$;

create or replace function private.is_platform_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.platform_admins where user_id = (select auth.uid())
  )
$$;

alter table public.hosts            enable row level security;
alter table public.memberships      enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.buildings        enable row level security;
alter table public.flats            enable row level security;
alter table public.stays            enable row level security;
alter table public.app_sessions     enable row level security;
alter table public.app_events       enable row level security;
alter table public.app_errors       enable row level security;

-- ── hosts ────────────────────────────────────────────────────────────────────
create policy hosts_read on public.hosts
  for select to authenticated
  using ( id in (select private.user_host_ids()) or private.is_platform_admin() );

-- ── memberships: you may see your own rows only ──────────────────────────────
create policy memberships_read on public.memberships
  for select to authenticated
  using ( user_id = (select auth.uid()) or private.is_platform_admin() );

-- ── platform_admins: closed. Managed out of band, never through the API. ─────
-- No policies, so RLS denies everything to anon/authenticated by default.

-- ── inventory and stays: scoped to the caller's host ─────────────────────────
-- UPDATE carries WITH CHECK as well as USING, or a row could be reassigned to
-- another host on the way out.
do $$
declare t text;
begin
  foreach t in array array['buildings','flats','stays'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated
        using ( host_id in (select private.user_host_ids()) );

      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check ( host_id in (select private.user_host_ids()) );

      create policy %1$s_update on public.%1$s
        for update to authenticated
        using      ( host_id in (select private.user_host_ids()) )
        with check ( host_id in (select private.user_host_ids()) );

      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using ( host_id in (select private.user_host_ids()) );
    $f$, t);
  end loop;
end $$;

-- ── telemetry: the app writes, only the platform owner reads ─────────────────
-- A host cannot read even its own telemetry, so nothing about one host's usage
-- can leak through a shared table.
do $$
declare t text;
begin
  foreach t in array array['app_sessions','app_events','app_errors'] loop
    execute format($f$
      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check (
          host_id is null or host_id in (select private.user_host_ids())
        );

      create policy %1$s_admin_read on public.%1$s
        for select to authenticated
        using ( private.is_platform_admin() );
    $f$, t);
  end loop;
end $$;

-- sessions get a heartbeat, so the app must be able to update its own row
create policy app_sessions_update on public.app_sessions
  for update to authenticated
  using      ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );
