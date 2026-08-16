# Design

<!-- impeccable:design-schema 1 -->

> Replaces the previous "Register" ledger world, rejected by the user as reading
> 1980s rather than modern. The ledger look is now an **anti-reference**: no paper,
> no ruling, no stamps, no binding, no folio numbers, no condensed caps.

## The world: Vacancy as light

A precision instrument for one job — finding empty rooms fast on a phone. Near-
monochrome, deep and quiet, with data as the only bright thing on screen. The craft
bar is set against Linear, Things 3, and Apple's own iOS system screens: type doing
the work, one accent used sparingly, real depth, spring physics.

**Scope.** Three surfaces, chosen by the user from the ten concepts, integrated into
one app rather than shipped as separate views:

| Tab | From | Job |
|---|---|---|
| **Tonight** | concept 10, The Glance | Ambient status — how full am I right now |
| **Month** | concept 6, The Month | Which dates are already gone |
| **Ask** | concept 9, The Word | Answer the caller in their own words |

A room-detail sheet is shared by all three; every room is tappable from anywhere.

**The central move — a vacant room is the lit one.** Booked is recessed material that
sits close to the ground; vacant is high-luminance and pops off it. He is hunting for
vacancy, so vacancy is what glows. The rule survives theme inversion:

> **Vacant = maximum contrast against the ground. Booked = minimum.**

In dark that means near-white cells on near-black. In light it means ink cells on
paper-white. Never a two-colour scheme where free and booked both shout.

## Color

Strategy: **Restrained** — a monochrome data field plus one accent. Semantic colour
(now / alert) is separate from the accent and never used decoratively.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#08090C` | `#E5E9F0` | Page ground |
| `--surface` | `#101219` | `#FFFFFF` | Cards, sheets |
| `--surface-2` | `#181B24` | `#DBDFE9` | Raised controls (dark) / recessed trough (light) |
| `--surface-3` | `#1F2330` | `#B7C0D2` | Pressed well |
| `--raise` | `#1F2330` | `#FFFFFF` | One step **above** whatever it sits on |
| `--line` / `--line-2` | 8% / 14% white | 15% / 26% ink | Hairlines |
| `--txt` | `#FFFFFF` | `#0D1017` | Primary |
| `--txt-2` | `#98A1B5` | `#454D5E` | Secondary |
| `--txt-3` | `#868FA2` | `#596174` | Tertiary / labels |
| `--free` | `#EAEFF9` | `#1C2331` | **Vacant** — the lit state |
| `--free-ink` | `#0A0C11` | `#F2F5FB` | Knockout on it |
| `--held` | `#1B1F2A` | `#C9D0DE` | **Booked** — recessed |
| `--held-ink` | `#7E8AA3` | `#3E4657` | The room number on a booked tile |
| `--oos` | `#4E586E` | `#747E92` | **Out of service** — a third material |
| `--now` | `#FFA23A` | `#F59300` | The accent, **as a fill** |
| `--now-ink` | `#FFA23A` | `#8A4A00` | The accent **as text, rule and thin bar** |
| `--hot` | `#FF5F52` | `#B8281A` | Orphan nights, alerts |
| `--ink` / `--ink-on` | = `--free` pair | = `--free` pair | Primary **action**, not world state |
| `--scrim` | 55% black | `rgba(28,32,42,.42)` | Behind the sheet |

Amber is the only accent. It marks *now* and primary actions, nothing else. Blue is
deliberately absent — it is the default accent of every scheduling tool in the
category and carries no meaning here.

### Light is its own design, not an inversion

The first light mode was the dark palette flipped, and flipping breaks in two ways that
no amount of nudging fixes.

**The ladder collapses.** `--bg`, `--surface`, `--surface-2`, `--surface-3` and `--held`
all landed inside a ~7% lightness band. Cards did not read as raised, sections did not
separate, a pill was grey on grey. Dark has headroom *above* its ground; light has none
above white, so light's depth must run **downward** from a white ceiling — which is why
`--surface-3` deliberately sits *below* `--held` here, the opposite of dark. That is not
a mistake to clean up.

