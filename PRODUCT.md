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
- **Storage (current).** Authentication is switched off by `CLOUD_ENABLED` during the
  build, so the book lives in `localStorage` on one phone: no account, no server, nothing
  exposed on the public URL. The cloud path below stays wired and returns with one line.
- **Storage (when sync is on).** The app runs in one of two modes and always says which. *Sample* — no
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
- **No telemetry.** It was built when the plan was many hosts sharing one backend and the
  app's author needed to see crashes and usage per host. With sign-in switched off there is
  one operator, one device and no server, so it collected nothing and only carried an
  obligation. Removed from the client; the tables and their policies remain in the schema
  for the day sync returns.
- **A booking carries guest phone, headcount and the total agreed for the stay.** Phone is
  the identity key — the only one a walk-in, a repeat guest and a platform booking share —
  and it drives repeat-guest recognition at the moment the number is typed.
- **Payment has three states, not two:** received, settled-by-the-guest-with-a-platform
  (payout still owed to the operator), and genuinely due. Modelling only paid/unpaid marks
  every Airbnb booking unpaid forever, which teaches the operator to ignore the field.
  Only genuine balances appear in anything that asks for action.
- **A guest in the way is a question, not a verdict.** The shuffle that frees a flat for
  a booking frees it for a plumber too, so when an out-of-service run stops dead against an
  arriving guest the app names who could move, where, and how many extra days that buys —
  and when nobody can move, it says that too, in one muted line rather than silence. There
  is no cap on how many guests may be moved: the count and the cost are put in front of the
  operator and the decision is theirs. Guests already in the flat are never asked to pack,
  and nobody is ever moved into a smaller unit.
- **Maintenance is captured in taps, not sentences.** Choosing what broke offers the four
  things it usually turns out to be ("not cooling", "leaking water"), so the note ends up
  in words that read back sensibly months later instead of blank. The person fixing it is
  offered as a card carrying their record — jobs done, how many came back, and whoever
  touched this exact fault in this exact flat first, because they hold the warranty.
- **A guest can be moved for no reason but yours.** Every other move in the app is a
  consequence — a booking needs the room, or a repair does. Sometimes it is neither: a guest
  asks for a quieter side, two parties should share a floor, a long stay should not sit in the
  flat you keep showing people. So the guest's own row carries a control the size of a glyph,
  and it lists where they could go and why. The two hard rules soften by exactly one step,
  because this is deliberate rather than derived: somebody already checked in still cannot be
  asked to pack, but a **smaller** flat is offered — separately and labelled as a downgrade —
  since putting a solo guest in a studio to free a 3 BHK is a real decision, and hiding it
  would only be the app deciding instead of the operator.
- **The list of things that break learns.** The flats have a chimney, a microwave and a gas
  stove, so those are kinds of their own rather than "Other". And anything typed against
  *Other* is remembered as a new kind: the second time the water purifier goes it is a tap and
  a search word, not a sentence — and from then on it carries its own history, its own repeat
  warning, and its own set of people who have fixed it.
- **Taking a flat out of service offers, it does not interrogate.** A renovation must not
  cost six presses on "+" while a phone is at an ear, so the two lengths that are actually
  likely are one tap each: every free night there is, and however long the last one of these
  took in this flat. Both are *offered* and never pre-filled — nights loaded behind a tap you
  did not mean is money spent unread. And when the work could happen in a window where the
  flat is empty anyway, the app says so and will move it there, because that is the one thing
  on this screen that changes what it costs.
- **The bill is half of what upkeep costs, and it was the missing half.** Every outage has an
  invoice and a set of nights that could not be sold; the app was counting only the nights —
  the half every operator already knows. A short optional amount beside the note completes it,
  so "what upkeep costs" stops under-reporting.
- **A pull refreshes and lands where you were.** Added to the home screen the app runs
  standalone: no address bar, no reload button, and no way back to a fresh start short of
  killing it. The pull is the gesture every phone owner already has, so it answers to that
  — and it returns to the same tab and the same Business segment, because being dumped on
  Rooms every time is worse than not reloading at all.
- **The move cap is eight, and what it hides is said out loud.** There is a number — six
  people repacking for one arrival is a reorganisation, not a shuffle — but it sits where a
  real operator would already have said no, not where the search happened to get cheap. Any
  room that could have been freed by moving more than eight guests is counted and named, so
  "no options" never quietly means "options you were not shown".
- **No check-in/check-out state.** Any status a human must remember to maintain decays, and
  decayed data is worse than none. Presence is derived from dates and is always correct;
  the single manual action is recording money, which carries information dates cannot.
- **Export is a real `.xlsx`, written in-app with no library** (an xlsx is a ZIP of XML, and
  a ZIP entry may be stored rather than deflated, so it needs only a CRC32). CSV was
  rejected because Excel coerces a column of ten-digit phone numbers to `9.81235E+09`,
  destroying the one column the guest list exists for. Four sheets: Summary by month,
  Bookings, Payments, Guests. No PDF — the app is already the dashboard, and a PDF cannot
  be filtered or totalled by an accountant.
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
6. **Ask each question at the moment it has an answer.** The bill for a repair sat on
   the form that takes a flat out of service, where the work has not happened yet, so
   the only thing it could collect was a guess — and "what upkeep costs" was quietly
   totalling guesses. Who is *going* to fix it belongs at the start, because that is
   for the phone call. Who *did* fix it and what they charged belong at the close.
   A field that cannot be answered honestly where it stands is in the wrong place.
7. **Do not capture what nothing reads.** `closeIssue` accepted a fixer, a phone and a
   cost from the day it was written, no caller ever passed one, and no screen ever
   read the result — so faults recorded their repairs nowhere while looking like they
   did. Any new field must land somewhere a person can see it, in the same change.

## Accessibility & Inclusion

Colour alone must never carry state — every colour-coded state also needs shape,
fill, label, or position. Targets sized for a moving thumb, not a stationary mouse.
