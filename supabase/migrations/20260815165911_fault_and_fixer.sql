-- ─────────────────────────────────────────────────────────────────────────────
-- What broke, and who fixed it.
--
-- The operator's real question is never "show me the work orders". It is "why
-- does this AC keep failing, and who touched it last?" — asked at the moment
-- the flat goes out of service again.
--
-- So this adds NO tables. A block already IS the work order: the flat is out,
-- there is a reason and a note, and it has a start and an end. Giving blocks a
-- fault and a person is two more taps in a flow the operator already runs;
-- a separate maintenance record would mean entering the same event twice, and
-- that is the tax that kills every tool of this kind.
--
-- Everything worth knowing is then derived rather than stored:
--
--   repeat fault   same flat + same fault, previous block's end within N days
--   came back      that previous block had a fixer → their work did not hold
--   true cost      cost + (nights blocked × the flat's rate)
--
-- The industry name for the third of these is first-time fix rate; below ~72%
-- a contractor costs about 2.4x in labour because they keep coming back. The
-- operator here does not need the acronym, only the flag.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.stays
  add column if not exists fault       text,     -- AC | Geyser | Plumbing | Electrical | …
  add column if not exists fixer       text,     -- a person, usually independent, not a firm
  add column if not exists fixer_phone text,
  add column if not exists cost        numeric(12,2);   -- what the visit cost, when known

comment on column public.stays.fault is
  'What broke. Set on blocks only. The pair (flat_id, fault) is what makes a repeat visible.';
comment on column public.stays.cost is
  'What the repair cost. Deliberately separate from amount, which is booking revenue — summing the two together would be nonsense.';

-- Finding "the last time this flat had this fault" is the hot path: it runs
-- while the operator is still choosing nights, and it must feel instant.
create index if not exists stays_fault_idx
  on public.stays (host_id, flat_id, fault, ends_on desc)
  where fault is not null;

-- And "everything this person has touched", for the scorecard.
create index if not exists stays_fixer_idx
  on public.stays (host_id, fixer)
  where fixer is not null;