**"Maximum contrast" resolves to a redaction.** On a light ground the rule turned every
vacant tile into a solid near-black block, which is heavy and — to most eyes — reads as
*occupied*, the exact opposite of what the dark theme communicates. `--free` is now a deep
slate carrying a real drop shadow and an inset highlight: an object lying on the page
rather than a hole cut through it.

**One orange cannot do both jobs.** `#C96A00` was not desaturated, it was *dark* — 41.8 L\*
below its ground, which is the definition of brown. The accent splits: `--now` is the
fill and keeps dark's hue (OkLCh H 64.7 against dark's 64.2, so it is the same colour in
both themes), and `--now-ink` is every accented word, hairline and thin bar. In dark the
two are identical, so dark does not move.

### Light is glass, not paint

Two opaque planes separated by a hairline is not a material, it is a diagram. Apple's
surfaces read as glass because of three things, and the blur is the least of them:

1. **Something behind them worth refracting.** The light ground is not one flat fill but a
   soft light source — three very low-contrast washes, brightest top-left. Blur over a flat
   colour returns the same flat colour.
2. **A saturation lift.** `saturate(180%)` so what shows through gains colour rather than grey.
3. **A specular edge.** `inset 0 1px 0 rgba(255,255,255,.9)` along the top, a soft shadow
   under the bottom. This is what actually says *a pane sits here*.

Two rules keep it from becoming a texture:

- **A recessed control is a translucent ink tint, never a paler white.** White on white has
  nowhere to go — the first pass made every trough and ghost button disappear.
- **A surface that means something keeps its meaning.** The alert and accent washes take the
  glass *behaviour* — blur, saturation, edge — with their own colour mixed into the pane
  rather than replaced by it. Plain glass over `.decide` turned "needs a decision" into a card.

Scope: chrome and content cards. **Not** the 45 room tiles — they are the data field, data
stays crisp, and 45 backdrop-filters on a scrolling grid is a frame-rate bill with nothing
bought. Measured 61fps with 55 blurred elements live. Dark is untouched: it already has
depth, and glass over near-black is grey.

### Fifteen pills was two questions in a trench coat

The two maintenance screens asked "why is it out" (5 chips) and then "what broke" (10 chips),
wrapping into five ragged rows, followed by three identical empty boxes — 736px on an 812px
screen with nothing leading. Three attempts at tidying it failed because the layout was not
the problem.

**"Maintenance" plus "AC" is one fact stated twice.** A broken thing *is* the reason. So there
is one question now, and the four answers that are genuinely not a breakage — deep clean,
owner use, renovation, not ready — sit in the same list as peers. The stored shape is
unchanged: a fault carries `reason: "Maintenance"`, the other four carry their own.

Three moves made it a decision rather than a form:

- **A grid, not a wall.** The Rooms tab's own four-column tile geometry, reused: even cells, a
  monoline glyph, the label under it, and a badge saying how many times *this flat* has broken
  *this thing*. Eight cells is two clean rows; the tail is one tap or three letters away.
- **Type it, and mean it.** The search matches synonyms, because "Plumbing" is the category and
  *tap* is what is dripping. Every word must land, short words are ignored — so "no power"
  finds Electrical and "hot water" finds the geyser. A search box that promises "tap, socket"
  and then finds nothing is worse than no search box.
- **Who follows what.** The fixer list is no longer a directory. It is the people who have
  actually done this thing, ranked this-flat-first then the-other-forty-four, each carrying the
  reason they are on the list — *"did the AC here twice"* — because a name alone is trivia and
  the number beside it (*"1 came back"*) is what decides who you ring. Nobody is pre-selected:
  the app is offering, not deciding.

And the dates and the money moved **out of the middle and up to the top**, as one quiet line
that keeps count: *"Out today for 1 night · back on sale 17 Aug · about ₹2,600 off the market."*
Boxed in the middle of a form, figures read as something to fill in. They are context.

## State beats material

A material rule and a state rule can carry the same specificity. When they do, the one
further down the stylesheet wins — and a material block written last will quietly repaint
every selected thing in the app. Both of the worst bugs in this pass were that one mistake:

- `.mguest-fx` — the glass pass repainted the dashed placeholder guests as solid chips, so
  the move sheet showed everyone already standing in their new rooms **before anyone had
  agreed to move.** A 1px dash is not a difference. An absent surface is.
