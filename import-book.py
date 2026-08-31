#!/usr/bin/env python3
"""Read Crescent Stays' Availability tab into the BOOK table in index.html.

    python3 import-book.py "~/Downloads/Copy of Revenue.xlsx"     # report only
    python3 import-book.py "…/Copy of Revenue.xlsx" --write       # and splice

The workbook is the operator's own and is NOT in this repo. This script is,
because the import is a claim about their business and a claim needs a proof:
it finishes by rebuilding occupancy from the stays it produced and comparing it
with the sheet it read, night by night, flat by flat. If that does not come out
at zero, nothing is written.

The sheet is one column per flat, one row per night, and the cell is whatever
the operator typed that night. Every rule below is a habit of theirs, read off
all 688 distinct cells in the window — not a guess about how a sheet might be
kept. See DESIGN.md, "An import is a claim, and a claim needs a proof".
"""
import sys, os
import openpyxl, datetime, re, json, collections

# The day the offsets in BOOK are measured FROM. Read from the clock, never
# pinned: a hardcoded date is right on the day it is written and silently wrong
# every day after. The app is given this date too (BOOK_ON) and shifts by the
# difference, so a book exported on Saturday still says Saturday on Tuesday.
TODAY = datetime.date.today()
BACK, FWD = 95, 80
SOLD_OUT = ("vasavi", "mumba")            # sold; not part of the book any more

# what the operator writes when a flat is not sellable
BLOCKY = re.compile(r'^\s*(block|pest|kitchen|clean|maint|repair)', re.I)

# channel markers, written inline with the name
# A marker glued to a name is still a marker. \b does not hold between "T" and
# "b", so "AMITbnb" read as a DIRECT booking by a guest called AMITbnb, while
# "ADITYA bnb" read correctly — the exact lesson MONEY below already carries
# for "Swaroop2650", applied to the channel it was never applied to.
MARKERS = [(re.compile(r'expedia', re.I), "Expedia"),
           (re.compile(r'\.com\b|booking', re.I), "Booking.com"),
           (re.compile(r'agoda', re.I), "Agoda"),
           (re.compile(r'\bmmt\b', re.I), "MakeMyTrip"),
           (re.compile(r'vijay', re.I), "Agent"),
           (re.compile(r'bnb', re.I), "Airbnb")]

# A "10/48" is not money and not a name. The second number increments night by
# night on the same guest (NARENDRA runs 10/42 → 10/49), so it is a running
# count the operator keeps in the cell. Read as part of the name it made eight
# one-night bookings out of one eight-night stay. Dropped, not guessed at.
PERNIGHT = re.compile(r'(\d+(?:\.\d+)?)\s*(k)?\s*/\s*(?:night|day|nt)\b', re.I)
COUNTER = re.compile(r'\b\d+(?:\.\d+)?\s*/\s*\d+(?:\.\d+)?\b')
# ₹ in the shapes that appear: 10k / 6.5K / SWATHI3k, 44,100, a bare 5000, and
# "28.5" — the same k shorthand with the k left off, which lands in the
# thousands every time it appears and nowhere sensible read as rupees. The
# leading guard is (?<![\d.,/]) rather than \b because the operator writes
# "Swaroop2650" and "SWATHI3k" with no space, where \b does not hold.
MONEY = [(re.compile(r'(?<![\d.,/])(\d+(?:\.\d+)?)\s*[kK]'),        lambda m: round(float(m.group(1)) * 1000)),
         (re.compile(r'(?<![\d.,/])(\d{1,3}(?:,\d{3})+)(?![\d.])'),  lambda m: int(m.group(1).replace(",", ""))),
         (re.compile(r'(?<![\d.,/])(\d{4,6})(?![\d.,/kK])'),          lambda m: int(m.group(1))),
         (re.compile(r'(?<![\d.,/])(\d{1,3}\.\d)(?![\d.,/kK])'),    lambda m: round(float(m.group(1)) * 1000))]
# a bare 1–3 digit number is pax, or nights, or something only they know. It is
# never treated as money: an invented amount is worse than a blank one.
SMALL = re.compile(r'(?<![\d.,/])\d{1,3}(?![\d.,/kK])')

def money(s):
    """Every ₹ token in the cell, summed, and the cell with them removed.

    Summed rather than first-or-largest because the only two cells carrying more
    than one amount join them with a plus — "SUSHMA 13650+cash23.4k" and
    "MUSTAFA bnb+14.6+22.5" — which are one stay paid in two parts, not two
    readings of the same figure. Taking the first gave ₹4,000 for a ₹37,050
    stay and left the rest of the money sitting in the guest's name."""
    total = 0
    for pat, val in MONEY:
        out, at = [], 0
        for m in pat.finditer(s):
            total += val(m); out.append(s[at:m.start()]); at = m.end()
        out.append(s[at:]); s = " ".join(out)
    return total, s

