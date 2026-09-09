-- ─────────────────────────────────────────────────────────────────────────────
-- A tick is a record of what was checked, not a pointer at a list
--
-- turn_checks.item_id was declared `references check_items(id) on delete set
-- null`, and that is wrong in two ways that only show up in use.
--
-- THE ONE THAT BREAKS IT ON DAY ONE. The app falls back to a starter checklist
-- until an owner opens the editor and saves one — deliberately, because an
-- owner who has never touched the editor should not find a list they did not
-- write. Those starter items are computed, identically on every phone, from
-- the flat type and the label; they are not rows. So the first tick anybody
-- makes on a fresh property carries an item_id that check_items has never
-- heard of, the insert comes back 23503, and the tick is dropped: the cleaner
-- sees it ticked on their own phone and the manager never sees it at all.
-- check_items is empty in production right now, so this is every tick.
--
-- THE ONE UNDERNEATH IT. `label` on this table is already a snapshot, and the
-- comment on it says why: the owner will edit the checklist, and a tick has to
-- keep saying what was actually checked on the day rather than following the
-- item's current wording. A foreign key says the opposite — that the tick is a
-- view of a row that still exists. Both cannot be true, and the snapshot is
-- the one the business needs, because what a room was checked against in
-- September has to still read correctly in December.
--
-- So item_id stays a uuid and stops being a reference. It is the join key that
-- lets two phones agree which line was ticked; it is not a claim that the line
-- is still on the list.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.turn_checks
  drop constraint if exists turn_checks_item_id_fkey;

comment on column public.turn_checks.item_id is
  'Stable id of the checklist line, computed the same way on every phone. Not '
  'a foreign key: the line may be a starter that was never saved, or one the '
  'owner has since removed, and neither invalidates the tick.';
