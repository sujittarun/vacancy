-- ─────────────────────────────────────────────────────────────────────────────
-- Operator views — "how is each app doing?"
--
-- security_invoker so they inherit the caller's RLS. Since only platform
-- admins can select the underlying telemetry, these return nothing to a host.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.ops_host_usage
with (security_invoker = true) as
select
  h.id                                         as host_id,
  h.name                                       as host,
  date_trunc('day', e.created_at)::date        as day,
  count(*)                                     as events,
  count(distinct e.session_id)                 as sessions,
  count(distinct e.user_id)                    as users
from public.app_events e
join public.hosts h on h.id = e.host_id
group by 1,2,3;

create or replace view public.ops_host_errors
with (security_invoker = true) as
select
  h.id                                         as host_id,
  h.name                                       as host,
  e.message,
  e.app_version,
  count(*)                                     as hits,
  min(e.created_at)                            as first_seen,
  max(e.created_at)                            as last_seen
from public.app_errors e
left join public.hosts h on h.id = e.host_id
group by 1,2,3,4;

create or replace view public.ops_feature_use
with (security_invoker = true) as
select
  h.name                                       as host,
  e.name                                       as feature,
  count(*)                                     as uses,
  max(e.created_at)                            as last_used
from public.app_events e
join public.hosts h on h.id = e.host_id
group by 1,2;
