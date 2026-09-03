#!/usr/bin/env python3
"""Compare the operator's Availability sheet against the book on the server.

    python3 merge-book.py "~/Downloads/Revenue-2.xlsx"            # report only
    python3 merge-book.py "~/Downloads/Revenue-2.xlsx" --apply    # and insert
    python3 merge-book.py "…xlsx" --from -7                       # widen the window

WHY THIS IS NOT import-book.py.

The importer REPLACES: it reads the sheet, rebuilds the whole book and writes
it over whatever was there. That was correct while the sheet was the only
record. It is now the wrong tool and a dangerous one, because two people are
entering bookings in the app as well — a replace would delete their work
without ever mentioning it.

So this one only ever ADDS. It never deletes a stay, never rewrites one, and
when the two books disagree about the same nights it says so and stops. The
spreadsheet stays the operators' primary record; this keeps the app honest
against it every morning without either book being allowed to erase the other.

The parse comes from import-book.py --dump, because a second parser over a
sheet whose rules are all habits — a night counter that is not money, a channel
glued to a name, a tenancy with no check-out — would be a second book, and this
script would spend its life reconciling its disagreement with the importer
rather than the operator's with the app.

FIVE OUTCOMES, and only the first is written:

  missing   the sheet has a stay, the app's nights are free    -> INSERT
  matched   both agree: same flat, same nights, same guest     -> nothing
  moved     same flat and guest, different dates               -> reported
  clash     both claim the nights, for different people        -> reported
  app-only  the app has a stay the sheet does not              -> reported

"moved" and "clash" are reported rather than resolved on purpose. Either can be
the operator correcting the sheet, or the app being right and the sheet stale,
and nothing here can tell those apart. A human can, in ten seconds, with both
in front of them.
"""
import sys, os, json, re, subprocess, tempfile, datetime, collections
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
seed = import_module("seed-db")            # guarded by __main__, safe to import
HOST, stable_id = seed.HOST, seed.stable_id

SUPA = "https://hwbquljbvanlgggemchg.supabase.co"
KEY  = json.load(open(".secrets/supabase-keys.json"))["service_role"]

def rest(path, method="GET", body=None):
    req = urllib.request.Request(
        SUPA + "/rest/v1" + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"apikey": KEY, "Authorization": "Bearer " + KEY,
                 "Content-Type": "application/json",
                 "Prefer": "return=minimal,resolution=ignore-duplicates"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw else None

# ── the sheet, parsed by the importer ────────────────────────────────────────
xlsx = os.path.expanduser(sys.argv[1])
dump = os.path.join(tempfile.mkdtemp(), "runs.json")
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, "-W", "ignore",
                os.path.join(here, "import-book.py"), xlsx, "--dump", dump],
               check=True, stdout=subprocess.DEVNULL)
parsed = json.load(open(dump))
TODAY  = datetime.date.fromisoformat(parsed["today"])
runs   = parsed["runs"]

# ── Lotus Pond is let as one flat per floor ──────────────────────────────────
# The sheet still keeps a column per room; the app collapsed x01/x02/x03 into a
# single 3 BHK. Same grouping rule as merge-lotus.py: the same guest, on
# overlapping nights, in one floor's trio, is one stay.
TRIO = {f"LP-{fl}0{n}": fl for fl in "1234" for n in "123"}
keep, trio = [], collections.defaultdict(list)
for r in runs:
    (trio[TRIO[r["flat"]]] if r["flat"] in TRIO else keep).append(r)
for fl, pool in trio.items():
    pool.sort(key=lambda r: (r["start"], r["flat"]))
    used = set()
    for i, r in enumerate(pool):
        if i in used: continue
        g = [i]; used.add(i)
        for j in range(i + 1, len(pool)):
            if j in used: continue
            o = pool[j]
            if o["guest"].strip().lower() != r["guest"].strip().lower(): continue
            lo = min(pool[k]["start"] for k in g)
            hi = max(pool[k]["start"] + pool[k]["nights"] for k in g)
            if o["start"] < hi and lo < o["start"] + o["nights"]:
                g.append(j); used.add(j)
        rows = [pool[k] for k in g]
        st = min(x["start"] for x in rows)
        en = max(x["start"] + x["nights"] for x in rows)
        lead = next((x for x in rows if x["amount"]), rows[0])
        keep.append({**lead, "flat": f"LP-{fl}", "start": st, "nights": en - st,
                     "amount": sum(x["amount"] for x in rows),
                     "cut": eval("|".join(str(x["cut"]) for x in rows))})
runs = keep

