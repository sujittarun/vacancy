# Vacancy

A phone-first way to see which of 45 short-let apartments are free, built to replace a
colour-coded Excel grid without losing the thing that made the spreadsheet work — being
able to see the whole portfolio at once.

**Open it:** https://sujittarun.github.io/vacancy/

Works on any phone browser. Nothing to install.

**There is no login.** It opens straight into the app, and the book lives in the browser
on that phone. It survives closing the app; it is not shared with another phone and it is
not backed up, so export anything you would mind losing.

It arrives carrying **test data**: the 45 flats are real, the bookings, guests, money and
faults are invented so there is something to look at. **Rooms → Inventory → Delete all test
bookings** empties the invented part and keeps every flat — do that once before handing the
app to whoever will run it.

<details><summary>Turning on sync across phones</summary>

The server side is built and tested — a multi-tenant Postgres schema with row-level
security, an offline write queue and conflict handling. It is switched off by
one line, `CLOUD_ENABLED` at the top of the script, because there is no third option:
the bookings would sit behind a public web address, and the sign-in is the only thing
between a stranger with the link and a guest's name and phone number. Off is honest while
the app is being built; on brings the sign-in back with it. See
[ARCHITECTURE.md](ARCHITECTURE.md).
</details>

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

It opens with **demo bookings** and three flats out of service — one due back tomorrow, so
you can see the maintenance question in action. To use it properly:

1. Scroll to the bottom of **Rooms** and tap **Inventory**. Check the flats are right —
   add, renumber, retype or remove any of them, and add a building if one is missing.
   At the bottom of that sheet, **Clear all bookings** wipes the demo ones.
2. Tap any flat. It opens a **room card** — what it is, its nine weeks, and the one thing
   you probably came for. Booking, logging a fault and taking it out of service are each
   their own screen from there. See *Opening a room* below.
3. Cancel a booking with the ✕ next to it in the flat's sheet (also two taps). **It can be
   undone** — the message that follows carries an *Undo* that puts the guest, the number,
   the dates and every payment back exactly as they were. If somebody else took the nights
   in the meantime it says so rather than double-booking them.

### Opening a room

A room used to open onto every form at once — book a guest, log a fault, take it out of
service — all expanded under three lists. Forty-seven buttons and nearly four screens of
scroll before anything was typed. It now **reads**:

- what it is, and its nine weeks (hold and drag to read any night)
- **one primary action, decided by the room's state** — *Book Sat 15 Aug* when it is free,
  *Book from 21 Aug · next free* when it is not, so a busy room is never a dead end
- two quiet routes: **Log a fault** (stays on sale) and **Out of service** (cannot be sold)
- then what is true about it: what is coming up, what needs fixing, where the gaps are

Everything that writes has a screen of its own with one job and one commit button, and Back
returns to the room card.

### Taking a booking

**The booking screen sets its own dates.** The old form inherited them from the Rooms tab
and said so in help text — *"change the dates on the Rooms tab"* — which is what a broken
flow sounds like. Arriving and Nights are steppers at the top, capped at what is actually
free, and the line under them keeps up: *Leaves 19 Aug · free for 5 nights from here*.

Everything below arrives pre-filled, so the ordinary booking is still two touches — the
number, and **Book**.

**The phone number is the important field**, and not because you ring it. It is the only
key a walk-in, a repeat guest and a platform booking all share; names get spelled three
ways and half your guests have no email. Type a number that has stayed before and the app
fills the name in and tells you:

> *R. Menon has stayed 3 times · last 11 Sep*

which is worth knowing while you are still on the call. It also flips the source to
*Repeat guest* on its own.

**The amount** is the total agreed for the whole stay, not per night, because that is how
it is actually negotiated — a week is quoted as a week. It arrives filled in at the flat's
rate × nights, so accepting it is no taps at all.

**Guests** is a stepper. Nobody should open a keyboard to say "two people".

### Money, and the mistake most booking apps make

Payment has **three** states here, not two:

| Shown | Means | What you do |
|---|---|---|
| **₹4,400 due** | Genuinely unpaid | Chase it |
| **payout due** | The guest paid Airbnb; the payout is coming to you | Nothing — do not chase the guest |
| **settled** | All in | Nothing |

