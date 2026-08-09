-- ─────────────────────────────────────────────────────────────────────────────
-- Remove a heartbeat that could never have beaten.
--
-- app_sessions carried last_seen_at and an UPDATE policy to maintain it. In
-- Postgres an UPDATE must first SELECT the row, and the only SELECT policy on
-- this table is the platform-admin one — so a host updating its own session
-- would have silently affected zero rows. No error, no change, and a column
-- that quietly stayed at its insert value forever.
--
-- The fix is not to widen the read policy. ops_host_usage already derives
-- last activity from max(app_events.created_at), which is the better source
-- anyway: it needs no extra round trip from a phone on one bar of signal, and
-- it cannot drift from the events it is meant to summarise.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists app_sessions_update on public.app_sessions;
alter table public.app_sessions drop column if exists last_seen_at;
