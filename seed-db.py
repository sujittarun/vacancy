#!/usr/bin/env python3
"""Put the book into the database, with the ids the app will agree with.

The alternative was to let the first phone to sign in "adopt" its local copy up.
That works, but it makes whichever phone got there first the authority, and it
leaves the server empty and the operator exposed until somebody does it. Seeding
here makes the database the shared book from the start and both phones simply
pull.

THE WHOLE TRICK IS THE ID. A stay's primary key is derived from what the stay
IS — property, flat code, both dates, and who is in it — by the same hash the
app runs in stableId()/stayKey(). If these ids did not match the app's byte for
byte, every phone that signed in would decide the server's book was a different
book and push a duplicate of all seven hundred rows. The port is verified
against the browser before it is trusted; see the check at the bottom.

Run:  python3 seed-db.py            # dry, prints what it would send
      python3 seed-db.py --write    # actually sends it
"""
import re, json, sys, datetime, urllib.request, urllib.error

HOST = "6900950e-2f8f-4333-a510-93a806cfa500"
URL  = "https://hwbquljbvanlgggemchg.supabase.co"
SEP  = chr(0)

def stable_id(parts):
    """A byte-for-byte port of stableId() in index.html. Four independently
       seeded FNV-1a passes, formatted v5-shaped so Postgres takes it."""
    s = SEP.join("" if p is None else str(p) for p in parts)
    lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
    M = 0xFFFFFFFF
    for L in range(4):
        h = lanes[L] & M
        for ch in s:
            h = (h ^ ((ord(ch) + L) & M)) & M
            h = (h * 0x01000193) & M
            h = (h ^ (h >> 15)) & M
        lanes[L] = h & M
    x = "".join("%08x" % h for h in lanes)
    return x[0:8] + "-" + x[8:12] + "-5" + x[13:16] + "-a" + x[17:20] + "-" + x[20:32]

def build():
    s = open("index.html").read()
    on = datetime.date.fromisoformat(re.search(r'const BOOK_ON = "([\d-]+)"', s).group(1))
    iso = lambda off: (on + datetime.timedelta(days=int(off))).isoformat()
    namekey = lambda x: re.sub(r"\s+", " ", (x or "").strip().lower())

    blds = re.findall(r'\{code:"([A-Z]{2})",\s*name:"([^"]+)",\s*short:"([^"]+)"\}', s)
    inv  = re.findall(r'^  \["([^"]+)",\s*"([A-Z]{2})",\s*(\d+),\s*"([^"]+)",\s*(\d+)\]', s, re.M)
    SRC  = re.findall(r'"([^"]+)"', re.search(r'const SRC = \[(.*?)\];', s, re.S).group(1))
    book = re.findall(r'^\["([^"]+)",(-?\d+),(\d+),"((?:[^"\\]|\\.)*)",(\d+),(\d+)(?:,(\d+))?\],?$',
                      re.search(r'const BOOK = \[\n(.*?)\n\];', s, re.S).group(1), re.M)
    blks = re.findall(r'^\["([^"]+)",(-?\d+),(\d+),"([^"]*)"\],?$',
                      re.search(r'const BOOK_BLOCKS = \[\n(.*?)\n\];', s, re.S).group(1), re.M)

    bid = {c: stable_id(["bld", HOST, c]) for c, _, _ in blds}
    fid = {f[0]: stable_id(["flat", HOST, f[0]]) for f in inv}
    out = {
        "buildings": [{"id": bid[c], "host_id": HOST, "code": c, "name": n,
                       "short_name": sh, "sort_order": i}
                      for i, (c, n, sh) in enumerate(blds)],
        "flats": [{"id": fid[i0], "host_id": HOST, "building_id": bid[c], "code": i0,
                   "floor": int(fl), "unit_type": t, "nightly_rate": int(r), "active": True}
                  for i0, c, fl, t, r in inv],
        "stays": [],
    }
    # One shape for every row: PostgREST refuses a batch whose objects do not
    # share their keys, and a block carries `reason` where a booking carries a
    # guest. Nulls where a column does not apply.
    seen = set()
    def add(flat, st, ni, kind, guest=None, src=None, amt=None, reason=None):
        a, b = iso(st), iso(int(st) + int(ni))
        who = "block:" + (reason or "") if kind == "block" else namekey(guest)
        sid = stable_id(["stay", HOST, flat, a, b, who])
        if sid in seen: return
        seen.add(sid)
        out["stays"].append({"id": sid, "host_id": HOST, "flat_id": fid[flat], "kind": kind,
                             "starts_on": a, "ends_on": b, "guest_name": guest or None,
                             "source": src, "amount": amt or None,
                             "reason": reason or None, "booked_on": a})
    for flat, st, ni, guest, si, amt, cut in book:
        add(flat, st, ni, "booking", guest, SRC[int(si)] if int(si) < len(SRC) else None, int(amt))
    for flat, st, ni, reason in blks:
        add(flat, st, ni, "block", reason=reason)
    return out

def send(table, rows, key, chunk=200):
    done = 0
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        req = urllib.request.Request(URL + "/rest/v1/" + table, method="POST",
              data=json.dumps(part).encode(),
              headers={"apikey": key, "Authorization": "Bearer " + key,
                       "Content-Type": "application/json",
                       "Prefer": "return=minimal,resolution=merge-duplicates"})
        try:
            with urllib.request.urlopen(req, timeout=120): done += len(part)
        except urllib.error.HTTPError as e:
            print(f"  {table} chunk {i}: HTTP {e.code} {e.read()[:240].decode()}")
            return done
    return done

if __name__ == "__main__":
    d = build()
    print(f"  buildings {len(d['buildings'])} | flats {len(d['flats'])} | stays {len(d['stays'])}")
    print(f"  first stay id {d['stays'][0]['id']}  ({d['stays'][0]['guest_name']}, "
          f"{d['stays'][0]['starts_on']})")
    if "--write" not in sys.argv:
        print("\n(dry run — pass --write to send it)")
        raise SystemExit(0)
    key = json.load(open(".secrets/supabase-keys.json"))["service_role"]
    for t in ("buildings", "flats", "stays"):
        print(f"  {t:11} {send(t, d[t], key)}/{len(d[t])}")
