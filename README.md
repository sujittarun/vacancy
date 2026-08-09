# Vacancy

A phone-first way to see which of 45 short-let apartments are free, built to replace a
colour-coded Excel grid without losing the thing that made the spreadsheet work — being
able to see the whole portfolio at once.

**Open it:** https://sujittarun.github.io/vacancy/

Works on any phone browser. Nothing to install, no account, no login.

## The portfolio

| Building | Units | Mix |
|---|---|---|
| TreeTops | 14 | 12 × 3 BHK, 1 × 2 BHK, 1 × Studio |
| Telecom Nagar | 3 | 3 × 3 BHK |
| Madhapur | 4 | 3 × 3 BHK, 1 × Studio |
| Banjara Hills | 12 | 10 × 2 BHK, 2 × Studio |
| Lotus Pond | 12 | 10 × 3 BHK, 2 × 2 BHK |
| **Total** | **45** | |

Flat numbers run `TT-101`, `LP-403` and so on — building code, floor, unit. Floor layouts
were inferred; smaller units sit on lower floors. **All of it is editable in the app** —
see *Editing the inventory* below. This table is only the starting point.

## Using it for real

It opens with **demo bookings** so you can see it working. To use it properly:

1. Scroll to the bottom of **Rooms** and tap **Inventory**. Check the flats are right —
   add, renumber, retype or remove any of them, and add a building if one is missing.
   At the bottom of that sheet, **Clear all bookings** wipes the demo ones.
2. Tap any flat, type the guest's name, tap **Book**. It books the dates currently
   selected on the Rooms tab, so set the night and stay length there first.
3. Cancel a booking with the ✕ next to it in the flat's sheet (also two taps).

### Out of service

A flat can be **blocked** — maintenance, deep clean, owner use, renovation, not ready.
Open the flat, tap **Block these nights instead**, pick a reason and add a note
("technician booked"). It then cannot be sold: not offered in Ask, not in the month
drill-in, not proposed for a discount, not shown as free anywhere. The tile turns hatched
and reads the reason.

Two details that matter and are easy to get wrong:

- **A blocked night leaves the occupancy denominator; it never counts as sold.** Otherwise
  taking a flat out of service would quietly *improve* your occupancy figure.
- **A block is not a booking.** It is excluded from arrivals, departures, turnarounds,
  average stay length, source mix and extension offers.

#### The part that actually saves money

Taking a flat out of service is easy. *Putting it back* is what gets forgotten — a flat
marked "AC repair" in March is still blocked in June because nobody revisited it, silently
out of inventory the whole time.

So around the date the flat was due back, **Pulse asks**:

> **TT-104 · Maintenance** — comes back tomorrow · AC — technician booked.
> Is it ready to sell again?    **[ Back on sale ]  [ Still out · +7 days ]**

One tap either way. *Back on sale* ends the block today; *Still out* pushes it a week — and
if a guest already holds some of those nights it extends as far as it can and tells you,
rather than silently doing nothing. Blocks running longer than three weeks are flagged
separately, because those are the ones quietly costing you nights.

### Editing the inventory

**Rooms → Inventory** lists every flat under its building, with how many bookings it
holds. Tap a flat to change its number, type or nightly rate, or remove it. Renumbering
a flat **keeps its bookings**; removing one takes its bookings with it, and it tells you
how many before you confirm. Duplicate flat numbers are refused.

**Bookings save on the device, in the browser.** They survive closing the tab and
reopening tomorrow. They are *not* shared between phones, *not* backed up, and *are*
erased if you clear your browser data. That is fine for a trial; it is not yet a system
of record.

---

## What it does

Four screens, reachable from the bar at the bottom.

### Rooms

Opens on today's operations, because that is the first thing an operator actually needs:

- **Arriving / Leaving / Turnaround** — tap any figure for the list of guests and rooms.
  *Turnaround* is the important one: rooms with a check-out and a check-in on the **same
  day**, which have to be cleaned in between. Those are the ones that go wrong, so they
  are flagged in amber and marked with a corner flag on the room tile.

- **How long a stay** — 1 / 2 / 3 / 7 nights. This re-counts **every night in the
  fortnight below**. At 1 night the strip might read 16, 15, 17, 13; switch to 3 nights
  and the same strip reads 6, 6, 8, 5. You are seeing *"how many rooms could take a
  3-night booking arriving that day"* across two weeks at once.

- **The next two weeks** — tap any night to see that night's rooms without leaving the
  screen. If nothing fits, it tells you the soonest date that does and offers to jump
  there.

- **Every room** — a tile per apartment. A lit tile is sellable; the figure on it is how
  many nights it stays free from that date. An **amber dot** marks a single orphan night
  wedged between two bookings — the hardest kind to fill and the easiest to miss in a
  spreadsheet.

### Month

A calendar where each date carries **rooms still free that night** — not rooms booked.
The bar under each date is that same figure as a share of all 45, so it shrinks as the
night sells out. Tap a date for the rooms that are open.

Two ways to pick a stay, because a gesture should never be the only route in:

- **Tap arrival, then tap departure** — the way every booking site works. One tap alone
  shows that night by itself; tapping an earlier date starts the range again. Works across
  months and needs no gesture.
