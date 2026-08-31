#!/usr/bin/env python3
"""Replace every real guest name in the shipped BOOK with an invented one.

    python3 anonymise-book.py            # report
    python3 anonymise-book.py --write    # and rewrite index.html

WHY.

index.html is a public file on a public URL, and the app's own front door
offers to "Browse an invented set of bookings" — which called seedRealBook()
and loaded 706 real stays under 441 real guests' names. The button, the header
chip and the toast all said the data was invented. It was not.

The data has to stay for two reasons that are not negotiable: the demo door
needs something behind it, and the 73-test suite runs against this book — the
fixtures it needs (a turnaround tonight, a long tenancy with no check-out, a
month thin enough to fail the coverage gate) are properties of THIS shape, and
a smaller or tidier book stops testing what shipped.

So the shape stays and the people go. Every structural property survives:
the same stays on the same nights in the same flats for the same money, the
same repeat guests repeating, the same name lengths so the row that fades an
over-long name still has one to fade. Only the identities are invented.

One real name maps to exactly one invented name, so a guest who appears four
times still appears four times as the same person — which is what the repeat
lookup in Ask is built on and what would break if names were randomised per
row. Placeholders the importer writes for a nameless cell ("Guest", "Long
stay") are not people and are left alone.
"""
import re, sys, collections

SRC = "index.html"
NOT_A_NAME = re.compile(
    r'^(guest|long stay|block(ed)?|maintenance|owner( use)?|na|n/a|-+|\?+|pest|clean)$', re.I)

# Invented. Common enough to read as real names in a demo, and checked below
# against the book so an invented name can never collide with a real one.
GIVEN = """Aarav Vihaan Reyansh Anaya Aadhya Ishaan Kabir Myra Aarohi Vivaan
Rudra Saanvi Advait Kiara Arjun Diya Neel Riya Ansh Tara Yuvan Meher Dhruv
Avni Kian Nitya Veer Sia Aryan Pari Rehan Zara Kabya Ira Shaurya Anika Devansh
Naina Ayaan Mira Laksh Aisha Nirvaan Kavya Ronit Isha Samar Priya Ahaan Nyra
Vihan Sara Reyan Amaira Krish Tanvi Ekansh Ojas Bhavya Charvi Dhanvi Eshan
Gauri Harsh Inaya Jiya Kunal Lavanya Manav Nidhi Omkar Palak Rohit Sneha
Tarun Uma Varun Yash Zoya Anvi Bodhi Chirag Damini Farhan Gitika Hriday
Ivan Jhanvi Kartik Leela Mohit Nakul Oorja Pranav Rhea Sahil Trisha Utkarsh
Vanya Wasim Yamini Zain Aditi Bhuvan Chetan Deepika""".split()
SURNAME = """Rao Nair Menon Iyer Reddy Sharma Verma Kapoor Malhotra Bose
Chatterjee Pillai Shetty Hegde Kulkarni Joshi Desai Bhat Naidu Prasad
Varma Sinha Ghosh Dutta Mishra Pandey Tiwari Saxena Bajaj Chopra""".split()

src = open(SRC).read()
start = src.index("const BOOK = [")
end   = src.index("\n];", start)
body  = src[start:end]

# SIX FIELDS OR SEVEN. A stay the sheet's window cut off carries a seventh, the
# `cut` flag, and 18 of them do — including the longest tenancies in the book.
# A regex that only matched six left those guests' real names in the file and
# the count still read "688 stays", which is why the check at the bottom now
# asserts on names remaining rather than on rows rewritten.
ROW = re.compile(r'\["([^"]+)",(-?\d+),(\d+),"([^"]*)",(\d+),(-?\d+)((?:,-?\d+)*)\]')
rows = ROW.findall(body)
assert rows, "no BOOK rows matched — the table's shape changed"

real = [r[3] for r in rows]
distinct = sorted({n for n in real if n.strip() and not NOT_A_NAME.match(n.strip())})
lower_real = {n.lower() for n in real}
counts = collections.Counter(real)

