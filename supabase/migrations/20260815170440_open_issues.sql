-- ─────────────────────────────────────────────────────────────────────────────
-- Things wrong with a flat that is still perfectly sellable.
--
-- The previous migration put the fault on the BLOCK, which quietly assumed that
-- recording a problem means taking the flat off the market. Most of the time it
-- does not. A slow geyser, a dripping tap, patchy Wi-Fi, a loose cupboard door,
-- an AC due its six-month service — every one of those is worth writing down
-- and none of them is worth losing a night over.
--
-- Left as it was, the design had an actively harmful incentive: the only way to
-- record a fault was to block the flat, so an operator would either stop
-- recording the small things or block a sellable flat to make a note. The
-- second is worse; it destroys revenue to satisfy the software.
--
-- So an ISSUE is the unit of "something is wrong", and it occupies no nights.
-- A BLOCK is created only when the fix genuinely needs the flat off-market, and
-- then the issue points at it. Most issues never become blocks.
--
-- This cannot live in `stays`: every row there occupies a date range and is
-- policed by the no-overlap exclusion constraint, so an issue stored that way
-- would consume nights and could be refused for clashing with a guest.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.issues (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.hosts on delete cascade,
  flat_id      uuid not null references public.flats on delete cascade,
  fault        text,                       -- AC | Geyser | Plumbing | …
  note         text,
  urgency      text not null default 'soon'
                 check (urgency in ('whenever','soon','urgent')),
  reported_on  date not null default current_date,
  -- null while it is still open; the pair (fixed_on is null) is the whole query
  fixed_on     date,
  fixer        text,
  fixer_phone  text,
  cost         numeric(12,2),
  -- set when the fix did need the flat out of service, so the outage and the
  -- issue are one story rather than two records nobody joins up
  stay_id      uuid references public.stays on delete set null,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

-- "what is still open, oldest first" is the only hot query
create index if not exists issues_open_idx
  on public.issues (host_id, flat_id, reported_on)
  where fixed_on is null;

create index if not exists issues_fault_idx
  on public.issues (host_id, flat_id, fault);

alter table public.issues enable row level security;

create policy issues_read on public.issues
  for select to authenticated
  using ( host_id in (select private.user_host_ids()) );

create policy issues_insert on public.issues
  for insert to authenticated
  with check ( host_id in (select private.user_host_ids()) );

create policy issues_update on public.issues
  for update to authenticated
  using      ( host_id in (select private.user_host_ids()) )
  with check ( host_id in (select private.user_host_ids()) );

create policy issues_delete on public.issues
  for delete to authenticated
  using ( host_id in (select private.user_host_ids()) );