def read(cell):
    """-> (guest, src, amount) for a booking, ('', 'block', note) for a block."""
    # Three nights are recorded as a bare number with no name at all: the night
    # was sold for that and who took it was not written down. That is a stay,
    # not a blank, and str() on it gives "4200.0", whose trailing ".0" used to
    # survive into the guest name as "0".
    if isinstance(cell, (int, float)):
        return ("Guest", "Direct", round(float(cell))) if cell else None
    raw = str(cell).strip()
    if not raw: return None
    if BLOCKY.match(raw): return ("", "block", raw)
    src, s = "Direct", raw
    for pat, name in MARKERS:
        if pat.search(s): s = pat.sub(" ", s); src = name
    # One cell in the book quotes a rate rather than a total — "RAKESH
    # 2625/night". Multiplying it out is the operator's own arithmetic, not the
    # app's invention, so it is the one derived figure here and it is marked.
    per = PERNIGHT.search(s)
    if per: s = PERNIGHT.sub(" ", s)
    s = COUNTER.sub(" ", s)
    amount, s = money(s)
    if per: amount = -round(float(per.group(1)) * (1000 if per.group(2) else 1))
    s = SMALL.sub(" ", s)
    s = re.sub(r'[+]|\bcash\b', " ", s, flags=re.I)
    s = re.sub(r'\s+', " ", s).strip(" -.,/+")
    if not s:
        # the cell named only a channel or an agent. Keep the word when it names
        # somebody, because that is who the operator will look for.
        w = re.sub(r'[^A-Za-z ]', '', raw).strip()
        s = w if len(w) > 3 else "Guest"
    up = s.upper()
    if   up == "LONG":  s = "Long stay"
    elif up == "CALEB": s = "Caleb"
    elif s == up:       s = s.title()
    return (s, src, amount)

BOOK_XLSX = os.path.expanduser(sys.argv[1]) if len(sys.argv) > 1 else "Copy of Revenue.xlsx"
wb = openpyxl.load_workbook(BOOK_XLSX, data_only=True, read_only=True)
rows = list(wb["Availability"].iter_rows(values_only=True))
cols = [(i, str(h).strip()) for i, h in enumerate(rows[1])
        if h and i > 0 and str(h).strip().lower() != "vacancy"
        and not any(k in str(h).lower() for k in SOLD_OUT)]

# the sheet's column headers are not the app's flat ids
NAME = {"G02rd":"G02", "M 1":"M1", "M 2":"M2", "M 3":"M3", "M 4":"M4",
        "TG 1":"TG1", "TG 2":"TG2", "1A 3hk":"1A", "4A PH":"4A"}
def flat_id(k, h):
    h = h.split("\n")[0].strip()
    if h in NAME: return NAME[h]
    if h.startswith("MG"): return "MG"
    if h.startswith("Studio"): return None            # resolved positionally below
    return h

by_off = {}
for r in rows[2:]:
    d = r[0]
    if isinstance(d, datetime.datetime): d = d.date()
    if not isinstance(d, datetime.date): continue
    off = (d - TODAY).days
    if -BACK <= off <= FWD: by_off[off] = r

# TreeTops and Lotus Pond both label their columns 101.0/102.0/…, so the id has
# to come from position: the first run belongs to TreeTops, the second to Lotus
# Pond, whose fourth flat on each floor is the studio.
seen_numeric = 0
ids = []
for k, h in cols:
    fid = flat_id(k, h)
    if fid is None or re.fullmatch(r'\d{3}\.0', h.strip()):
        seen_numeric += 1
    ids.append((k, h, fid))
if "--cols" in sys.argv:
    for k, h, f in ids: print(f"  col {k:3} {h!r:24} -> {f}")

# ── resolve the two numeric blocks by position, then read the book ───────────
FIX = {}
for k, h, f in ids:
    if k <= 12 and re.fullmatch(r'\d{3}\.0', h.strip()):        # TreeTops
        FIX[k] = "TT-" + h.strip()[:3]
    elif k >= 44:                                               # Lotus Pond
        n = re.search(r'(\d{3})', h.replace("\n", " "))
        FIX[k] = "LP-" + n.group(1)
    else:
        FIX[k] = f