Almost every booking tool stores only *paid* and *unpaid*, which marks every Airbnb
booking unpaid forever — the guest **has** paid, just not to you. Show someone a false
"unpaid" twice and they stop reading the column at all. So a platform booking records
itself as settled by the guest the moment you take it, and only genuine balances appear
anywhere that asks you to act.

Tap the amber amount to record money: the figure is already the balance and the method is
already the one that source is usually settled by, so it is two touches. Cash, UPI, bank,
card or platform. A negative amount is a refund.

**Arrivals with a balance surface in Business** — *"Collect ₹72,200 from 11 arrivals today"* —
because that is money you can only take while the guest is standing in front of you.
Platform bookings are deliberately absent from that list.

There is no "checked in" button, on purpose. Anything a person has to remember to tap goes
stale, and stale data is worse than none. Arrivals are worked out from the dates and are
always right; the only thing you are ever asked to confirm is the money, which is the part
that actually carries information.

### Getting the data out

Tap the pill in the top right, then **Export to Excel**. On a phone this opens the share
sheet, so it goes straight to WhatsApp or mail — which is how it reaches an accountant. On
a computer it downloads.

One workbook, four sheets:

| Sheet | Answers |
|---|---|
| **Summary** | month by month — arrivals, nights sold, occupancy, billed, collected, outstanding |
| **Bookings** | one row per stay: flat, guest, phone, source, dates, nights, agreed, received, balance |
| **Payments** | one row per payment — the sheet to reconcile against a bank statement, and the one that finds cash that never arrived |
| **Guests** | one row per phone number: name, stays, nights, spend, first and last visit. This is the list to broadcast an offer to |

**It is a real spreadsheet, not a CSV, for one specific reason.** Excel reads a column of
ten-digit phone numbers as a number and writes `9.81235E+09` — silently destroying the one
column the guest list exists for. Here phone numbers arrive as text and keep every digit,
amounts arrive as numbers you can total, and dates as dates you can sort.

A booking with no amount recorded exports an empty cell, never a zero. A zero would read as
a free stay and would be summed as one.

There is no PDF, deliberately. The app is already the dashboard; a PDF of it could not be
filtered, totalled, or opened by an accountant's software.

### Out of service

A flat can be **blocked** — maintenance, deep clean, owner use, renovation, not ready.
Open the flat, tap **Block these nights instead**, pick a reason, say **how long it is
out** — any number of nights, capped at what is actually free so it can never be pushed
over a guest — and add a note. It prices the outage as you change it: *back on sale 19 Aug
· about ₹16,400 off the market*. It then cannot be sold: not offered in Ask, not in the month
drill-in, not proposed for a discount, not shown as free anywhere. The tile turns hatched
and reads the reason.

Two details that matter and are easy to get wrong:

- **A blocked night leaves the occupancy denominator; it never counts as sold.** Otherwise
  taking a flat out of service would quietly *improve* your occupancy figure.
- **A block is not a booking.** It is excluded from arrivals, departures, turnarounds,
  average stay length, source mix and extension offers.

### What broke, and who fixed it

Two different things, and collapsing them is the mistake most tools make.

**A flat that is still sellable, with something wrong.** A slow geyser, a dripping tap,
patchy Wi-Fi, a loose cupboard door, an AC due its six-month service. Open the flat and tap
**Something needs fixing (keep it on sale)**. It costs no nights, blocks nothing, and sits
on the flat until someone marks it done. If the only way to record a fault were to block
the flat, you would either stop recording the small things or take a good flat off the
market to leave yourself a note — and the second is worse, because it destroys revenue to
satisfy the software.

**A flat that genuinely cannot be sold.** That is still a block, and a block now also
records **what broke** and **who is fixing it** — two chips on a form you already fill in.

#### The line that pays for the whole thing

The moment you pick a fault, it tells you what it already knows:

> ⚠︎ **Third AC fault in BH-101.** Ramesh fixed it 21 days ago. *Inside the month — worth
> asking for a free look.*   **[ Call Ramesh ]  [ Same person again ]**

That is the answer to *"which electrician serviced this, and why is it broken again?"* — at
the only moment it is useful, with one tap to the person who should be asked. A report
would never have been opened.

The industry name for what this measures is **first-time fix rate**. Normal is 85–92%; a
tradesman below about 72% costs you roughly **2.4× in labour** because he keeps coming
back, and each return trip costs 1.5–2× the original visit. You do not need the acronym —
you need the flag, and the number.