- `.tyRow button` — a selected chip lost its dark fill but kept its knockout text, leaving
  near-white on near-white. The chip the operator had just chosen was the one they could
  not see.

Every material rule is therefore guarded against its own state —
`:not([aria-pressed="true"])`, `:not(.on)`, `:not(.urgent)`. It also says the right thing:
glass is the **default** material, and a control that has been chosen has a material of its
own.

### A ring is one ring

`border-color: X; box-shadow: 0 0 0 1px X` looks like a 2px ring and is two rings. The
outer spread inherits the element's `border-radius` rather than radius + spread, so it runs
wide at the corners and tight on the straights — a black edge of visibly uneven thickness,
which is what the user saw and what sent me looking. An **inset** ring shares the border's
own rounded rect exactly, so `border` + `inset 0 0 0 1px` reads as one clean ring on every
side.

The same card was also carrying *two different* rings — `.sel` wanted ink, `.today` wanted
amber — which is legible in dark, where `--free` is near-white, and a black halo in light.
Selection owns the ring; today owns the tint and the amber date chip. They compose instead
of competing.

### A room number never breaks

`TT-` on one line and `203` on the next is the wrong-row error PRODUCT.md calls this app's
failure mode, with extra steps. Room numbers in prose carry `.rm { white-space: nowrap }`.
The move row also stopped ellipsising: it is one line elsewhere, but here the sentence ends
in the destination room and *"Move S. Kulkarni to TT-2…"* is not an answer.

### Measure the page, not the table

Every ratio above was recomputed from the rendered DOM — walking the real background
stack, compositing `rgba` and `color-mix`, and resolving `color(srgb …)` through a canvas.
A first pass that parsed `color(srgb 0.99 0.93 0.84)` with a naïve number regex invented
failures that were not there; the palette was fine and the ruler was broken.

Doing it properly found two failures in **dark** — the theme that ships, and that nobody
had thought to check:

| | was | now |
|---|---|---|
| `--txt-3` on `--bg` / `--surface` / `--surface-2` | 3.41 / 3.20 / 2.94 | 5.9 / 5.5 / 5.3 |
| `--held-ink` on `--held` — the room number on 45 booked tiles | **3.46** | 4.71 |

Booked stays the recessed state; the fill still carries that. But PRODUCT.md names reading
the wrong row as *the* failure mode of this app, and a room number below AA is that failure
waiting to happen. All four screens and all five Business segments now measure clean in both
themes.

### One code path

`data-theme` is stamped onto `<html>` by a blocking head script before the first paint, so
there is no `@media (prefers-color-scheme)` block at all and every light-only rule is
written **once**. The two-guard version needed each rule twice, and a rule added to one
guard and not the other breaks only for people who touched the toggle — which is the
silent-regression shape that produced this rewrite. It also fixed a real bug: the toggle
used to forget your choice on reload. Choosing pins it; never choosing follows the phone,
live.

## Type

System stack only — no font CDN can load under the artifact CSP, and a silent
fallback is worse than an honest system face. On Apple hardware this resolves to
SF Pro, which is the right face for the register anyway.

| Role | Spec |
|---|---|
| Display numerals | 56–76px / 700 / `-0.045em` / `tabular-nums` |
| Screen title | 19px / 650 / `-0.022em` |
| Body | 14px / 400 / 1.5 |
| Data | 13px / 500 / `tabular-nums` |
| Label | 10.5px / 600 / uppercase / `+0.09em` |

`font-variant-numeric: tabular-nums` is global. Digits in this product are always
being compared down a column.

## Form

- Radii step with scale: sheets 22px, cards 16px, controls 10px, chips 7px,
  **data cells 2px**. Data stays crisp; chrome is soft.
- Depth is layered and always offset: `0 1px 2px rgba(0,0,0,.5), 0 12px 32px -10px rgba(0,0,0,.7)`.
  No zero-offset glows.
- `backdrop-filter: blur(20px) saturate(160%)` on exactly two elements — the top bar
  and the floating pager. Nowhere else; it is an effect, not a texture.
- Hairlines carry structure. Heavy borders do not exist in this system.

## Motion

One spring, defined once as `--spring` (a `linear()` curve), used for every state
change. `prefers-reduced-motion` drops travel and stagger, keeps opacity.

