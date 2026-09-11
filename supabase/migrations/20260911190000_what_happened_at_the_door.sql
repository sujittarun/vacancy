-- ── WHAT ACTUALLY HAPPENED AT THE DOOR ───────────────────────────────────────
-- Dates say when a guest is DUE in and due out; the app's clock said the rest —
-- after 14:00 the arriving guest was assumed in and the leaving guest assumed
-- gone. At half past seven the owner was still reading "arriving" on a room
-- whose guest had been in for hours, with no way to say otherwise.
--
-- Two timestamps, set by a manager's tap: when the guest was marked in, and
-- when they were marked out. Null is "not marked". For a departure the app
-- resolves null at check-out time; for an arrival it leaves the question open
-- and asks, because a no-show at eight in the evening is a fact worth knowing.
alter table public.stays
  add column if not exists checked_in_at  timestamptz,
  add column if not exists checked_out_at timestamptz;

comment on column public.stays.checked_in_at  is
  'When a manager marked the guest in. Null: not marked — expected, not assumed.';
comment on column public.stays.checked_out_at is
  'When a manager marked the guest out. Null: not marked; the app assumes gone at check-out time.';

-- ── the cleaner's day says whether the room has actually been vacated ────────
-- A return type cannot be changed in place, so the function is dropped and
-- recreated, and its grants said again — Postgres grants EXECUTE to PUBLIC on
-- every new function, which for a SECURITY DEFINER function is an open door.
drop function if exists public.staff_day(date);

create or replace function public.staff_day(on_day date default current_date)
returns table (
  flat_id      uuid,
  flat_code    text,
  unit_type    text,
  building_id  uuid,
  building     text,
  checking_out boolean,
  checking_in  boolean,
  left_at      timestamptz,   -- when the departing guest was marked out, if they were
  in_at        timestamptz    -- when the arriving guest was marked in, if they were
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
                  where s.flat_id = f.id and s.kind = 'booking' and s.starts_on = on_day),
         (select min(s.checked_out_at) from public.stays s
           where s.flat_id = f.id and s.kind = 'booking' and s.ends_on = on_day),
         (select min(s.checked_in_at) from public.stays s
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

revoke all on function public.staff_day(date) from public, anon;
grant execute on function public.staff_day(date) to authenticated;
