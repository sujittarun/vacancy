# Architecture

## The decision that shapes everything else

You asked for **one Supabase project per Airbnb host**. I have built **one project, with
hosts as tenants inside it**, and this section explains why — because it is the decision
that is expensive to reverse and it goes against what you asked for.

### Why not a project per host

| | Project per host | One project, hosts as tenants |
|---|---|---|
| Schema change | Apply N times, N chances to drift | Once |
| Credentials | N sets of keys and URLs to route between | One |
| Cost | Each project carries its own compute | One |
| **Your crash and usage stats** | **Live in N separate databases — needs a federation layer you would have to build and maintain** | **One query** |

The last row is decisive. You asked for two things in the same breath: isolate each host,
*and* let you track every app's crashes and usage as the creator. Per-project isolation
makes the second one structurally hard — there is no `SELECT` that spans separate Postgres
instances without you building something to stitch them together.

### What replaces it

Every domain row carries `host_id`, and **Row Level Security** makes it impossible for one
host to read another's rows — enforced by Postgres, not by the application remembering to
filter. This is Supabase's core feature and exactly the case it was designed for.

**Proven, not asserted.** Signed in as a Crescent Stays user with a second tenant's data
present in the same tables:

```
flats visible                              1  (2 exist in the database)
explicitly querying the other host's flats 0 rows
writing into the other host                HTTP 403
reading telemetry as a host                0 rows
```

### The door stays open

The schema is identical either way. If a host ever contractually demands a physically
separate database, that one host moves to its own project and the code points at a
different URL. Nothing has to be redesigned to allow it, so there is no reason to pay for
it now.

---

## Where it lives

| | |
|---|---|
| Organisation | LeoAcademy (`qfcvoakfkztwpspscdpm`) — **rename in the dashboard**, the API cannot do it |
| Project | **Stays Platform** — `hwbquljbvanlgggemchg` |
| Region | `ap-south-1` (Mumbai) — nearest to Hyderabad |
| URL | `https://hwbquljbvanlgggemchg.supabase.co` |
| First tenant | Crescent Stays (`crescent-stays`) |

> **Billing, and the thing only you can do.** Your Pro subscription is on the **GenAlpha**
> org. LeoAcademy is still **free**. Supabase bills per organisation and a subscription
> cannot be moved between them — see *Next steps*.

---

## Schema

### Tenancy

- **`hosts`** — one row per Airbnb operator. Crescent Stays is one row.
- **`memberships`** — `user → host` with a role (`owner` / `manager` / `staff`).
- **`platform_admins`** — you. Reads telemetry across every host, and **no host's guest
  data**. RLS is on with *no policies*, which denies everything through the API; rows are
  added out of band. Supabase's advisor flags this as INFO — it is the intended state.

### Inventory

- **`buildings`** — TreeTops, Telecom Nagar, Madhapur, Banjara Hills, Lotus Pond.
- **`flats`** — `TT-101`, unit type, floor, nightly rate, active flag.

### `stays` — bookings and blocks in one table

Both occupy nights, so every availability question has to consider both. Splitting them
would only mean joining them back together in every query. A `kind` column separates
`booking` from `block`.

`ends_on` is **exclusive**: a guest occupies `[starts_on, ends_on)` and leaves the morning
of `ends_on`. That is what makes a same-day turnaround expressible at all.

**Double-booking is structurally impossible**, not merely discouraged:

```sql
exclude using gist (
  flat_id with =,
  daterange(starts_on, ends_on, '[)') with &&
)
```

The app already refuses overlaps, but with two phones in play the app cannot be the
authority. Verified:

```
book 10–14 Sep                  201  accepted
book 12–16 Sep (overlaps)       400  rejected
book 14–17 Sep (same-day turn)  201  accepted   ← a naive check would wrongly reject this
block 11–12 Sep over a guest    400  rejected
block 20–22 Sep (free)          201  accepted
ends before it starts           400  rejected
```

---

## Telemetry — how each host's app is behaving

`app_sessions`, `app_events`, `app_errors`. The app writes; **only platform admins read**.
A host cannot read even its own telemetry, so nothing leaks through a shared table.

**No guest data ever enters telemetry.** Names, notes and rates stay in the host's own
tables. Event props carry counts and ids only. This is a deliberate boundary: the moment
crash reports contain guest names, a support conversation becomes a data breach.

