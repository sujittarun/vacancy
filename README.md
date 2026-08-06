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
were inferred; smaller units sit on lower floors. Easy to change if the real numbering
differs.

## Using it for real

It opens with **demo bookings** so you can see it working. To use it properly:

1. Scroll to the bottom of **Rooms** and tap **Start empty** twice (it asks once to
   confirm) — that erases the demo bookings.
2. Tap any flat, type the guest's name, tap **Book**. It books the dates currently
   selected on the Rooms tab, so set the night and stay length there first.
3. Cancel a booking with the ✕ next to it in the flat's sheet (also two taps).

**Bookings save on the device, in the browser.** They survive closing the tab and
reopening tomorrow. They are *not* shared between phones, *not* backed up, and *are*
erased if you clear your browser data. That is fine for a trial; it is not yet a system
of record.

---

## What it does

Three screens, reachable from the bar at the bottom.

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
The bar under each date is that same figure as a share of all 40, so it shrinks as the
night sells out. Tap a date for the rooms that are open.

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
