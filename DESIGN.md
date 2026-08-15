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
| `--bg` | `#08090C` | `#F4F5F8` | Page ground |
| `--surface` | `#101219` | `#FFFFFF` | Cards, sheets |
| `--surface-2` | `#181B24` | `#ECEEF3` | Raised controls |
| `--line` | `rgba(255,255,255,.08)` | `rgba(9,11,16,.10)` | Hairlines |
| `--txt` | `#FFFFFF` | `#0B0D13` | Primary |
| `--txt-2` | `#98A1B5` | `#5A6377` | Secondary |
| `--txt-3` | `#5C6579` | `#8A93A6` | Tertiary / labels |
| `--free` | `#EAEFF9` | `#0B0D13` | **Vacant** — the lit state |
| `--held` | `#1B1F2A` | `#DDE1EA` | **Booked** — recessed |
| `--now` | `#FFA23A` | `#C96A00` | Today / live. The single accent. |
| `--hot` | `#FF5F52` | `#D93A2B` | Orphan nights, fully-booked alerts |

Amber is the only accent. It marks *now* and primary actions, nothing else. Blue is
deliberately absent — it is the default accent of every scheduling tool in the
category and carries no meaning here.

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

## References considered and declined

**BoardUI** (a React dashboard system, 50+ components, 400+ tokens) was raised as a
reference. Its *thinking* is worth having — dense cards, clear metric hierarchy, an action
beside every number — and the Pulse rebuild uses it. Its **look** is deliberately not
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
