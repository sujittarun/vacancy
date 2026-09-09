-- ─────────────────────────────────────────────────────────────────────────────
-- Turnarounds, and the people who do them
--
-- A flat between two guests is the only part of this business that is neither
-- a booking nor a repair, and it is the part with a deadline measured in
-- minutes: a check-out at eleven and a check-in at three is four hours, and
-- sometimes it is thirty minutes. Until now the app could say a turnaround was
-- COMING — the decide board has raised them for months — and had no idea
-- whether one had HAPPENED.
--
-- Three tables and one rule.
--
--   check_items    what has to be verified, per flat type, because a studio
--                  has no second bedroom and asking about one teaches staff
--                  to tick without reading
--   turnarounds    one flat, one day: waiting -> cleaning -> ready
--   turn_checks    one tick, with the person, the time, and a photo where the
--                  owner has asked for one
--
-- THE RULE: a staff account can see the day's work and nothing else. Not a
-- rate, not an amount, not a balance, not another building. This is enforced
-- the same way host isolation is — in Postgres, not in the app.
--
-- HOW THE STAFF ROLE IS MADE SAFE, and why it is done this way. Every existing
-- policy on buildings, flats, stays, payments, expenses, cost_lines and
-- revenue_months is written as `host_id in (select private.user_host_ids())`.
-- The cheapest correct way to keep a cleaner out of all of them is therefore
-- not to edit nine policies — each an opportunity to get one wrong and open
-- the book — but to make user_host_ids() itself return nothing for a staff
-- membership. For an owner or a manager the function's output is byte for byte
-- what it was, so their access is unchanged by construction rather than by
-- inspection.
--
-- Staff then reach exactly three things, through policies written below that
-- name the role explicitly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── the roles that own the book ──────────────────────────────────────────────
-- 'staff' is deliberately absent. A membership with that role belongs to the
-- host, appears in the log, and grants nothing through any pre-existing policy.
create or replace function private.user_host_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select host_id from public.memberships
   where user_id = (select auth.uid())
     and coalesce(role, 'manager') in ('owner', 'manager')
$$;

comment on function private.user_host_ids is
  'The hosts whose BOOK the caller may read. Staff memberships are excluded on '
  'purpose: everything a cleaner may see is granted by its own policy, so no '
  'money or guest balance can reach them through a host-wide rule.';

-- ── a member can always read their own membership row ────────────────────────
-- It was host-scoped alone, which now excludes staff from seeing even that
-- they are staff — and the app needs to read its own role to know which screen
-- to open. Managers and the owner are unaffected: their host branch still
-- matches, and this only adds their own row, which they could already see.
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or host_id in (select private.user_host_ids())
    or private.is_platform_admin()
  );

-- ── which buildings a person covers ──────────────────────────────────────────
-- Null means every building of the host, which is what an owner or a manager
-- has always had. A staff account is created against one building.
alter table public.memberships
  add column if not exists building_ids uuid[];

comment on column public.memberships.building_ids is
  'The buildings this membership may act in. Null means all of the host''s. '
  'Only meaningful for role = staff; owners and managers cover everything.';

create or replace function private.staff_host_id()
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
  select host_id from public.memberships
   where user_id = (select auth.uid()) and role = 'staff'
   limit 1
$$;

-- The buildings a staff caller may act in. Empty for anybody who is not staff,
-- so every policy below is closed to non-staff and opened again, explicitly,
-- by the manager branch that sits beside it.
create or replace function private.staff_building_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select b.id
    from public.memberships m
    join public.buildings b on b.host_id = m.host_id
   where m.user_id = (select auth.uid())
     and m.role = 'staff'
     and (m.building_ids is null or b.id = any(m.building_ids))
$$;

