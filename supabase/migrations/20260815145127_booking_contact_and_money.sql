-- ─────────────────────────────────────────────────────────────────────────────
-- Who the guest is, and where the money actually is.
--
-- The app has been a calendar. To take real bookings it needs two things it
-- has never held: a way to reach the guest, and the truth about payment.
--
-- PHONE IS IDENTITY. Not because you ring it — because it is the only stable
-- key a walk-in, a repeat guest and a platform booking all share. Name spelling
-- varies, email is often absent. A returning guest is found by number.
--
-- MONEY HAS THREE STATES, NOT TWO. Almost every booking tool models "paid" and
-- "unpaid", which makes platform bookings read as unpaid forever: the guest HAS
-- paid, just not to the operator. An operator who is shown a false "unpaid"
-- twice stops believing the field at all. So a payment records its method, and
-- 'Platform' means the money is settled by the guest and owed to the operator
-- by Airbnb or Booking.com. That one column separates:
--
--   in hand        sum of payments where method <> 'Platform'
--   with platform  sum of payments where method  = 'Platform'
--   due from guest amount - sum(all payments)
--
-- No extra flags, no second table, and the operator never types any of it —
-- the booking source picks the default.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.stays
  add column if not exists guest_phone text,
  add column if not exists pax         int,
  add column if not exists amount      numeric(12,2);   -- total agreed for the whole stay

comment on column public.stays.amount is
  'Total agreed for the stay, not per night. Long stays are discounted as a whole, which is how the number is actually negotiated.';

-- Repeat guests are found by number, and this index is what makes the lookup
-- instant while the operator is still typing it on a call.
create index if not exists stays_host_phone_idx
  on public.stays (host_id, guest_phone)
  where guest_phone is not null;

-- ── payments ─────────────────────────────────────────────────────────────────
-- A list, not a running total, because "how much has this guest paid" is a far
-- less useful question than "what came in this month, and through which pipe".
-- Most stays will hold one or two rows.
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.hosts on delete cascade,
  stay_id      uuid not null references public.stays on delete cascade,
  amount       numeric(12,2) not null,        -- negative is a refund
  method       text not null default 'Cash'
                 check (method in ('Cash','UPI','Bank','Card','Platform')),
  received_on  date not null default current_date,
  note         text,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  constraint payments_nonzero check (amount <> 0)
);

create index if not exists payments_stay_idx on public.payments (stay_id);
create index if not exists payments_host_date_idx on public.payments (host_id, received_on desc);

alter table public.payments enable row level security;

-- Same tenancy rule as every other domain table: scoped by host, and UPDATE
-- carries WITH CHECK as well as USING so a row cannot be moved to another host
-- on the way out.
create policy payments_read on public.payments
  for select to authenticated
  using ( host_id in (select private.user_host_ids()) );

create policy payments_insert on public.payments
  for insert to authenticated
  with check ( host_id in (select private.user_host_ids()) );

create policy payments_update on public.payments
  for update to authenticated
  using      ( host_id in (select private.user_host_ids()) )
  with check ( host_id in (select private.user_host_ids()) );

create policy payments_delete on public.payments
  for delete to authenticated
  using ( host_id in (select private.user_host_ids()) );
