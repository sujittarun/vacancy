-- ─────────────────────────────────────────────────────────────────────────────
-- Stays Platform — core schema
--
-- ONE database, MANY hosts. A host (Crescent Stays) is a row, not a project.
-- Every domain row carries host_id and Row Level Security makes cross-host
-- reads impossible. This is what lets the platform owner answer "how is each
-- app doing" with a single query instead of federating N databases.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists btree_gist;

-- ── tenants ──────────────────────────────────────────────────────────────────
create table public.hosts (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- who may see which host
create table public.memberships (
  user_id     uuid not null references auth.users on delete cascade,
  host_id     uuid not null references public.hosts on delete cascade,
  role        text not null default 'staff' check (role in ('owner','manager','staff')),
  created_at  timestamptz not null default now(),
  primary key (user_id, host_id)
);

-- the app's operator (you), who may read telemetry across every host but no
-- host's guest data
create table public.platform_admins (
  user_id     uuid primary key references auth.users on delete cascade,
  created_at  timestamptz not null default now()
);

-- ── inventory ────────────────────────────────────────────────────────────────
create table public.buildings (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.hosts on delete cascade,
  code        text not null,                       -- TT
  name        text not null,                       -- TreeTops
  short_name  text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (host_id, code)
);

create table public.flats (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.hosts on delete cascade,
  building_id   uuid not null references public.buildings on delete cascade,
  code          text not null,                     -- TT-101
  floor         int  not null default 1,
  unit_type     text not null,                     -- Studio | 1 BHK | 2 BHK | 3 BHK
  nightly_rate  numeric(10,2),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (host_id, code)
);

-- ── stays: bookings AND blocks in one table ──────────────────────────────────
-- Every availability question has to consider both, so splitting them would
-- only mean joining them back together in every query. `kind` separates them.
-- ends_on is EXCLUSIVE: a guest occupies nights [starts_on, ends_on) and leaves
-- the morning of ends_on, which is what makes same-day turnarounds expressible.
create table public.stays (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.hosts on delete cascade,
  flat_id     uuid not null references public.flats on delete cascade,
  kind        text not null default 'booking' check (kind in ('booking','block')),
  starts_on   date not null,
  ends_on     date not null,
  guest_name  text,
  source      text,                                -- Airbnb | Direct | Walk-in …
  reason      text,                                -- blocks: Maintenance | Deep clean …
  note        text,
  rate        numeric(10,2),
  booked_on   date,                                -- when taken → real lead time
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  constraint stays_dates_ordered check (ends_on > starts_on)
);

-- The database, not the screen, is the authority on double-booking. With two
-- phones in play the app cannot be trusted to enforce this on its own.
alter table public.stays
  add constraint stays_no_overlap
  exclude using gist (
    flat_id with =,
    daterange(starts_on, ends_on, '[)') with &&
  );

create index stays_host_dates_idx on public.stays (host_id, starts_on, ends_on);
create index flats_host_idx       on public.flats (host_id);
create index buildings_host_idx   on public.buildings (host_id);