-- ── what has to be checked, per flat type ────────────────────────────────────
create table if not exists public.check_items (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null references public.hosts(id) on delete cascade,
  unit_type   text not null,
  label       text not null,
  needs_photo boolean not null default false,
  sort        integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists check_items_host_type_idx
  on public.check_items (host_id, unit_type) where active;

comment on table public.check_items is
  'The turnaround checklist, per flat type. needs_photo is the owner saying '
  'this one is worth a camera; the rest are a tick.';

-- ── one flat, one day ────────────────────────────────────────────────────────
create table if not exists public.turnarounds (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references public.hosts(id) on delete cascade,
  flat_id    uuid not null references public.flats(id) on delete cascade,
  day        date not null,
  state      text not null default 'waiting'
             check (state in ('waiting', 'cleaning', 'ready')),
  started_at timestamptz,
  ready_at   timestamptz,
  by_user    uuid,
  note       text,
  created_at timestamptz not null default now(),
  unique (flat_id, day)
);
create index if not exists turnarounds_host_day_idx on public.turnarounds (host_id, day);

comment on table public.turnarounds is
  'A cleaning job. Derived from the book — a check-out creates the need — but '
  'stored, because the book cannot say whether anybody has been.';

-- ── one tick ─────────────────────────────────────────────────────────────────
-- `label` is a SNAPSHOT. The owner will edit the checklist, and a tick has to
-- keep saying what was actually checked on the day rather than following the
-- item's current wording, or last month's record quietly rewrites itself.
create table if not exists public.turn_checks (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.hosts(id) on delete cascade,
  turnaround_id uuid not null references public.turnarounds(id) on delete cascade,
  item_id       uuid references public.check_items(id) on delete set null,
  label         text not null,
  done_at       timestamptz not null default now(),
  by_user       uuid,
  photo_path    text,
  unique (turnaround_id, item_id)
);
create index if not exists turn_checks_turn_idx on public.turn_checks (turnaround_id);

alter table public.check_items  enable row level security;
alter table public.turnarounds  enable row level security;
alter table public.turn_checks  enable row level security;

-- ── the checklist: managers write it, staff read it ──────────────────────────
create policy check_items_read on public.check_items
  for select to authenticated
  using (
    host_id in (select private.user_host_ids())
    or host_id = private.staff_host_id()
  );
create policy check_items_write on public.check_items
  for insert to authenticated
  with check ( host_id in (select private.user_host_ids()) );
create policy check_items_update on public.check_items
  for update to authenticated
  using      ( host_id in (select private.user_host_ids()) )
  with check ( host_id in (select private.user_host_ids()) );
create policy check_items_delete on public.check_items
  for delete to authenticated
  using ( host_id in (select private.user_host_ids()) );

-- ── the jobs: a manager sees every one, a cleaner only their buildings ───────
create policy turnarounds_read on public.turnarounds
  for select to authenticated
  using (
    host_id in (select private.user_host_ids())
    or flat_id in (select f.id from public.flats f
                    where f.building_id in (select private.staff_building_ids()))
  );
create policy turnarounds_insert on public.turnarounds
  for insert to authenticated
  with check (
    host_id in (select private.user_host_ids())
    or flat_id in (select f.id from public.flats f
                    where f.building_id in (select private.staff_building_ids()))
  );
-- USING and WITH CHECK both, or a cleaner could move a job onto a flat in a
-- building they do not cover on the way out.
create policy turnarounds_update on public.turnarounds
  for update to authenticated
  using (
    host_id in (select private.user_host_ids())
    or flat_id in (select f.id from public.flats f
                    where f.building_id in (select private.staff_building_ids()))
  )
  with check (
    host_id in (select private.user_host_ids())
    or flat_id in (select f.id from public.flats f
                    where f.building_id in (select private.staff_building_ids()))
  );
-- Deleting a job is a manager's act. A cleaner marks it, never removes it.
create policy turnarounds_delete on public.turnarounds
  for delete to authenticated
  using ( host_id in (select private.user_host_ids()) );

-- ── the ticks ────────────────────────────────────────────────────────────────
create policy turn_checks_read on public.turn_checks
  for select to authenticated
  using (
    host_id in (select private.user_host_ids())
    or turnaround_id in (
      select t.id from public.turnarounds t
       join public.flats f on f.id = t.flat_id
      where f.building_id in (select private.staff_building_ids()))
  );
create policy turn_checks_insert on public.turn_checks
  for insert to authenticated
  with check (
    host_id in (select private.user_host_ids())
    or turnaround_id in (
      select t.id from public.turnarounds t
       join public.flats f on f.id = t.flat_id
      where f.building_id in (select private.staff_building_ids()))
  );
create policy turn_checks_update on public.turn_checks
  for update to authenticated
  using (
    host_id in (select private.user_host_ids())
    or turnaround_id in (
      select t.id from public.turnarounds t
       join public.flats f on f.id = t.flat_id
      where f.building_id in (select private.staff_building_ids()))
  )
  with check (
    host_id in (select private.user_host_ids())
    or turnaround_id in (
      select t.id from public.turnarounds t
       join public.flats f on f.id = t.flat_id
      where f.building_id in (select private.staff_building_ids()))
  );
create policy turn_checks_delete on public.turn_checks
  for delete to authenticated
  using (
    host_id in (select private.user_host_ids())
    or turnaround_id in (
      select t.id from public.turnarounds t
       join public.flats f on f.id = t.flat_id
      where f.building_id in (select private.staff_building_ids()))
  );

-- ── what a cleaner is allowed to know about the day ──────────────────────────
-- The one thing staff need from the book and the only thing they get: which of
-- their flats has somebody out today, whether somebody is coming in behind
-- them, and at what hour the room has to be ready. No guest name, no source,
-- no nights, and above all no amount — a cleaner has no business knowing what
-- a room sold for, and this is the join that would have told them.
--
-- SECURITY DEFINER on purpose: the caller has no rights on `stays` at all, and
-- this is the whole of the exception. It filters by the caller's own buildings
-- inside the body, so it cannot be used to read another building's day, and it
-- lives in `public` only because PostgREST cannot reach anywhere else.
create or replace function public.staff_day(on_day date default current_date)
returns table (
  flat_id     uuid,
  flat_code   text,
  unit_type   text,
  building_id uuid,
  building    text,
  checking_out boolean,
  checking_in  boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select f.id, f.code, f.unit_type, f.building_id, b.name,
         exists (select 1 from public.stays s
                  where s.flat_id = f.id and s.kind = 'booking' and s.ends_on = on_day),
         exists (select 1 from public.stays s
                  where s.flat_id = f.id and s.kind = 'booking' and s.starts_on = on_day)
    from public.flats f
    join public.buildings b on b.id = f.building_id
   where f.building_id in (select private.staff_building_ids())
     and f.active
     and (
       exists (select 1 from public.stays s
                where s.flat_id = f.id and s.kind = 'booking' and s.ends_on = on_day)
       or exists (select 1 from public.stays s
                   where s.flat_id = f.id and s.kind = 'booking' and s.starts_on = on_day)
     )
   order by f.code
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, which for a
-- SECURITY DEFINER function in `public` is an open endpoint. Close it, then
-- open it to signed-in callers only — the body already refuses anyone whose
-- staff_building_ids() is empty.
revoke all on function public.staff_day(date) from public, anon;
grant execute on function public.staff_day(date) to authenticated;

-- ── the flats a cleaner may name ─────────────────────────────────────────────
-- Codes and types for their own buildings, and no nightly_rate.
create or replace function public.staff_flats()
returns table (id uuid, code text, unit_type text, building_id uuid, building text)
language sql
security definer
set search_path = ''
stable
as $$
  select f.id, f.code, f.unit_type, f.building_id, b.name
    from public.flats f
    join public.buildings b on b.id = f.building_id
   where f.building_id in (select private.staff_building_ids())
     and f.active
   order by f.code
$$;
revoke all on function public.staff_flats() from public, anon;
grant execute on function public.staff_flats() to authenticated;

-- ── photos ───────────────────────────────────────────────────────────────────
-- Private bucket. Nothing is world-readable: the app asks for a signed URL,
-- which is what keeps a photograph of somebody's flat off the open internet.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('turn-photos', 'turn-photos', false, 6291456,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Paths are `<host_id>/<turnaround_id>/<check_id>.jpg`, so the first segment
-- is the tenant and every rule below is a comparison against it.
drop policy if exists turn_photos_read on storage.objects;
create policy turn_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'turn-photos'
    and (
      (storage.foldername(name))[1]::uuid in (select private.user_host_ids())
      or (storage.foldername(name))[1]::uuid = private.staff_host_id()
    )
  );

drop policy if exists turn_photos_write on storage.objects;
create policy turn_photos_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'turn-photos'
    and (
      (storage.foldername(name))[1]::uuid in (select private.user_host_ids())
      or (storage.foldername(name))[1]::uuid = private.staff_host_id()
    )
  );

-- A photograph is evidence. Nobody deletes one through the app — not the
-- cleaner who took it, and not the manager reading it — so there is no delete
-- policy here at all, and the default denies it.
