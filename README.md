# Vacancy

A phone-first way to see which of ~40 short-let apartments are free, built to replace a
colour-coded Excel grid without losing the thing that made the spreadsheet work — being
able to see the whole portfolio at once.

**Open it:** https://sujittarun.github.io/vacancy/

Works on any phone browser. Nothing to install, no account, no login.

> **All data here is invented.** The rooms, guests, dates and rates are generated for
> demonstration. It is not connected to Airbnb, Booking.com, a spreadsheet, or any real
> booking system.

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

| You type | It answers |
|---|---|
| `anything free tonight?` | count + the list |
| `3 nights from friday` | rooms free for the whole stretch |
| `1n this weekend` | one night, Friday |
| `2 bhk next week` | filtered by unit type; offers nearby dates if nothing fits |
| `8 to 11` | reads day-of-month ranges |
| `palm court tomorrow` | filtered by building |

Chips under the answer show what it understood, so when it misreads you, you can see why.
**Copy for WhatsApp** puts the whole answer on the clipboard, formatted to paste.

There is a microphone if the browser supports speech input — useful mid-call.

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

A working prototype for evaluating the interface. **Where the data would actually live is
still an open decision** — nothing in the code assumes a database, a spreadsheet, or a
channel-manager sync. All state is generated in memory at load.