Three operator views, `security_invoker` so they inherit the caller's RLS:

- `ops_host_usage` — events, sessions and distinct users per host per day
- `ops_host_errors` — errors grouped by message and app version, with first and last seen
- `ops_feature_use` — which features each host actually uses

`app_sessions` originally carried `last_seen_at` and an UPDATE policy to maintain it. In
Postgres an UPDATE must first SELECT the row, and the only SELECT policy on that table is
the platform-admin one — so a host's heartbeat would have silently updated zero rows
forever. Both are dropped. `ops_host_usage` derives last activity from
`max(app_events.created_at)`, which needs no extra round trip from a phone on one bar and
cannot drift from the events it summarises.

---

## Next steps, in order

1. **Billing — only you can do this.** Supabase bills per organisation and a plan cannot be
   transferred. To get Pro on this project either:
   - upgrade **LeoAcademy** to Pro (and downgrade GenAlpha if you do not want two bills —
     but note GenAlpha-manager would then pause when idle), **or**
   - transfer *GenAlpha-manager* into LeoAcademy first, so everything sits under one Pro
     subscription.

   Until then the project is on the free tier: it pauses after about a week idle, which is
   fine for building and wrong for your friend's live trial.

2. **Rename the org** in the dashboard. The Management API has no endpoint for it.

3. **Change the app password.** A login for `tarun.sujit@gmail.com` exists, is the owner of
   Crescent Stays and a platform admin. Its generated password is in
   `.secrets/crescent-login.txt` (gitignored, `chmod 600`) and has never been printed.
   Change it in the dashboard under Authentication → Users.

---

## How the app talks to it

Still one self-contained HTML file, no build step and no dependencies — the Supabase
REST and auth endpoints are plain HTTP, so a client library would have meant fetching
~50KB at boot to do what about eighty lines do here. The publishable key is embedded in
the file, which is safe: it grants nothing on its own, and an anonymous caller holding it
reads zero rows.

**Two modes, and the pill in the top bar always says which.** *Sample* is the public link —
invented data, `localStorage`, no account, so it can be handed to anyone. *Live* is signed
in, with the database as the book.

Three rules shape the client.

1. **Reads are cache-first.** This is used mid-call in a lift with one bar. The cached book
   paints immediately and the network corrects it; a dead signal shows yesterday's book
   rather than a spinner.
2. **Writes apply locally first and travel afterwards.** Nobody holding a phone to their ear
   waits for a round trip. The queue persists across app restarts and drains on reconnect.
   Every insert carries a client-generated UUID that *is* the row's primary key, so a retry
   after a flaky connection collides with itself (`23505`) and is treated as the success it
   actually was — it cannot create the booking twice.
3. **Because of 2, the server can still say no.** Then the local entry is rolled back and
   the operator is told who took the room.

### What the loser sees

This was the open question, and the answer is: the booking that beat them.

> **TT-104 was taken.** T. Nayar holds 13–16 Aug — entered on another phone. Your booking
> for P. Rao was not saved.  **See TT-104 →**

On `23P01` the client re-reads the flat's overlapping stays, names the winner and dates,
pulls the real booking into the local book, and offers a tap through to that room. "Conflict"
would tell an operator nothing; a name and dates let them get back on the call and offer
something else.

### The race that had to be got right

A booking cancelled moments after it was made is common — a caller changes their mind
mid-sentence. If its insert is still queued, the insert and the cancellation are torn up
together and neither travels. If the insert is already **in flight** it is going to land
whatever the client does, so a delete is queued behind it instead. Treating those two
cases the same strands a phantom booking on the server that no phone remembers — the
first version of this code did exactly that, and the test that caught it is why the
`inflight` reference exists.

### Telemetry

`app_sessions` on boot, batched `app_events` every 15s and on `pagehide`, `app_errors` from
`window.onerror` and `unhandledrejection`. Props carry counts and screen names — never a
guest name, note or rate. A failure to report is always swallowed: telemetry must never
cost the operator anything.

## Still to do

- **No export.** The data is safe but there is no download button.
- **One login per property.** A second person is a `memberships` row, not yet a screen.
- **No channel sync.** Airbnb and Booking.com bookings are still entered by hand.