assert all(FIX.values()), [k for k in FIX if not FIX[k]]

offs = sorted(by_off)
FIRST, LAST = offs[0], offs[-1]
# Rows outside the window still decide whether a run has an END. The sheet
# reaches 2027, and TreeTops' four tenancies run to the last row of it — 810
# nights in TT-101's case. Reading only the window made every one of them look
# like a 176-night stay checking out on the window's final day, and 176 is not
# a fact about anybody's tenancy: it is BACK + FWD + 1. See the note on `cut`.
edge = {}
for k, h, _ in ids:
    fid = FIX[k]
    before = after = None
    for r in rows[2:]:
        d = r[0]
        if isinstance(d, datetime.datetime): d = d.date()
        if not isinstance(d, datetime.date): continue
        off = (d - TODAY).days
        v = r[k]
        v = None if v is None or not str(v).strip() else read(v)
        if off == FIRST - 1: before = v
        if off == LAST + 1:  after = v
    edge[fid] = (before, after)

runs, gaps = [], collections.Counter()
for k, h, _ in ids:
    fid = FIX[k]
    cur = None
    for off in offs:
        cell = by_off[off][k]
        v = read(cell) if cell not in (None, "") else None
        if v is None:
            if cur: runs.append(cur); cur = None
            continue
        guest, src, amt = v
        key = (guest, src) if src != "block" else ("", "block")
        if cur and cur["key"] == key and cur["start"] + cur["nights"] == off:
            cur["nights"] += 1
            if src != "block" and amt:
                # SUMMED, not max. The operator writes money per NIGHT, and the
                # proof is their own price columns in the monthly sheets: MG in
                # May 2026 carries "Sriram Chess Assoc" on thirteen nights at
                # 2,500 each and totals 32,500. max() reported 2,500 for a
                # 32,500 stay. Across the book it dropped 2,20,998 rupees of
                # money the operator had actually written down, and the
                # occupancy gate could never see it: that gate counts nights.
                cur["amount"] = amt if amt < 0 else cur["amount"] + amt
            continue
        if cur: runs.append(cur)
        cur = {"flat": fid, "start": off, "nights": 1, "key": key,
               "guest": guest, "src": src, "amount": amt if src != "block" else 0,
               "note": amt if src == "block" else None}
    if cur: runs.append(cur)

# ── what the window cut off ──────────────────────────────────────────────────
# 1 = the stay was already running when the window opens
# 2 = it is still running when the window closes — NO CHECK-OUT IS RECORDED
# The app must not print a date for a 2. A check-out the operator never wrote
# down, rendered in the same type as one they did, is the single worst thing
# this file can do, and it shipped: "Long stay is in until 18 Nov" on the room
# sheet and a typed date cell in the export, for a tenancy the sheet runs to
# November 2027 without ending.
for r in runs:
    b, a = edge.get(r["flat"], (None, None))
    cut = 0
    if r["start"] == FIRST and b and b[:2] == (r["guest"], r["src"]): cut |= 1
    if r["start"] + r["nights"] - 1 == LAST and a and a[:2] == (r["guest"], r["src"]): cut |= 2
    r["cut"] = cut
    if r["amount"] < 0: r["amount"] = -r["amount"] * r["nights"]; r["derived"] = True

books  = [r for r in runs if r["src"] != "block"]
blocks = [r for r in runs if r["src"] == "block"]

# ── the same parse, for a second reader ──────────────────────────────────────
# merge-book.py compares this book against the one on the server every morning.
# It must read the sheet through THIS code and no other: two parsers over a
# spreadsheet whose rules are all habits — a night counter that is not money, a
# channel glued to a name, a tenancy with no check-out — would be two different
# books, and the merge would spend its life reconciling its own disagreement
# with the importer rather than the operator's with the app.
if "--dump" in sys.argv:
    out = sys.argv[sys.argv.index("--dump") + 1]
    with open(out, "w") as fh:
        json.dump({"today": TODAY.isoformat(), "first": FIRST, "last": LAST,
                   "runs": runs}, fh, indent=1, default=str)
    print(f"{len(books)} stays + {len(blocks)} blocks -> {out}")
    raise SystemExit(0)

# ── the proof ────────────────────────────────────────────────────────────────
# Occupancy rebuilt from the stays, against occupancy counted off the sheet.
# Every habit that broke this import broke it in a way that still RENDERED — a
# night counter read as a name split one eight-night stay into eight one-night
# bookings and left the flat just as occupied — so the check has to be per
# night and per flat, not on any total.
mine, claimed = collections.Counter(), collections.Counter()
for x in runs:
    for k in range(x["start"], x["start"] + x["nights"]):
        mine[k] += 1; claimed[(x["flat"], k)] += 1