# ── the window: today onward unless told otherwise ───────────────────────────
FROM = int(sys.argv[sys.argv.index("--from") + 1]) if "--from" in sys.argv else 0
day  = lambda off: (TODAY + datetime.timedelta(days=off)).isoformat()
sheet = []
for r in runs:
    end = r["start"] + r["nights"]
    if end <= FROM: continue                      # finished before the window
    sheet.append({"flat": r["flat"], "a": day(r["start"]), "b": day(end),
                  "guest": r["guest"], "src": r["src"], "amount": r["amount"],
                  "block": r["src"] == "block", "open": bool(r["cut"] & 2),
                  "cut": r["cut"]})      # nonzero: a date here is the window's edge

# ── the server ───────────────────────────────────────────────────────────────
flats = {f["code"]: f["id"] for f in
         rest(f"/flats?select=id,code&host_id=eq.{HOST}")}
after = day(FROM)
live = rest("/stays?select=id,flat_id,kind,starts_on,ends_on,guest_name"
            f"&host_id=eq.{HOST}&ends_on=gt.{after}&order=starts_on")
by_code = {v: k for k, v in flats.items()}
for s in live: s["flat"] = by_code.get(s["flat_id"], "?")

# For COMPARING two books, where "Karpaga Vidhya" and "karpaga  vidhya" are one
# person and punctuation should not make them two.
norm = lambda n: re.sub(r'[^a-z]', '', (n or "").lower())
# For MINTING an id, where the recipe must match index.html's nameKey exactly.
namekey = lambda x: re.sub(r"\s+", " ", (x or "").strip().lower())
overlap = lambda a1, b1, a2, b2: a1 < b2 and a2 < b1

missing, matched, moved, clash = [], [], [], []
claimed = set()
for r in sheet:
    same = [s for s in live if s["flat"] == r["flat"]]
    exact = next((s for s in same
                  if s["starts_on"] == r["a"] and s["ends_on"] == r["b"]
                  and norm(s["guest_name"]) == norm(r["guest"])), None)
    if exact:
        matched.append((r, exact)); claimed.add(exact["id"]); continue
    over = [s for s in same if overlap(r["a"], r["b"], s["starts_on"], s["ends_on"])]
    if not over:
        missing.append(r); continue
    byname = [s for s in over if norm(s["guest_name"]) == norm(r["guest"])]
    if byname:
        moved.append((r, byname[0])); claimed.add(byname[0]["id"])
    else:
        clash.append((r, over[0]))
        for s in over: claimed.add(s["id"])

app_only = [s for s in live if s["id"] not in claimed]

# ── the report ───────────────────────────────────────────────────────────────
w = lambda s: (s["guest_name"] or s["kind"])
print(f"\nsheet {xlsx}")
print(f"window {after} onward · {len(sheet)} stays in the sheet · {len(live)} on the server\n")
print(f"  matched   {len(matched):4}   both books agree")
print(f"  missing   {len(missing):4}   in the sheet, not in the app" + ("   -> would insert" if missing else ""))
print(f"  moved     {len(moved):4}   same guest and flat, different dates")
print(f"  clash     {len(clash):4}   same nights, different guest")
print(f"  app-only  {len(app_only):4}   entered in the app, not in the sheet")

def show(title, items, fmt):
    if not items: return
    print(f"\n{title}")
    for x in items[:40]: print("   " + fmt(x))
    if len(items) > 40: print(f"   … and {len(items)-40} more")

show("MISSING — the sheet has these and the app does not:", missing,
     lambda r: f"{r['flat']:8} {r['a']} → {r['b']}  {r['guest'][:28]:28} {r['src']}"
               + ("  (no check-out written)" if r["open"] else ""))
show("MOVED — same guest, different dates:", moved,
     lambda p: f"{p[0]['flat']:8} sheet {p[0]['a']}→{p[0]['b']}   app {p[1]['starts_on']}→{p[1]['ends_on']}   {p[0]['guest'][:24]}")
show("CLASH — both books claim the nights, for different people:", clash,
     lambda p: f"{p[0]['flat']:8} {p[0]['a']}→{p[0]['b']}  sheet: {p[0]['guest'][:20]:20} app: {w(p[1])[:20]} ({p[1]['starts_on']}→{p[1]['ends_on']})")
show("APP-ONLY — entered in the app, still to be typed into the sheet:", app_only,
     lambda s: f"{s['flat']:8} {s['starts_on']} → {s['ends_on']}  {w(s)[:28]}")

# ── writing, and only ever adding ────────────────────────────────────────────
if "--apply" not in sys.argv and "--apply-moved" not in sys.argv:
    print("\nreport only. Re-run with --apply to insert the missing stays,")
    print("and/or --apply-moved to give a same-guest stay the sheet's dates.")
    print("Nothing in 'clash' or 'app-only' is ever written by this script.")
    raise SystemExit(0)

rows = []
if "--apply" not in sys.argv:
    missing = []                       # --apply-moved alone: inserts are off
elif not missing:
    print("\nnothing to insert.")
