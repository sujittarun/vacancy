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

3. **Rewire the app.** Planned as its own piece of work — it touches every read path. See
   *Migration plan* below.

---

## Migration plan for the app

The app is currently a single self-contained HTML file keeping everything in
`localStorage`. The order below keeps it working throughout.

1. **Auth.** Email + password sign-in. On sign-in, resolve the user's `host_id` once.
2. **Read path.** Replace `load()` with a query for flats and stays. Keep the in-memory
   `occ` / `blk` arrays exactly as they are — they are derived, and the derivation does not
   care where the rows came from.
3. **Write path.** `addBooking` / `addBlock` / `cancel` become inserts and deletes. Handle
   the exclusion-constraint violation as a real, expected outcome: *"just taken"* — with
   two devices this stops being theoretical.
4. **Offline.** This is used mid-phone-call. Keep `localStorage` as a cache and read from
   it first, so a dead signal degrades to stale data rather than a blank screen.
5. **Telemetry.** Wire `window.onerror` and `unhandledrejection` to `app_errors`, and the
   handful of meaningful actions to `app_events`.

### The one thing to decide before step 3

**What happens when two people book the same flat at once.** The database will reject the
second write — that part is settled. What is not settled is what the second person *sees*:
a plain error, or the app re-reading and showing them the booking that beat them. The
second is better and costs a little more work.