theirs = {}
for off, r in by_off.items():
    theirs[off] = sum(1 for k, _, _ in ids if r[k] not in (None, "") and str(r[k]).strip())
off_by = [(o, theirs[o], mine[o]) for o in sorted(theirs) if theirs[o] != mine[o]]
twice  = [k for k, v in claimed.items() if v > 1]
dirty  = sorted({r["guest"] for r in books if re.search(r"\d", r["guest"])})

print(f"\n{len(books)} stays · {len(blocks)} blocks · "
      f"{len({r['guest'] for r in books})} guests · "
      f"{sum(1 for r in books if r['amount'])} with an amount recorded")
print("source mix:", dict(collections.Counter(r["src"] for r in books)))
print(f"\nreconciliation over {len(theirs)} nights × {len(ids)} flats")
print(f"  occupied flat-nights   sheet {sum(theirs.values())}   stays {sum(mine.values())}")
print(f"  nights that disagree   {len(off_by)}   {off_by[:6]}")
print(f"  flat-nights claimed twice   {len(twice)}   {twice[:6]}")
print(f"  guest names still carrying digits   {len(dirty)}   {dirty[:6]}")
# ── the money gate ───────────────────────────────────────────────────────────
# The reconciliation above counts NIGHTS, and said "the stays reproduce the
# sheet exactly" while 2.2 lakh of recorded rupees were being dropped by the
# run merge. A proof about occupancy is not a proof about money, and 24 lakh
# was riding on the difference. Every rupee written in a cell must land in
# exactly one stay.
cellmoney = 0
for k, h, _ in ids:
    for off in offs:
        v = by_off[off][k]
        if v in (None, "") : continue
        got = read(v)
        if got and got[1] != "block":
            a = got[2]
            cellmoney += -a if a and a < 0 else (a or 0)
booked = 0
for r in books:
    a = r["amount"]
    booked += a / r["nights"] if r.get("derived") else a
print(f"  rupees written in cells {round(cellmoney):>12,}")
print(f"  rupees carried to stays {round(booked):>12,}   "
      + ("match" if abs(cellmoney - booked) < 1 else f"LOST {round(cellmoney-booked):,}"))
money_ok = abs(cellmoney - booked) < 1
cutn = [r for r in books if r.get("cut")]
print(f"  stays the window cut ({len(cutn)}) — no check-out is claimed for a 2 or 3:")
for r in cutn: print(f"     {r['flat']:8} {r['guest']:<14} cut={r['cut']}  {r['start']:+d} x{r['nights']}")
ok = not off_by and not twice and not dirty and money_ok
print("\n" + ("PASS — the stays reproduce the sheet exactly" if ok else "FAIL — not written"))
if not ok: sys.exit(1)

# ── emit ─────────────────────────────────────────────────────────────────────
SRCS = ["Direct", "Airbnb", "Booking.com", "MakeMyTrip", "Agoda", "Expedia", "Agent"]
IDX  = {s: i for i, s in enumerate(SRCS)}
rows_b = sorted((([r["flat"], r["start"], r["nights"], r["guest"], IDX[r["src"]], r["amount"]]
                  + ([r["cut"]] if r.get("cut") else []))
                 for r in books), key=lambda r: (r[0], r[1]))
rows_k = sorted(([r["flat"], r["start"], r["nights"],
                  re.sub(r"\s+", " ", str(r["note"])).strip().title() or "Block"]
                 for r in blocks), key=lambda r: (r[0], r[1]))
cell = lambda v: json.dumps(v, ensure_ascii=False) if isinstance(v, str) else str(v)
emit = lambda rs: ",\n".join("[" + ",".join(cell(v) for v in r) + "]" for r in rs)

if "--write" not in sys.argv:
    print("\n(dry run — pass --write to splice into index.html)")
    sys.exit(0)
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
h = open(p).read()
import re as _re
h = _re.sub(r'const BOOK_ON = "[^"]*";', f'const BOOK_ON = "{TODAY.isoformat()}";', h, count=1)
for name, body in (("BOOK", emit(rows_b)), ("BOOK_BLOCKS", emit(rows_k))):
    a = h.index("const " + name + " = [\n") + len("const " + name + " = [\n")
    h = h[:a] + body + h[h.index("\n];", a - 1):]
open(p, "w").write(h)
print(f"\nwritten to {p}")