# ── build the mapping ────────────────────────────────────────────────────────
# Same word count and a similar length, so nothing that depends on how a name
# RENDERS changes: the room row fades an over-long name, and a book whose
# names are all short would stop exercising that.
def hash_of(s):
    h = 0x811c9dc5
    for ch in s:
        h = ((h ^ ord(ch)) * 0x01000193) & 0xFFFFFFFF
    return h

# 380 of the 437 guests are a single word, which is far more than any hand-kept
# list survives. The curated names go first because they read best; past that,
# two syllables joined make as many plausible ones as the book needs.
HEAD = ["Ra","Ri","Na","Ni","Va","Vi","Ma","Mi","La","Li","Ka","Ki","Sha","Shi",
        "Ta","Ti","Da","Di","Ya","Ja","Ha","Pa","Pi","Sa","Si","Tha","Dha","Bha",
        "Cha","Ke","Me","Ne","Re","Se","Ve","Su","Ru","Nu","Ku","Mu"]
# Every HEAD ends in a vowel, so every TAIL starts with a consonant: that is
# the seam that reads as a name. Vowel meeting vowel gave "Diish" and "Kiina".
TAIL = ["dev","nesh","vith","man","tav","kul","vir","ya","nika","vita","lina",
        "mali","vana","nish","kur","vansh","jay","veen","tara","moni","dhan",
        "raj","mesh","nav","lith","kesh","van","nay","sha","ni","reth","dita",
        "hira","lesh","mit","noor","pika","sira","tesh","vani"]
def pool_for(words):
    if words >= 2:
        return [g + " " + s for g in GIVEN for s in SURNAME]
    out = list(GIVEN) + list(SURNAME)
    for h in HEAD:
        for t in TAIL:
            # Reject the seam that gives "Diish" and "Kiina": a repeated letter,
            # or two vowels meeting where neither is doing any work. An invented
            # name still has to look like somebody could be called it.
            if h[-1].lower() == t[0].lower(): continue
            if h[-1].lower() in "aeiou" and t[0].lower() in "aeiou": continue
            out.append(h + t)
    return out

POOL = {1: pool_for(1), 2: pool_for(2)}
used = set()
def invent(n, want_words, want_len):
    pool = [p for p in POOL[min(want_words, 2)]
            if p.lower() not in lower_real and p not in used]
    if not pool:
        raise SystemExit("ran out of invented names")
    # Nearest length first, so a 4-character guest does not become a
    # 19-character one and quietly change what the room row has to fit.
    pool.sort(key=lambda p: (abs(len(p) - want_len), p))
    pick = pool[hash_of(n) % max(1, min(len(pool), 24))]
    used.add(pick)
    return pick

mapping = {}
for n in distinct:
    w = len(n.split())
    mapping[n] = invent(n, min(w, 2), len(n))

print(f"{len(rows)} stays · {len(distinct)} real guests -> {len(set(mapping.values()))} invented")
print(f"placeholders left alone: {sorted({n for n in real if NOT_A_NAME.match(n.strip())})}")
print("\n  a few of the substitutions, with their repeat counts:")
for n in sorted(distinct, key=lambda x: -counts[x])[:8]:
    print(f"    {n:22} -> {mapping[n]:22} ({counts[n]} stays)")

# ── rewrite ──────────────────────────────────────────────────────────────────
def swap(m):
    flat, st, ni, who, si, amt, rest = m.groups()
    return f'["{flat}",{st},{ni},"{mapping.get(who, who)}",{si},{amt}{rest}]'
new_body = ROW.sub(swap, body)

# the one block that names somebody
blocks_at = src.index("const BOOK_BLOCKS = [")
blocks_end = src.index("\n];", blocks_at)
blocks = src[blocks_at:blocks_end]
named = re.search(r'"Block ([A-Z][a-z]+)"', blocks)
new_blocks = blocks
if named:
    fake = invent(named.group(1), 1, len(named.group(1)))
    new_blocks = blocks.replace(f'"Block {named.group(1)}"', f'"Block {fake}"')
    print(f"\n  block note: 'Block {named.group(1)}' -> 'Block {fake}'")