for r in missing:
    fid = flats.get(r["flat"])
    if not fid:
        print(f"  ! no such flat on the server: {r['flat']} — skipped"); continue
    # THE ID IS THE STAY, so this recipe has to be the app's to the byte: the
    # flat CODE (not its uuid, which differs per device and is not what
    # stayKey() hashes), and the app's own name normaliser. Getting either
    # wrong mints a second id for a stay that already exists, and the app then
    # treats a row it wrote as somebody else's. Caught by restoring a deleted
    # booking and finding the id had moved.
    who = ("block:" + (r["guest"] or "")) if r["block"] else namekey(r["guest"])
    rows.append({
        "id": stable_id(["stay", HOST, r["flat"], r["a"], r["b"], who]),
        "host_id": HOST, "flat_id": fid,
        "kind": "block" if r["block"] else "booking",
        "starts_on": r["a"], "ends_on": r["b"],
        "guest_name": None if r["block"] else r["guest"],
        "source": None if r["block"] else r["src"],
        "amount": r["amount"] or None,
    })
# ── the shared log hears about it ────────────────────────────────────────────
# The app's timeline is the answer to "what happened to the book today", and a
# merge from the sheet is exactly that. Written the way the app writes its own
# lines — same event name, same props — with no user and a device of "sheet",
# which the timeline renders as "From the sheet".
def said(kind, line, flat, guest=None):
    try:
        rest("/app_events", "POST", [{
            "host_id": HOST, "user_id": None, "session_id": None,
            "name": "act", "app_version": "merge-book",
            "props": {"k": kind, "s": line[:160], "f": flat,
                      **({"g": guest[:40]} if guest else {}), "device": "sheet"}}])
    except urllib.error.HTTPError:
        pass                                   # the log is a courtesy, never a gate

# The exclusion constraint is the authority on whether these nights are free.
# One row at a time so a single refusal cannot take the whole batch with it,
# and so a refusal can be reported against the stay it belongs to.
ok = 0
for row in rows:
    try:
        rest("/stays", "POST", [row]); ok += 1
        code = by_code.get(row["flat_id"], row["flat_id"])
        said("book", f"Booked {row['guest_name'] or 'a block'} into {code} · {row['starts_on']}→{row['ends_on']} · from the sheet",
             code, row["guest_name"])
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:120]
        code = by_code.get(row["flat_id"], row["flat_id"])
        print(f"  ! refused {code} {row['starts_on']}→{row['ends_on']}: {body}")
if rows: print(f"\ninserted {ok} of {len(rows)}. Nothing was deleted or overwritten.")

# ── --apply-moved: the sheet's dates for a stay both books agree exists ───────
# Opt-in, and a change to the contract above, so it is written down. While the
# spreadsheet is the operators' primary record, a stay they extend or shorten
# THERE is a decision the app has to follow — otherwise the app sells nights
# the sheet has as occupied, or holds nights the sheet has freed. "Moved" was
# reported rather than applied because the two cases could not be told apart;
# the owner has since said which book leads. So, for the same guest in the
# same flat: the row keeps its id (payments hang off it) and takes the sheet's
# dates. Two guards stay: a stay the import window cut is skipped, because its
# sheet dates are the window's edges and not anybody's decision; and the
# exclusion constraint still refuses any range that runs into another guest,
# which is reported and left alone. Clashes — different people — are never
# touched here.
if "--apply-moved" in sys.argv:
    done = 0
    for r, s in moved:
        # Only the side the window did not cut is a date anybody chose. A
        # tenancy cut at both ends is skipped whole; one cut at the start but
        # ending inside the window (Swathi, LP-204: the sheet now has her
        # leaving 2 Sep, the app still holds the flat to 1 Oct) has its END
        # applied and its start left alone.
        cut = r.get("cut") or 0
        patch = {}
        if not (cut & 1) and r["a"] != s["starts_on"]: patch["starts_on"] = r["a"]
        if not (cut & 2) and r["b"] != s["ends_on"]:   patch["ends_on"]   = r["b"]
        if not patch:
            print(f"  ~ kept  {r['flat']:7} {r['guest'][:22]:22} sheet dates are the import window's edge, not a change")
            continue
        try:
            rest(f"/stays?id=eq.{s['id']}", "PATCH", patch)
            done += 1
            said("move", f"{r['guest']} in {r['flat']} now {patch.get('starts_on', s['starts_on'])}→{patch.get('ends_on', s['ends_on'])} · from the sheet",
                 r["flat"], r["guest"])
            print(f"  ✓ moved {r['flat']:7} {r['guest'][:22]:22} {s['starts_on']}→{s['ends_on']}  ⇒  "
                  f"{patch.get('starts_on', s['starts_on'])}→{patch.get('ends_on', s['ends_on'])}")
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:100]
            print(f"  ! kept  {r['flat']:7} {r['guest'][:22]:22} the sheet's dates run into another guest: {body}")
    print(f"\nmoved {done} of {len(moved)} to the sheet's dates. Ids kept; nothing deleted.")
