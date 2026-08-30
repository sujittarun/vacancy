-- ─────────────────────────────────────────────────────────────────────────────
-- Let a signed-out app report on itself
--
-- The telemetry tables have existed since the first migration and nothing has
-- ever written to them, because the only insert policy required `authenticated`
-- and the app ships with CLOUD_ENABLED = false — nobody signs in, so nobody
-- could report. An operator hits a bug on a phone in another city and there is
-- no way to see what the app did.
--
-- These three tables are the one thing the app says to a server. They carry no
-- guest data by construction: names, notes, phones, rates and amounts never
-- enter them — only counts, flags, ids and a per-install uuid. That is what
-- makes an anonymous insert safe here and nowhere else in this schema.
--
-- Reading is unchanged: still platform admins only, via the ops_ views. The
-- Supabase dashboard bypasses RLS, which is how the owner actually reads them.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['app_sessions','app_events','app_errors'] loop
    execute format($f$
      -- anon may only file rows that belong to nobody. A row claiming a host is
      -- a row claiming an identity, and that still needs a real session.
      create policy %1$s_anon_insert on public.%1$s
        for insert to anon
        with check ( host_id is null );
    $f$, t);
  end loop;
end $$;

-- The heartbeat updates a session row it created while signed out, so it needs
-- to be able to find its own row. Scoped to rows with no host and no user, which
-- are exactly the anonymous ones.
create policy app_sessions_anon_update on public.app_sessions
  for update to anon
  using      ( host_id is null and user_id is null )
  with check ( host_id is null and user_id is null );

comment on table public.app_events is
  'Behavioural events. Counts, flags and ids only — never guest data. Anonymous inserts allowed with host_id null.';