# ── the comments name people too ────────────────────────────────────────────
# Every rule in this file was learned from a real booking, and the comments say
# whose: "Rajkumar, Ramesh — not Venkatarao". Those are guests, in a public
# file, and a name in prose is as much a name as a name in a table. Rewritten
# through the SAME mapping, so a comment explaining a bug still points at the
# row it is about.
# Names that are also ordinary words. Scrubbing these in prose damages the
# sentence without protecting anybody, because the prose is not using them as
# names in the first place.
# "Deep" is a guest in this book and the first word of "Deep clean", which is
# one of the app's four out-of-service reasons. Rewriting it renamed a UI
# string after a person. The table still anonymises the guest.
ENGLISH = {"early","long","block","guest","direct","services","clean","owner",
           "cash","stay","late","new","open","free","short","deep","mani",
           "sir","room","next","last","first","best","care","park","city"}
prose_hits = {}
def scrub_prose(text):
    for n in sorted(mapping, key=len, reverse=True):
        # Four, not five: "Hima" is a real guest and was surviving in a
        # comment purely because the threshold was one character too high.
        # Word boundaries, not length, are what make this safe.
        if len(n) < 4: continue
        # "early" is a guest in this book AND an ordinary English word, and
        # rewriting it turned "renew a minute early" into "a minute Janav" in
        # five comments. A name written lowercase in the table is not a name
        # the prose is using as one, so prose leaves it alone. The TABLE still
        # anonymises it — only the comments are spared.
        if not n[:1].isupper(): continue
        if n.lower() in ENGLISH: continue
        pat = re.compile(r'(?<![A-Za-z])' + re.escape(n) + r'(?![A-Za-z])')
        found = len(pat.findall(text))
        if found:
            prose_hits[n] = prose_hits.get(n, 0) + found
            text = pat.sub(mapping[n], text)
    return text

leftover = [n for n in mapping if n.lower() in {v.lower() for v in mapping.values()}]
assert not leftover, f"an invented name collides with a real one: {leftover}"

if "--write" not in sys.argv:
    print("\nreport only. Re-run with --write to rewrite index.html.")
    raise SystemExit(0)

# BY CONTENT, NOT BY OFFSET. blocks_at was measured against `src`; new_body is
# a different length from body, so by the time BOOK_BLOCKS was spliced the
# offset pointed into the middle of a comment and cut it in half. The file
# still looked plausible in a diff and would not have parsed.
out = src[:start] + new_body + src[end:]
assert out.count(blocks) == 1, "BOOK_BLOCKS is not unique — cannot splice safely"
out = out.replace(blocks, new_blocks, 1)
# The whole file, not just the part before the table: the comments that name
# guests are scattered through the code they explain, and the table itself now
# holds invented names, so a second pass over it changes nothing.
out = scrub_prose(out)
if prose_hits:
    print("\n  names found in comments:",
          ", ".join(f"{k}->{mapping[k]} x{v}" for k, v in sorted(prose_hits.items())))
open(SRC, "w").write(out)

# ── the proof ────────────────────────────────────────────────────────────────
check = open(SRC).read()
cs, ce = check.index("const BOOK = ["), check.index("\n];", check.index("const BOOK = ["))
after = ROW.findall(check[cs:ce])
assert len(after) == len(rows), f"row count changed: {len(rows)} -> {len(after)}"
for a, b in zip(rows, after):
    assert a[0] == b[0] and a[1] == b[1] and a[2] == b[2] and a[4] == b[4] \
       and a[5] == b[5] and a[6] == b[6], f"a stay moved: {a} -> {b}"
still = sorted({n for n in distinct if n.lower() in {x[3].lower() for x in after}})
assert not still, f"real names still present: {still[:5]}"
print(f"\nwritten. {len(after)} stays, every flat/date/night/source/amount unchanged, "
      f"0 of {len(distinct)} real names remaining.")
