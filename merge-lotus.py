#!/usr/bin/env python3
"""Lotus Pond's floors are one 3 BHK each, not three rooms.

The operator said so; the book proves it. Across 253 overlapping pairs of
LP-x01/x02/x03 there is not ONE with a different guest, and across the 88 stays
those rows describe there is not one where the three rooms carry different
dates. They are the same let, written down three times, because the sheet has a
column per bedroom.

Modelled as three flats it inflated the portfolio by 8 units, tripled Lotus
Pond's sellable nights, and made a fully-let apartment read as three rooms of
which two were often empty. This merges them, and refuses to write anything if
a single rupee or a single let night moves.
"""
import re, sys, json
from collections import defaultdict

SRC = "index.html"
s = open(SRC).read()

# ── the flats ──────────────────────────────────────────────────────────────
FL_OLD = re.compile(r'^  \["LP-([1-4])0([123])", "LP", \1, "3 BHK",\s+6000\],\n', re.M)
old_flats = FL_OLD.findall(s)
# RE-RUNNABLE. import-book.py rewrites BOOK from the sheet — which still keeps a
# column per bedroom — but never touches INVENTORY, so after a re-import the
# flats are already merged and only the book needs it again. Twelve rooms means
# a first run; zero means the inventory half is already done.
already_merged = len(old_flats) == 0 and '["LP-1",' in s
assert len(old_flats) == 12 or already_merged, \
    f"expected 12 trio rooms or an already-merged inventory, found {len(old_flats)}"

# ── the book ───────────────────────────────────────────────────────────────
m = re.search(r'const BOOK = \[\n(.*?)\n\];', s, re.S)
assert m, "BOOK not found"
body = m.group(1)
ROW = re.compile(r'^\["([^"]+)",(-?\d+),(\d+),"((?:[^"\\]|\\.)*)",(\d+),(\d+)(?:,(\d+))?\],?$', re.M)
rows = [(a, int(b), int(c), d, int(e), int(f), int(g or 0)) for a,b,c,d,e,f,g in ROW.findall(body)]
assert len(rows) == body.strip().count("\n") + 1, \
    f"parsed {len(rows)} of {body.strip().count(chr(10))+1} BOOK lines — the row shape changed"

TRIO = {f"LP-{fl}0{n}": fl for fl in "1234" for n in "123"}

def nights_of(rs):
    """Union of nights, so a merge can never invent or lose let time."""
    out = set()
    for r in rs:
        for d in range(r[1], r[1] + r[2]): out.add(d)
    return out

keep, trio_rows = [], defaultdict(list)
for r in rows:
    (trio_rows[TRIO[r[0]]] if r[0] in TRIO else keep).append(r)

merged, report = [], {}
for fl, pool in sorted(trio_rows.items()):
    pool.sort(key=lambda r: (r[1], r[0]))
    used, groups = set(), []
    for i, r in enumerate(pool):
        if i in used: continue
        g = [i]; used.add(i)
        for j in range(i + 1, len(pool)):
            if j in used: continue
            o = pool[j]
            if o[3].strip().lower() != r[3].strip().lower(): continue
            lo = min(pool[k][1] for k in g); hi = max(pool[k][1] + pool[k][2] for k in g)
            if o[1] < hi and lo < o[1] + o[2]: g.append(j); used.add(j)
        groups.append([pool[k] for k in g])
    for g in groups:
        st = min(r[1] for r in g); en = max(r[1] + r[2] for r in g)
        # SUM, never max — see the run-merge bug that lost Rs 2,98,549.
        amt = sum(r[5] for r in g)
        # the source and the cut flags of the row that actually carries the money
        lead = next((r for r in g if r[5]), g[0])
        cut = 0
        for r in g: cut |= r[6]
        merged.append((f"LP-{fl}", st, en - st, lead[3], lead[4], amt, cut))
    report[f"LP-{fl}"] = {"rooms": len(pool), "stays": len(groups),
                          "nights": len(nights_of(pool)), "money": sum(r[5] for r in pool)}

# ── the gate ───────────────────────────────────────────────────────────────
for fl, pool in sorted(trio_rows.items()):
    mine = [r for r in merged if r[0] == f"LP-{fl}"]
    before, after = nights_of(pool), nights_of(mine)
    assert before == after, f"LP-{fl}: {len(before)} let nights before, {len(after)} after"
    b, a = sum(r[5] for r in pool), sum(r[5] for r in mine)
    assert b == a, f"LP-{fl}: Rs {b} before, Rs {a} after"
    # no merged stay may overlap another on the same unit — that would be a
    # double booking the old shape was hiding
    mine.sort(key=lambda r: r[1])
    for x, y in zip(mine, mine[1:]):
        assert x[1] + x[2] <= y[1], f"LP-{fl}: {x} overlaps {y}"

out_rows = keep + merged
out_rows.sort(key=lambda r: (r[0], r[1]))

def fmt(r):
    tail = f",{r[6]}" if r[6] else ""
    return f'["{r[0]}",{r[1]},{r[2]},"{r[3]}",{r[4]},{r[5]}{tail}]'

s = s[:m.start(1)] + ",\n".join(fmt(r) for r in out_rows) + s[m.end(1):]

# ── splice the flats ───────────────────────────────────────────────────────
if already_merged:
    open(SRC, "w").write(s)
    print(json.dumps({"inventory": "already merged, left alone",
                      "stays_before": sum(len(v) for v in trio_rows.values()),
                      "stays_after": len(merged),
                      "book_rows": f"{len(rows)} -> {len(out_rows)}",
                      "per_floor": report}, indent=1))
    raise SystemExit(0)
NEW_FL = "".join(
    f'  ["LP-{fl}",   "LP", {fl}, "3 BHK",     6000],   // rooms {fl}01-{fl}03, let as one\n'
    for fl in "1234")
# drop the twelve room rows, then put the four units back where they were
first = re.search(r'^  \["LP-101", "LP", 1, "3 BHK",\s+6000\],\n', s, re.M)
s = FL_OLD.sub("", s)
s = s[:first.start()] + NEW_FL + s[first.start():]

open(SRC, "w").write(s)
print(json.dumps({"stays_before": sum(len(v) for v in trio_rows.values()),
                  "stays_after": len(merged),
                  "book_rows": f"{len(rows)} -> {len(out_rows)}",
                  "per_floor": report}, indent=1))
