-- ─────────────────────────────────────────────────────────────────────────────
-- The three money tables the app kept to itself
--
-- Bookings, payments, flats and issues were wired to travel. Expenses, the
-- standing cost model and the revenue an operator types for a building his
-- workbook does not price were not — they lived in localStorage on one phone,
-- so "we both see the same book" would have been true of the calendar and
-- false of every figure on the Business tab.
--
-- All three are keyed by (host, building) rather than by flat: they are
-- property-level money, which is how the operator thinks about them and how
-- the Costing sheet is written.
-- ─────────────────────────────────────────────────────────────────────────────

-- A one-off, on the day it happened. The date is the point: an expense belongs
-- to the month it was paid in and to no other.
create table if not exists public.expenses (
  id          uuid primary key,
  host_id     uuid not null references public.hosts on delete cascade,
  building_id uuid references public.buildings on delete set null,
  line        text not null,
  amount      numeric(12,2) not null check (amount > 0),
  paid_on     date not null,
  note        text,
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists expenses_host_month_idx
  on public.expenses (host_id, paid_on desc);

-- What a building costs in a normal month, and what KIND of cost each line is
-- (fixed / varies / one-off). One row per line per building.
create table if not exists public.cost_lines (
  host_id     uuid not null references public.hosts on delete cascade,
  building_id uuid not null references public.buildings on delete cascade,
  line        text not null,
  amount      numeric(12,2) not null check (amount >= 0),
  kind        text not null default 'varies' check (kind in ('fixed','varies','one-off')),
  updated_at  timestamptz not null default now(),
  primary key (host_id, building_id, line)
);

-- What a building took in a given month, typed by the operator for the
-- buildings the monthly sheets do not price.
create table if not exists public.revenue_months (
  host_id     uuid not null references public.hosts on delete cascade,
  building_id uuid not null references public.buildings on delete cascade,
  month       text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount      numeric(12,2) not null check (amount >= 0),
  updated_at  timestamptz not null default now(),
  primary key (host_id, building_id, month)
);

alter table public.expenses       enable row level security;
alter table public.cost_lines     enable row level security;
alter table public.revenue_months enable row level security;

-- Same rule as every other tenant table: you see and touch your own host's
-- rows, nobody else's. private.user_host_ids() is defined in the RLS migration.
do $$
declare t text;
begin
  foreach t in array array['expenses','cost_lines','revenue_months'] loop
    execute format($f$
      create policy %1$s_rw on public.%1$s
        for all to authenticated
        using      ( host_id in (select private.user_host_ids()) )
        with check ( host_id in (select private.user_host_ids()) );
    $f$, t);
  end loop;
end $$;