- **Press and hold, then drag** — the shortcut. A readout above the calendar counts rooms
  free for the *entire* span as your finger moves, and releasing lists them.
- **An amber dot** marks a date running emptier than that weekday normally does. This is
  the one thing the raw count cannot tell you: a Friday showing 20 free gets flagged while
  a Saturday showing 15 does not, because Fridays usually sit at 16 and Saturdays at 15.
  A low number can still be a bad night, and a high one can be perfectly ordinary.

### Ask

Type or speak the question the way the caller said it:

| You type | It reads |
|---|---|
| `tonight`, `tomorrow`, `in 3 days`, `day after tomorrow` | relative days |
| `friday`, `next friday`, `next week`, `this weekend`, `next month` | named periods |
| `16`, `16 sep`, `sep 16`, `16 september`, `16/9` | a specific date, with or without the month |
| `15-18`, `15 to 18`, `15th–18th`, `16 sep to 19 sep` | a range; the nights are counted for you |
| `3 nights`, `1n`, `2nt`, `a week`, `fortnight` | how long the stay is |
| `3 bhk`, `2bhk`, `studio` | unit type |
| `treetops`, `banjara`, `lotus pond`, `telecom` | building |

These combine freely — *"do you have a 3 bhk free from 16 sep for 4 nights"* works, and so
does *"any 2 bhk in banjara hills from 16 sep to 19 sep"*. A bare date means the **next**
time that date comes round, so on 7 Aug `16` is 16 Aug and `2` is 2 Sep. If you ask about a
date past the nine-week horizon it says so rather than quietly answering about a different day.

Chips under the answer show what it understood, so when it misreads you, you can see why.
**Copy for WhatsApp** puts the whole answer on the clipboard, formatted to paste.

There is a microphone if the browser supports speech input — useful mid-call.

#### One move away

When nothing fits, it does not just say no. A hotel manager in that position shuffles a
room, so the app looks for exactly that: **every stay you could take by relocating one
existing guest** to a flat that is free for their whole stay.

> Move **T. Nayar** to TT-301 — 10 Aug–13 Aug · 3 BHK, same building, same size ·
> then TT-204 is yours

Options are ranked so the move the guest would never notice — same building, same size —
comes first. Nothing moves automatically; it only tells you what is possible.

### Pulse

Opens with **Worth doing now** — a ranked list of things to act on today, not charts to
interpret. The one that matters most:

> **Extensions.** A guest is already in the flat. The night after they leave is empty.
> Asking them to stay costs nothing — no listing, no commission, no clean in between. When
> that gap is a single night wedged before the next booking, the extension closes it
> *exactly*, and a one-night orphan is the night nobody else will ever book. No small-
> operator tool surfaces this; they all wait for demand to arrive instead of looking at
> who is already standing in the room.

Below it, one metric per section, scrolled vertically. The uncommon ones are the point:

| Card | Why it matters |
|---|---|
| **How your book fills** | Occupancy by week ahead. The far weeks *should* look thin — this shows where your booking window actually ends, so 30% five weeks out reads as normal rather than alarming. |
| **Which nights sell** | Names your weakest weekday and the size of the gap. |
| **How each building is doing** | Same city, same weeks — a large gap is pricing or listing reach, not demand. |
| **Which sizes sell** | Studio vs 2 BHK vs 3 BHK. If the weak size is the one you hold most of, that is where nights are being lost. |
| **How long people stay** | Average stay and the share of single nights. Every one-nighter is a full changeover for one night's income. |
| **Where bookings come from** | Your direct share — the number platforms never show you, and the one most worth growing. |
| **The cleaning week** | Same-day turnarounds per day for the next fortnight. Tells you which day needs extra help *before* it arrives. |
| **How broken up the gaps are** | Ten scattered single nights are far harder to fill than one ten-night hole. The honest measure of how sellable your empty time is. |

**There is no history yet**, and the app says so rather than faking it. Everything reads
today forward. Each booking you enter records the day you took it, so lead time and
week-on-week pace become real once it has been used for a while.

Tap any room, anywhere, for its next nine weeks, its upcoming bookings, and its sellable
gaps.

---

## Design notes

The core idea: **a vacant room is the lit one.** Booked rooms sit close to the background;
free rooms are high-contrast and pop off it. You are hunting for vacancy, so vacancy is
what glows. That rule survives the theme switch — in light mode free rooms are ink-dark on
paper-white, booked are pale.

Amber is the only accent and means one thing: *now, or needs attention.*

There is a theme toggle in the top right.

See [DESIGN.md](DESIGN.md) for the full system and [PRODUCT.md](PRODUCT.md) for who it is
for and what it has to do.

---

## Running it

It is a single self-contained HTML file with no build step, no dependencies and no network
calls. Open `index.html` in a browser, or:

```bash
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Status

Good enough to run a real day on. Honest limits before you rely on it:

- **One device, one person.** Bookings live in that browser's storage. Two phones will not
  see each other's entries.
- **No backup.** Clearing browser data erases everything. There is no export yet.
- **No sync** with Airbnb, Booking.com or any channel manager. Every booking is entered by
  hand.
- **Rates are invented** and shown as "specimen". Nothing calculates revenue.

If the trial goes well, the next step is a real backend so it works across phones and
survives a lost device.