**Press is fast, release springs.** A spring is a ~380ms curve; running it on the
way *down* makes a control appear to lag the thumb by a third of a second, which
is the single largest reason an app that is fast still feels slow. Every pressable
element therefore takes an 85ms ease on `:active` and springs back on release —
the two directions of a physical button.

**The entrance plays once per screen.** A staggered arrival is a first impression.
On a tab this operator swipes to fifty times a day it stops being polish and
becomes a toll: the last section used to settle ~720ms after the thumb landed.
Screens are marked `.seen` after their first paint and never animate in again.

Budget, measured not guessed: tab switch **~4ms** of render and no animation on
return; sheet open **420ms**; scroll-reveal **300ms**; bar growth **420ms**.
Anything that tracks a finger — the condensing title, the strip playhead — is
either untransitioned or under 200ms, because a curve between the finger and the
pixel reads as lag.

## Chrome versus content

A control that does not scroll, is always true, and belongs to the screen rather than to
the data is **chrome**, and chrome lives in the header. The Business segment bar was built
three times as a sticky element inside the scroll area and was wrong the same way each
time — a strip of page background parked under the title, reading as a black band with
content sliding behind it.

The trap worth recording: **`position: sticky; top: 0` resolves against the scroll
container's padding box, not its border box.** A screen with 22px of top padding gives a
sticky child a 22px floor that no negative margin can cross; the margin only moves the
static position before sticky pulls it back. Every fix that stays inside the scroll area is
therefore arithmetic against that floor, which is the smell that says the element is in the
wrong place.

Moved into the header it inherits the blurred material, needs no z-index, no gradient and
no offsets, and the failure mode cannot recur.

## The fourth tab is called Business

It was **Pulse**, and Pulse was the one word in `Rooms · Month · Ask · Pulse` that came
from the category's stock cupboard — the same reason blue is banned here. It also lied
twice: a pulse is a reading taken at this instant, and fourteen of this screen's fifteen
cards are a nine-week projection or a history; and a pulse is something you *take*, while
the lead segment has buttons that change the book.

The deciding test was not the segment names but **what is on screen when you land**: two
*"Is BH-101 back in service?"* cards with buttons, *"Clean 2 flats today"*, *"Collect
₹11,700"*. That is a to-do list, not a figure — which is why **Numbers**, the obvious
plain-English candidate, mislabels it just as surely.

What every card here actually has in common is that it is a question the operator would
ask about their own business: *what a night is worth · what you are owed · where bookings
come from · how your book fills · which nights sell · how long people stay · what upkeep
costs · whose work sticks · what is worth doing now.* The screen's own subtitle had been
saying it all along — **"What to act on, and how the book looks"** — and that sentence
reads correctly under a plain noun and awkwardly under a metaphor.

`Rooms` remains both a tab and a segment inside Business, by the user's decision. In speech
the two now disambiguate by their container ("the Rooms tab" against "Business, Rooms"),
which is weaker than distinct words but is a known, chosen cost rather than an oversight.

## The finished picture must be a layout, not a pile of transforms

The guest-move stage flies a chip from the room being emptied into the room the guest is
going to. The flight was right and the landing was wrong in a way that could not be styled
out: the chips stayed children of the **left** room while sitting over the **right**
column (measured: 109×48px of a destination row covered), the emptied room kept 120px of
padding reserved for guests who had left, and `.mroom.a.emptied b` cascaded into the chip
so a landed guest's name computed near-black on a near-black chip — invisible in *both*
themes.

Three symptoms, one cause: **the finished state was a set of transforms rather than a
layout.** The fix is architectural. The DOM's final state is now the truth — after the
move each guest is a real flow child of their destination card, and a hard refresh would
draw exactly what you see. The animation is FLIP: measure where the chip is, reparent it,
measure again, play the difference off. Nothing survives the flight but ordinary layout.

Three rules fell out of it and are worth keeping:

- **Style direct children, not descendants.** `.mroom b` reached into the guest chips. Every
  colour rule on a card is now scoped to `> .mhead > b`.
- **An element that animates needs its own class.** `.movestage.carrying .mguest` matched the
  dashed placeholder berths too, so two motionless elements performed the carry. It is
  `.mguest.flying` now.