#### One trip instead of three

This is the part a dedicated maintenance app cannot do, because it does not know your
calendar. When a flat has several small things wrong, the app already knows when it is
empty:

> **All 3 could go in one visit while it sits empty from 17 Aug** — one trip instead of 3,
> and no night lost.

And when you do block a flat, it prices the outage honestly: the bill plus the nights taken
off the market. A ₹1,200 AC service that blocks a 3 BHK for two nights did not cost ₹1,200.

#### The part that actually saves money

Taking a flat out of service is easy. *Putting it back* is what gets forgotten — a flat
marked "AC repair" in March is still blocked in June because nobody revisited it, silently
out of inventory the whole time.

So around the date the flat was due back, **Business asks**:

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

### Where the bookings actually live

**Signed out — on the device.** Bookings survive closing the tab and reopening tomorrow,
but they are not shared between phones, not backed up, and are erased if you clear your
browser data. Fine for a trial; not a system of record.

**Signed in — in the database.** The same book on every phone, kept if a phone is lost,
and the double-booking rule enforced by Postgres rather than by the screen.

Three things follow from that, and all three are visible in the app.

**The pill never flatters.** *Live* means the server has it. Otherwise it says what is
actually true: *Offline*, or *2 to send*.

**Typing never waits for the network.** A booking appears the instant you enter it and
travels afterwards, because this gets used mid-call. If the signal is gone it queues,
survives closing the app, and sends itself when the signal returns.

**When two phones take the same room, the app says who won.** The database refuses the
second booking, and rather than a shrug, you get the answer you need on the call:

> **TT-104 was taken.** T. Nayar holds 13–16 Aug — entered on another phone. Your
> booking for P. Rao was not saved.  **See TT-104 →**

Your entry is rolled back, the winning booking appears in its place, and tapping the
message opens that room so the next thing you offer is one tap away.

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

  **Hold a tile to read the room without opening it.** Mid-call the question is rarely
  "show me everything about 204", it is *"what about 204?"* — asked while the grid is still
  what you want to be looking at. Holding shows its nine weeks, what is in it tonight, and
  who is next in:

  > **BH-203** · 2 BHK · Banjara Hills · floor 2
  > N. Pillai · night 1 of 1
  > Next in: S. Kulkarni, 25 Aug · 29% booked

  Lift your thumb and it is gone. Nothing to dismiss, nothing to navigate back from, and
  the grid never moved. Dragging instead of holding just scrolls, as usual.

### The nine weeks under a room

Tap any room and the strip at the top is its next nine weeks, one bar a night. **Put a
finger on it and drag.** A playhead follows and tells you what that night actually is:

> **Tue 18 Aug**  M. Sequeira · night 2 of 3
> **Tue 8 Sep**  Free · 5 nights open, from 4 Sep

The booking that owns the night lights up in the list below, which is what ties the picture
to the words. Nothing resizes while you read — the legend and the readout share one box, so
the form underneath never jumps. Dragging up or down hands control straight back to
scrolling.

**Out of service is a notch, not a shade.** It was drawn four points of luminance away from
a booked night — at four pixels wide that is not a distinction, it is the same bar. It now
has a tone of its own *and* half the height, anchored to the floor, so a flat with a
technician in it can never read as income. Colour is never the only thing carrying a state
here, and at this size it could not carry one anyway.

**Touching a night shows you the span.** The whole stay — or the whole gap — lifts with it,
so you read an extent rather than a pixel. Where two bookings run back to back there is now
a seam between them; they used to draw as one unbroken run, hiding every turnover in the
month.

### Month

The calendar, and what you selected. It used to be seven stacked sections — a progress bar,
a caption, two explanatory paragraphs — with the calendar as one of them. Business owns
occupancy analysis now, so the month's fullness is a caption in the title row and the
teaching text is gone: what survives under the grid is the one line that is *news*, a date
running emptier than that weekday usually does.

Each date carries **rooms still free that night** — not rooms booked.
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

**It opens with an answer, not a keyboard.** The tab used to focus the box on arrival —
so the keyboard covered the screen before anything had been asked — and the box arrived
holding the last question, which had to be deleted a character at a time. Now it opens
showing tonight, the box is empty, and the keyboard comes only when you mean to type.

**The answer keeps up with the typing.** There is no Ask button any more; it only ever
confirmed what was already on screen.

