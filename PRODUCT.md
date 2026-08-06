# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: an independent short-let operator who runs roughly 30–40 serviced
apartments / Airbnb rooms as a single portfolio. He is not a hotel chain and has no
front desk. He works from his phone, standing up, often mid-phone-call with a
prospective guest on the line. He answers availability questions in seconds or the
booking goes elsewhere.

Secondary viewer (this project's actual audience right now): the operator's friend,
who is evaluating whether a modern interface can beat the incumbent spreadsheet. He
is judging design capability and ease-of-use, not deploying software.

## Product Purpose

Answer one question faster than a spreadsheet can: **which of my flats are free, for
the dates this caller just said?**

Two call shapes arrive constantly and both must be instant:
- a date *range* — "do you have anything from the 8th to the 11th?"
- a *right now* — "anything vacant tonight?"

Success is a correct answer spoken aloud before the caller finishes their sentence,
with no scrolling, no zooming, and no risk of reading the wrong row.

## Positioning

The incumbent is an Excel sheet: 40 flats down the rows, days across the columns,
cells hand-coloured when something books. It has one genuine superpower this product
must not lose — **the whole portfolio is visible as one picture**, and the operator
pans it with his thumb. Every previous "proper app" he was shown replaced that single
picture with paginated screens and lost him.

So the position is not "replace the spreadsheet with an app." It is: keep the
whole-picture-at-a-glance property, and add the one thing a grid can never do —
answer a range query directly instead of making a human scan for it.

## Operating Context

- Phone, one-handed, portrait, frequently mid-call.
- Touch gestures are the existing muscle memory: swipe left/right across days,
  swipe up/down across flats, long-press a cell.
- The existing artifact is a colour-coded Excel grid opened from a phone file
  browser. Colour, not text, carries the meaning today.
- Bookings arrive by phone and walk-in as well as through listing platforms, so any
  system must accept fast manual marking.

## Capabilities and Constraints

- Portfolio scale: ~40 units. Horizon that matters: today through roughly 60 days.
- A unit on any given day is in one of a small set of states. Confirmed states:
  booked, vacant. Turnover/changeover days (check-out and check-in on the same
  calendar day) are a real occurrence in this business and are treated here as a
  distinct state; **not yet confirmed by the user.**
- Data storage is explicitly **undecided**. The user deferred the backend question:
  "I just need sample UI. Once I like it, then I will see where to keep the data."
  Nothing in this project may assume a particular database, sheet, or sync source.
- No live booking data exists yet. All portfolio content in this project is authored
  demonstration data and must be labelled as such.
- No commercial claims exist: no real prices, occupancy figures, guest names,
  addresses, or platform integrations may be presented as fact.

## Evidence on Hand

- A described (not supplied) Excel grid: rows = flats, columns = days, cells
  hand-coloured on booking. No file was provided.
- Verbal description of the phone-call workflow and the pan/zoom gesture habit.
- Absent, and not to be fabricated: real unit names, real bookings, real revenue,
  real occupancy rates, screenshots of the original sheet.

## Product Principles

1. **The whole picture is the feature.** Any view that cannot show the full
   portfolio's shape without pagination has lost the argument to Excel.
2. **A question beats a scan.** Where the caller states dates, the interface should
   return the answer, not the raw material for the operator to compute.
3. **Colour is the language.** Meaning must survive being read at arm's length, at a
   glance, before any text is parsed.
4. **The thumb is the cursor.** Every primary action must be reachable one-handed in
   portrait while holding a phone to the ear.
5. **Wrong-row error is the real failure mode.** Confusing flat 302 with 303 loses a
   booking and a guest. Alignment and anchoring are safety features, not polish.

## Accessibility & Inclusion

Colour alone must never carry state — every colour-coded state also needs shape,
fill, label, or position. Targets sized for a moving thumb, not a stationary mouse.