- **One box per job.** The shell takes the FLIP translate, an inner box takes the arc and the
  lift, and a third holds the content. Collapsing the middle one meant the arc ran on a box
  with no background, and at the apex the text leaned 12.5px out past its own chip edge.

Horizontal was always the right reading — across is a picture of a journey, a vertical
stack is a picture of a list. A rewrite that "fixes" a component by changing what it says
has not fixed it.

## Both cards change state, so both speak the same language

The room being emptied went from booked to **lit** — this app's one rule, a vacant room is
the lit one. The destinations did something else entirely: they started as a neutral card
and only gained a border, so the left card made a dramatic colour move and the right ones
made almost none. That is why the change read as arbitrary rather than as meaning.

A destination that takes a guest **is booked**, so it now takes the booked material. One
room lights up, the others go to the booked tone, and the picture states what actually
happened rather than decorating it.

## The room opens, then the guest walks in

The destination used to show a dashed outline of the guest before anyone had agreed to
anything. It reserved exactly the right space, which made the animation easy — and it read
as *already moved*, which is the app answering a question it has not been asked.

So the destination starts empty, and the motion became two beats instead of one, in the
order those two things happen in life: **the room opens to make space, then the guest walks
across.** Running them together is what makes an animation feel wrong here — the landing
point is still moving while something is travelling towards it.

Three rules keep every edge honest through it:

- **What travels is a clone, in a flight layer above everything.** A row that grows must clip
  its contents, so anything animating *out* of it gets cut in half. Nothing that flies is
  inside a box that is resizing.
- **The real chip is already in its destination, hidden.** So the space held open is exactly
  right, and the landing is a *reveal* rather than a re-layout — no reflow at the moment
  your eye is on the arrival.
- **The room resizes on `grid-template-rows`, not `height`.** The row is the only thing that
  changes, the compositor keeps the chips crisp through it, and there is no half-pixel text
  reflow on the way.

Reduced motion is the same **event**, not a different one: whoever left still has to stop
being where they were. The first version landed the arrival without hiding the departure,
which put the same guest in two rooms at once.

## Raised means raised in both themes

`.mguest` was `--surface` on a `--surface-2` card: darker than its card in dark, lighter
than its card in light. In a system whose one rule is *the vacant room is the lit one*, an
element that reads raised in one theme and recessed in the other is a language error, not
a shade being slightly off. `--raise` is the token for "one step above whatever this sits
on" — `#1F2330` in dark, `#FFFFFF` in light — because dark's ladder climbs and light's
descends, so "raised" is genuinely not one colour.

## A dead end still answers

Where the app can suggest a way forward it shows a card. Where it cannot, it says so in one
muted line in the same slot — deliberately not a card, so a dead end never looks like
something to tap. "Nowhere free to put A. Fernandes for all 9 of their nights" is a shorter
sentence than the offer and a more useful one than nothing: without it the operator is left
wondering whether the app looked.

## The `:last-child` caption trap

`.bkcap span:last-child { flex: 0 0 120px; text-align: center }` was written for a two-part
caption over a `[wide][narrow]` control pair. A caption with **one** span matches
`:last-child` as well, so every lone label in the app — "Why is it out", "How much can it
wait" — was being squeezed into 120 centred pixels and wrapped mid-phrase. `:not(
:first-child)` is the whole fix. The lesson is narrower than it looks: a positional selector
written for a known sibling count silently claims the one-child case too.

## References considered and declined

**BoardUI** (a React dashboard system, 50+ components, 400+ tokens) was raised as a
reference. Its *thinking* is worth having — dense cards, clear metric hierarchy, an action
beside every number — and the Business rebuild uses it. Its **look** is deliberately not
adopted. This app has one committed world: vacancy is the lit thing, near-monochrome, a
single accent that only ever means *now*. A general-purpose dashboard skin over that would
cost the only property that makes it not look like every other tool.

The rule when a reference arrives: take the reasoning, refuse the surface, unless the brief
itself asks for a new world.

## Prohibitions

- No paper, ruling, stamps, or any ledger device. That world is discarded.
- No blue accent, no purple-to-blue gradient, no gradient text.
- No colour on a booked cell beyond `--held`. Two shouting states destroys the scan.
- No `border-left` accent rails on cards or list rows.
- Never a non-tabular figure in a column of figures.
