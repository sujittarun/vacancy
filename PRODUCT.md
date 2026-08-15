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

## Portfolio

45 units across five buildings, confirmed by the user:

| Building | Units | Mix |
|---|---|---|
| TreeTops | 14 | 12 × 3 BHK, 1 × 2 BHK, 1 × Studio |
| Telecom Nagar | 3 | 3 × 3 BHK |
| Madhapur | 4 | 3 × 3 BHK, 1 × Studio |
| Banjara Hills | 12 | 10 × 2 BHK, 2 × Studio |
| Lotus Pond | 12 | 10 × 3 BHK, 2 × 2 BHK |

Flat numbering is `<building code>-<floor><unit>` (TT-101, LP-403). Floor layouts and
unit numbers were **inferred**, not supplied — smaller units placed on lower floors.
Correct them if the real numbering differs. "Banjara Hills" was normalised from the
user's "Bajarahills".

## Capabilities and Constraints

- Portfolio scale: 45 units. Horizon that matters: today through roughly 60 days.
- A unit on any given day is in one of: **vacant**, **booked**, **turnaround**
  (check-out and check-in the same day), or **blocked / out of service**
  (maintenance, deep clean, owner use, renovation, not ready). Blocked was
  requested by the user after an Airbnb operator reviewed the app.
- Blocked nights are excluded from sale everywhere, and for occupancy they leave
  the denominator rather than joining the numerator — blocking a flat must never
  flatter the occupancy figure. A block is not a booking and is excluded from
  arrivals, departures, turnarounds, stay length, source mix and extensions.
- **Storage.** The app runs in one of two modes and always says which. *Sample* — no
  account, invented bookings in `localStorage`, which is what the public link opens.
  *Live* — signed in, with a Supabase database as the book: shared across phones, kept if
  a phone is lost, and the double-booking rule enforced by a Postgres exclusion constraint
  rather than by the screen. Crescent Stays is the first tenant; hosts are isolated by Row
  Level Security. See [ARCHITECTURE.md](ARCHITECTURE.md), including why this is one
  project rather than one per host.
- **Writes are optimistic and reconciled.** An entry applies locally at once and travels
  afterwards, because the operator is usually mid-call. The queue persists across app
  restarts. When the server refuses a write because another phone got there first, the
  local entry is rolled back and the app names the guest and dates that beat it — a
  conflict the operator can answer on the call, not an error code.
- **Telemetry carries counts and screen names only.** No guest names, notes or rates ever
  reach the telemetry tables, so a crash report can never become a data breach.
- **A booking carries guest phone, headcount and the total agreed for the stay.** Phone is
  the identity key — the only one a walk-in, a repeat guest and a platform booking share —
  and it drives repeat-guest recognition at the moment the number is typed.
- **Payment has three states, not two:** received, settled-by-the-guest-with-a-platform
  (payout still owed to the operator), and genuinely due. Modelling only paid/unpaid marks
  every Airbnb booking unpaid forever, which teaches the operator to ignore the field.
  Only genuine balances appear in anything that asks for action.
- **No check-in/check-out state.** Any status a human must remember to maintain decays, and
  decayed data is worse than none. Presence is derived from dates and is always correct;
  the single manual action is recording money, which carries information dates cannot.
- **Guest ID and compliance documents are deliberately out of scope** for now. Storing
  identity documents is a materially different obligation under the DPDP Act and was
  deferred by the user rather than skipped by omission.
- The **flats are real**; the bookings, guest names and rates shipped with the app are
  invented demonstration data and are labelled as such in the interface. The user can
  clear them ("Start empty") and enter real bookings.
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