**Paste the guest's message.** A great many enquiries are not phone calls at all — they
arrive on WhatsApp: *"Hi, do you have a 2bhk from 15th to 18th for 4 people?"* Copy it, tap
the clipboard icon, and it is read as it stands:

> **Yes — 2 rooms free for all 3 nights, Thu 20 Aug → Sun 23 Aug.**
> `the 20th to the 23rd` · `3 nights` · `2 BHK`

Then **Copy for WhatsApp** sends the reply back. The round trip is the point: the question
is already written down, so retyping it into a search box is wasted work.

That same button becomes a **✕** once there is anything in the box — the two are never
wanted at the same time, and clearing no longer means holding backspace through a sentence.

The chips underneath are questions now, not parser syntax — *tonight, tomorrow, this
weekend, 3 nights, next week* — one tap each. Anything you actually ask is remembered under
**asked before**, because the same questions come round again.

**A word on the microphone.** It is still there, but it will not be much use on a call: the
phone's mic belongs to the call while it is running, so dictation is for when you are *not*
on one — walking the building, hands full. Typing and pasting are the fast paths.

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
| `bh201`, `BH-201`, `bh 201` | **one particular flat** |

These combine freely — *"do you have a 3 bhk free from 16 sep for 4 nights"* works, and so
does *"any 2 bhk in banjara hills from 16 sep to 19 sep"*. A bare date means the **next**
time that date comes round, so on 7 Aug `16` is 16 Aug and `2` is 2 Sep. If you ask about a
date past the nine-week horizon it says so rather than quietly answering about a different day.

Chips under the answer show what it understood, so when it misreads you, you can see why.
**Copy for WhatsApp** puts the whole answer on the clipboard, formatted to paste.

There is a microphone if the browser supports speech input — useful mid-call.

#### When nothing fits

The answer is ordered by what a caller would actually accept.

1. **A shorter stay from the same date.** *"The longest you can do from Sun 9 Aug is 6
   nights, not 30"* — with the flats that offer it. Someone who wants thirty nights
   starting now can often be sold twenty; that is a negotiating position.
2. **A different arrival, within a week** — offered when *either* the whole stay fits from
   that date, *or* a materially longer one becomes possible: *"+7d — arrive Sun 16 Aug, up
   to 12 nights."* Both are useful; showing only the first meant a 30-night ask got no
   arrival options at all.
3. **One line saying when the full stay first becomes possible**, however far out: *"The
   first date that takes all 30 nights is Sun 6 Sep, 28 days out."* Information, not a
   suggestion worth acting on.

An earlier version searched the whole nine weeks for an alternative arrival and cheerfully
offered "+23 days" — technically an answer, useless as one.

#### One move away

When nothing fits, it does not just say no. A hotel manager in that position shuffles a
room, so the app looks for exactly that: **every stay you could take by relocating one
existing guest** to a flat that is free for their whole stay.

> Move **T. Nayar** to TT-301 — 10 Aug–13 Aug · 3 BHK, same building, same size ·
> then TT-204 is yours

Options are ranked so the move the guest would never notice — same building, same size —
comes first.

**Tapping one shows you the move before it happens.** Two rooms side by side with the guest
standing in the first, their bag beside their name. Confirm and they cross — lifting,
arcing, settling into the other room — while the room they left goes light the moment they
step out of it, which is this app's word for *sellable*. Then the button becomes **Book
BH-103**, which was the point of the whole manoeuvre.

It asks first because it is the only action in the app that changes something a guest has
already been told. Nothing else moves: same nights, same money, same guest, and a line
reminding you they need telling their new room number. If the destination is taken while
you are deciding, it refuses and says so rather than double-booking.

**Walk away without booking and it offers the move back.** A guest shuffled for a booking
that never happened was shuffled for nothing, so closing the sheet says so and puts them
back in one tap.

**It moves as many guests as the room needs.** A room held by three bookings across your
dates takes three moves, and it will offer them — ranked so the option that disturbs the
fewest people comes first, with the count on the row (*"3 moves"*) so the cost is visible
before you tap. There is no cap on the operator's judgement, only a practical ceiling of
four: past that it is not a shuffle, it is a reorganisation.

**Two rules are hard, not preferences**, because getting either wrong is a complaint the
operator did not earn:

- **Nobody is ever moved to a smaller flat.** A guest who booked a 3 BHK does not end up in
  a studio so a different booking can be taken.
- **Nobody already checked in is asked to pack.** Only stays that have not started can move.

Same building is strongly preferred and *named* when it cannot be had — five buildings
across Hyderabad are five different journeys to work, and the guest chose one of them.

### Business

Opens with **Worth doing now** — one card, and only things that are true **today or
tomorrow** and stop being true if you ignore them. Each kind gets **one row**, with the
flats a tap away:

It is a **board, not a list** — grouped by the response each thing needs, so a decision
never looks like a discount idea and extra items thicken a figure rather than adding a row:

**Needs a decision** — a flat due back from maintenance. **Back in service** ends the block
today. **Still out** opens a slider: drag to say how many more days, and it shows the date
it comes back. The slider is **capped at the nights actually free**, so a block can never be
dragged over a guest.

**To do** — work that must happen, counted rather than enumerated. *Clean 2 flats tomorrow.*

**Perishing · sell or lose** — nights with a clock on them, shown as figures side by side
rather than two rows saying the same thing:

| Tonight | Tomorrow |
|---|---|
| **19** unsold · −25% | **20** unsold · −20% |

Under them, single spare nights and extension offers. Tap anything for the flats.

The whole card fits one phone screen.

There is no separate card for discounts. Maintenance and the flats worth discounting
belong in the same list, because they are the same kind of thing: something to do before
the day is out.

**What is deliberately excluded is the point.** "16 orphan nights somewhere in the next
fortnight" is still 16 tomorrow — it is a standing condition, not a task, and a to-do list
that contains standing conditions never empties, so people stop reading it. Longer-range
patterns live in the sections below instead.

When there is nothing, the card does not render. One line takes its place:

> ✓ **Nothing needs attention today.** No cleans between guests, no flat due back from
> maintenance, and every room tonight is sold.

Above it, a bar of five questions — **Now · Money · Rooms · Guests · Upkeep** — because
they run on different clocks and used to sit in one nine-card scroll, where what to do today
was pushed down by how the year is going. A dot on **Now** means something is waiting.

**Touch a bar and it answers.** A chart that only draws is a picture; these say what the
bar means in words and, where there is something to do, offer the route:

> **Mondays** run at 35% — *25 points* under Saturdays. Emptiest is 7 Sep, 32 free.
> **[ See 7 Sep → ]**

The other bars step back, the touched one lifts, and the answer opens into a slot that is
already reserved, so nothing below it jumps.

**Swipe the cards sideways to move between them.** The deck follows your thumb as you drag
rather than waiting for you to let go, and at the first and last it resists — a third of the
travel becomes a ninth — which is how a phone says *nothing that way* without words. Moving
by tapping the bar slides the deck in from the side you travelled, so it reads as a place you
moved to rather than a screen that changed.

**Money** — what a night is actually worth. RevPAR is the number operators run on, because a
full house at a poor rate and a half-empty one at a good rate look identical on an occupancy
chart and never on this. Beside it, the gap between what you list and what you achieve — the
discount you are actually giving — and what you are owed, split into money you can collect
at the door and money that has already walked out.

**Guests** — how much of the book is people who came back, and whether they are worth more
than first-timers. Only possible because a booking carries a phone number.

**Upkeep** — what keeping the place standing costs, counted honestly: the invoice *and* the
nights the repair took off the market. In the sample book that is ₹3,500 of invoices against
₹42,600 of lost nights. The half nobody counts is usually the larger one, and it is the
argument for paying more for someone who can come today. Then which flats keep costing you,
and whose work comes back within a month.

The rest live under **Rooms**. The uncommon ones are the point:

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

Good enough to run a real day on, signed in. Honest limits before you rely on it:

- **No sync** with Airbnb, Booking.com or any channel manager. Every booking is entered by
  hand.
- **Rates are invented** and shown as "specimen". Nothing calculates revenue.
- **Writes need signal.** They queue and send themselves, but a booking entered on a dead
  connection is not confirmed until the pill says *Live* — which is exactly what it says.
- **One login for the property.** Adding a second person is a row in the database, not yet
  a screen in the app.
- **A room move handles at most four guests.** Past that the app stops offering, on the
  grounds that it is no longer a shuffle.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the multi-tenant database is put together
and why it was built as one project rather than one per host.
