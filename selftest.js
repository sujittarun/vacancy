/* Regression suite — every bug that has been fixed, encoded as the repro that
 * found it.
 *
 *   await import('/selftest.js').then(m => m.run())          (local dev server)
 *   await import('/vacancy/selftest.js').then(m => m.run())  (GitHub Pages)
 *
 * It imports audit.js RELATIVELY, so it works from whatever path it is served
 * at. It used to say "/audit.js", which resolves to the domain root — fine on a
 * dev server rooted at the app, and three failures on Pages, where the app
 * lives under /vacancy/. A test that only passes at one URL is a test that will
 * be believed at the wrong one.
 *
 * WHY THIS EXISTS. Each of these was found by a multi-agent audit that took an
 * hour, fifteen agents and two million tokens, and each was then verified by
 * hand in the console with a probe that was thrown away immediately afterwards.
 * Re-running the audit to ask "is it still fixed?" is paying discovery prices
 * for a regression answer. Discovery finds unknown bugs; this file proves known
 * ones stay dead, in seconds.
 *
 * RULES FOR ADDING ONE. A test goes in here the moment a bug is fixed, not
 * later. It asserts the MEASURED value from the original repro — the actual
 * ₹79,700, the actual 1.13:1 — because a test that only asserts "truthy" fails
 * to notice a fix eroding. And it restores whatever it touched: these run
 * against the live book.
 */

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Wait for a CONDITION, never for a duration. Backgrounded, this tab clamps
   setTimeout to >=1s, so every fixed wait in here either overshoots — a run
   went from 8s to 118s — or undershoots and fails a passing app. Two tests
   reported red for exactly that reason and neither was a real regression. */
async function until(cond, what, ms = 4000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (cond()) return true;
    await wait(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* Transitions and animations do not advance in a backgrounded tab, so a state
   change measured there reports the value it started FROM. Same defence as
   audit.js — see the note there; it cost two false "not fixed" verdicts. */
function freeze(fn) {
  const s = document.createElement("style");
  s.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(s);
  try { return fn(); } finally { s.remove(); }
}

const results = [];
let only = null;

/* Put the app back in a known state before a test starts. A previous test — or,
   as happened, a review agent driving the same tab from another process — can
   leave a sheet open, a gate up, or a theme half-applied, and the next test then
   fails for a reason that has nothing to do with the code under test. Two of
   these reported as regressions once and neither was real. */
async function settle() {
  try { window.closeGate && closeGate(); } catch (e) {}
  try { closeSheet(); } catch (e) {}
  const s = document.querySelector(".sheet");
  if (s) { s.style.transform = ""; s.style.transition = ""; }
  /* SNAP IT SHUT, do not wait for it to slide. closeSheet only removes a class;
     the sheet then leaves on a 0.42s transform transition. Tests that measured
     or hit-tested the screen while it was still on its way out failed for
     reasons that had nothing to do with the code under test — the sheet-drag
     check and the sweep-HUD check both did.
     Waiting for the transition was the obvious fix and it was wrong: a
     backgrounded tab does not advance transitions AT ALL, so the sheet never
     arrives, and a poll for "has it left yet" spins its whole budget on every
     single test. That is the same trap as measuring a colour mid-transition,
     one layer up — a gate that depends on animation, in an environment where
     animation is suspended.
     So take the time out of it: kill the transition, force the layout, put the
     transition back. The sheet is off-screen synchronously, whatever the tab is
     doing. */
  if (s) {
    const prev = s.style.transition;
    s.style.transition = "none";
    void s.offsetHeight;                       // force the closed geometry now
    s.style.transition = prev;
  }
}

async function test(name, fn) {
  if (only && !name.includes(only)) return;
  /* Where the run is, published as it goes. A suite that stops answering tells
     you nothing about WHICH test stopped it, and the pane this is driven from
     hides itself between calls — which clamps every setTimeout to a second and
     turns an 8-second run into a long one that looks identical to a hang. */
  try { window.__now = name; window.__done = (window.__done || 0) + 0; } catch (e) {}
  const snapR = JSON.stringify(resv);
  const snapF = JSON.stringify(flats);
  const attempt = async () => { await settle(); return fn(); };
  try {
    let detail;
    try {
      detail = await attempt();
    } catch (first) {
      /* ONE retry, and only one. A real regression fails deterministically; an
         interference artifact usually does not survive a re-settle. Reporting
         which one it was matters — a test that passes on retry is flagged, not
         silently greened, because a flaky test is its own defect. */
      await wait(400);
      detail = (await attempt()) + "  [flaky: failed once — " + String(first && first.message || first) + "]";
    }
    results.push({ name, pass: true, detail });
    try { window.__done = (window.__done || 0) + 1; } catch (e) {}
  } catch (e) {
    results.push({ name, pass: false, detail: String(e && e.message || e) });
    try { window.__done = (window.__done || 0) + 1; } catch (e) {}
  } finally {
    // every test runs against the real book; put it back exactly
    try {
      if (JSON.stringify(flats) !== snapF) applyInventory(JSON.parse(snapF));
      resv = JSON.parse(snapR);
      recompute();
      window.closeGate && closeGate();
      closeSheet();
    } catch (e) { /* a restore failure is reported by the next test failing */ }
  }
}

const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  return got;
};
const ok = (cond, what) => { if (!cond) throw new Error(what); return true; };

/* ── the suite ───────────────────────────────────────────────────────────── */

export async function run(filter) {
  only = filter || null;
  results.length = 0;

  /* ══ data loss ══════════════════════════════════════════════════════════ */

  await test("a guest who leaves owing survives the next day's rollover", async () => {
    const KEY = STORE;   // the app's own key, not a copy of it — see the v2 bump
    const backup = localStorage.getItem(KEY);
    const owedBefore = owedStats().total;
    save();
    const d = JSON.parse(localStorage.getItem(KEY));
    const back = new Date(d.savedOn + "T00:00:00");
    back.setDate(back.getDate() - 1);
    d.savedOn = back.toISOString().slice(0, 10);
    localStorage.setItem(KEY, JSON.stringify(d));
    load(); recompute();
    const owedAfter = owedStats().total;
    const kept = bookings().filter(r => r.end < 0 && dueFrom(r) > 0).length;
    localStorage.setItem(KEY, backup); load(); recompute();
    eq(owedBefore - owedAfter, 0, "rupees erased by one rollover");
    ok(kept > 0, "no departed-unpaid bookings were kept at all — the grace window is not working");
    return `₹0 erased, ${kept} unpaid departures kept`;
  });

  await test("undo restores a stay that runs past the end of the book", async () => {
    const past = resv.find(r => !isBlock(r) && r.end > DAYS);
    ok(past, "seed has no stay ending past DAYS — this test can no longer see the bug it guards");
    const { fi, guest } = past, n0 = resv.length, end0 = past.end, start0 = past.start;
    cancelWithUndo(past, fi);
    const btn = document.querySelector(".toast button");
    ok(btn, "no Undo button on the cancellation toast");
    btn.click();
    await wait(60);
    eq(resv.length, n0, "row count after undo");
    /* The exact end, not merely "past the horizon". addBooking clamps nights at
       the length of the book, so a 176-night let came back 158 nights long —
       still past DAYS, so a `> DAYS` assertion greened a stay that had lost 18
       nights. The number the row went in with is the number it must come back
       with. */
    const again = resv.find(r => r.fi === fi && r.guest === guest && r.end > DAYS);
    ok(again, "the stay did not come back");
    eq(again.end, end0, "restored end");
    eq(again.start, start0, "restored start");
    eq(again.nights, end0 - start0, "restored nights");
    return `${flats[fi].id} · ${guest} · ${end0 - start0}n restored intact, end ${end0} > DAYS ${DAYS}`;
  });

  /* This test used to assert memory only, and passed while the bug was still
     live: the invented payment sat in localStorage and came back on the next
     reload. A money assertion has to survive a round trip through storage,
     because storage is what the operator's next launch reads. */
  await test("undo does not invent a platform payment — and it stays gone after a reload", async () => {
    const KEY = STORE;   // the app's own key, not a copy of it — see the v2 bump
    const backup = localStorage.getItem(KEY);
    /* Built here rather than found in the book. The bug needs one specific
       shape — a platform stay carrying an amount and NO payment — and which
       shapes a seed happens to contain is not the test's business. The real
       book seeds every platform stay it has an amount for as paid, so hunting
       for this one found nothing and the test reported a missing fixture as if
       it were a result. The state is reachable in the app: openPayment offers
       Platform as a chip and the payment can be removed again, which is
       exactly what is done here. */
    let plat = resv.find(r => !isBlock(r) && PLATFORMS.indexOf(r.src) >= 0
      && r.amount > 0 && (!r.pays || !r.pays.length) && r.start >= 0);
    let built = false;
    if(!plat){
      const fi = flats.findIndex((f, i) => freeSpan(i, 0, 2));
      ok(fi >= 0, "no flat is free for the next two nights, so the fixture cannot be built");
      ok(addBooking(fi, 0, 2, "Fixture Guest", "Airbnb", {amount: 2200}), "fixture booking refused");
      plat = resv[resv.length - 1];
      (plat.pays || []).slice().forEach(pay => dropPayment(plat, pay));   // the unpaid case
      save(); built = true;
    }
    ok(plat, "no unpaid platform booking to test with");
    const { fi, guest, start, amount } = plat, id = flats[fi].id, owed0 = owedStats().total;
    cancelWithUndo(plat, fi);
    document.querySelector(".toast button").click();
    await wait(60);
    const back = resv.find(r => r.fi === fi && r.guest === guest && r.start === start);
    eq((back.pays || []).length, 0, "payments in memory after undo");
    const stored = JSON.parse(localStorage.getItem(KEY)).rows
      .find(r => r.id === id && r.guest === guest && r.start === start);
    eq((stored && stored.pays || []).length, 0, "payments in STORAGE after undo");
    load(); recompute();                              // what pull-to-refresh does
    const after = resv.find(r => r.fi === fi && r.guest === guest && r.start === start);
    ok(after, "the stay did not survive a reload");
    eq(dueFrom(after), amount, "amount still due after a reload");
    eq(owedStats().total, owed0, "owedStats total after a reload");
    localStorage.setItem(KEY, backup); load(); recompute();
    return `${guest} · ${money(amount)} still due through a full reload`
         + (built ? " (fixture built)" : "");
  });

  await test("undo persists a stay that began before today", async () => {
    const KEY = STORE;   // the app's own key, not a copy of it — see the v2 bump
    const backup = localStorage.getItem(KEY);
    const g = resv.find(r => !isBlock(r) && r.start < 0 && r.end > 0);
    ok(g, "seed has no in-house guest who arrived before today");
    const { fi, guest, start, end } = g, id = flats[fi].id;
    cancelWithUndo(g, fi);
    document.querySelector(".toast button").click();
    await wait(80);
    const stored = JSON.parse(localStorage.getItem(KEY)).rows
      .filter(r => r.id === id && r.guest === guest && r.end === end);
    localStorage.setItem(KEY, backup);
    eq(stored.length, 1, "rows in storage for the restored stay");
    eq(stored[0].start, start, "stored start (clamped start means the stay shortens on reload)");
    return `${guest} · start ${start} preserved through save()`;
  });

  await test("closing a not-yet-started outage keeps its bill", async () => {
    const fi = flats.findIndex((f, i) => freeSpan(i, 1, 2));
    ok(fi >= 0, "no flat free tomorrow");
    addBlock(fi, 1, 1, "Maintenance", "compressor", { fault: "AC", fixer: "Ramesh", phone: "9812345678" });
    const b = resv[resv.length - 1];
    eq(blockNudges().some(x => x.r === b), false, "a future outage is on the decide board");
    releaseBlock(b, { fixer: "Ramesh", cost: "4500" });
    ok(resv.indexOf(b) >= 0, "the record was deleted with its invoice");
    eq(b.cost, 4500, "cost kept");
    eq(b.nights, 0, "closed-out block still holds nights");
    eq(freeSpan(fi, 1, 2), true, "the closed block still blocks the night");
    return "record kept, ₹4,500 and fixer intact, blocks nothing";
  });

  await test("a day change triggers the rollover path", async () => {
    ok(typeof rolloverCheck === "function", "no rolloverCheck");
    eq(dayStamp(), bootDay, "dayStamp disagrees with bootDay on the same day");
    const Real = Date, DAY = 86400000;
    window.Date = class extends Real {
      constructor(...a) { super(...(a.length ? a : [Real.now() + DAY])); }
      static now() { return Real.now() + DAY; }
    };
    const tomorrow = dayStamp();
    window.Date = Real;
    ok(tomorrow !== bootDay, "the rollover condition does not fire after midnight");
    return "quiet today, fires on a day change";
  });

  /* ══ destructive controls ═══════════════════════════════════════════════ */

  await test("a bounced tap cannot fire a destructive confirm", async () => {
    const b = document.createElement("button");
    document.body.appendChild(b);
    let ran = 0;
    armConfirm(b, { rest: "✕", armed: "Cancel?", run: () => ran++ });
    b.click(); b.click();                       // same tick — a bounce
    const afterBounce = ran;
    const spin = ms => { const s = performance.now(); while (performance.now() - s < ms); };
    spin(DWELL + 60); b.click();                // a decision
    const afterDwell = ran;
    b.remove();
    eq(afterBounce, 0, "runs fired by a bounced tap");
    eq(afterDwell, 1, "runs fired by a deliberate tap");
    return `blocked inside ${DWELL}ms, accepted after`;
  });

  await test("the armed destructive state is visible in light theme", async () => {
    const m = await import("./audit.js?t=" + Date.now());
    await m.setThemeAndSettle("light");
    openSheet(0, 0);
    await until(() => [...document.querySelectorAll(".rowx")].some(e => e.textContent.trim() === "✕"), "the room sheet to render");
    const x = [...document.querySelectorAll(".rowx")].find(e => e.textContent.trim() === "✕");
    ok(x, "no ✕ on any booking row");
    const rest = freeze(() => getComputedStyle(x).backgroundColor);
    x.click();
    const armed = freeze(() => ({ bg: getComputedStyle(x).backgroundColor, ink: getComputedStyle(x).color }));
    ok(rest !== armed.bg, "armed and resting fills are identical — the operator sees no change");
    const under = m.groundUnder(x.parentElement);
    const bg = m.over(m.parse(armed.bg), under);
    const ratio = m.ratio(m.over(m.parse(armed.ink), bg), bg);
    ok(ratio >= 4.5, `armed label contrast ${ratio.toFixed(2)}:1, needs 4.5`);
    return `fill changes, label ${ratio.toFixed(2)}:1`;
  });

  /* ══ wrong answers ══════════════════════════════════════════════════════ */

  await test("a guest name cannot execute", async () => {
    delete window.__pwn;
    const fi = flats.findIndex((f, i) => freeSpan(i, 0, 2));
    addBooking(fi, 0, 2, '<img src=x onerror="window.__pwn=1">Raj', "Direct", { amount: 5000 });
    recompute();
    openOps("arrivals", 0);
    await until(() => document.querySelector(".sheet .meta"), "the arrivals sheet to render");
    const injected = !!document.querySelector(".sheet img[src='x']");
    const ran = window.__pwn === 1;
    delete window.__pwn;
    eq(injected, false, "an <img> was injected into the DOM");
    eq(ran, false, "the onerror handler ran");
    return "payload renders as text";
  });

  /* Built from the horizon, not from a date typed into the test. The first
     version asked about "10 oct to 25 oct", which was past the end of the book
     the week it was written and comfortably inside it seven days later — so the
     test failed on a working app because the calendar moved. A regression suite
     that goes red as the days pass teaches people to ignore it. Everything
     date-shaped in here is now derived from `today` or from DAYS. */
  await test("Ask flags a range it could only partly answer", () => {
    const near = fmt(DAYS - 4);                       // inside the book
    const p = parseQuery(`anything for 20 nights from ${near}`);
    eq(p.beyond, false, "beyond");
    eq(p.clipped, true, `clipped, for a 20-night stay from ${near} against a ${DAYS}-day book`);
    eq(p.asked, 20, "nights asked for");
    ok(p.n < p.asked, "the answer covers the whole request, so nothing was clipped");
    const q = parseQuery(`anything for 2 nights from ${fmt(2)}`);
    eq(q.clipped, false, "a request that fits must not be flagged");
    return `asked ${p.asked} from ${near}, answered ${p.n}, flagged`;
  });

  await test("a check-out date is never printed a day early", () => {
    const late = resv.filter(r => !isBlock(r) && r.end > DAYS)
      .sort((a, b) => b.end - a.end)[0];
    ok(late, "seed has no stay ending past DAYS");
    ok(fmt(late.end) !== fmt(DAYS - 1),
      "the true check-out and the clamped one format the same — clamp may be back");
    return `${flats[late.fi].id} · ${late.guest} · out ${fmt(late.end)} (end ${late.end})`;
  });

  await test("a room free tonight is not labelled Booked on a longer dial", () => {
    /* The bug needs a flat that is free TONIGHT and taken before the 3-night
       dial runs out, and whether the live book contains one is an accident of
       the day. It did on the demo book; on the operator's real book, on a night
       when 43 of 46 rooms are sold and the three that are left are free for
       weeks, it does not — and the test reported a missing fixture in the same
       red as a regression. So build it: book the third night out on a flat that
       is free tonight, which is the exact shape, and take it back afterwards. */
    let fi = flats.findIndex((f, i) => !occ[i][0] && runFrom(i, 0) >= 1 && runFrom(i, 0) < 3);
    let built = null;
    if(fi < 0){
      const open = flats.findIndex((f, i) => !occ[i][0] && freeSpan(i, 0, 3));
      ok(open >= 0, "no flat is free for the next three nights, so the fixture cannot be built");
      ok(addBooking(open, 2, 1, "Fixture Guest", "Direct", {}), "fixture booking refused");
      built = resv[resv.length - 1];
      fi = open;
      eq(runFrom(fi, 0), 2, "fixture did not produce a 2-night run");
    }
    const done = () => { if(built){ cancelBooking(built); recompute(); save(); } };
    try{
    const note = roomTile(fi, 0, 3).querySelector("s").textContent;
    ok(!/^Booked$/.test(note), `tile says "${note}" for a night it is free`);
    ok(/of 3/.test(note), `tile says "${note}", expected "Free n of 3"`);
    const aria = roomTile(fi, 0, 3).getAttribute("aria-label");
    ok(!/not available/.test(aria), `aria says "${aria}"`);
    return `${flats[fi].id} → "${note}"` + (built ? " (fixture built)" : "");
    } finally { done(); }
  });

  await test("Ask matches a building added after boot", async () => {
    const next = flats.map(f => ({ ...f }));
    next.push({ id: "KP-101", code: "KP", bname: "Kondapur", bshort: "Kondapur",
                type: "2 BHK", floor: 1, rate: 3000 });
    applyInventory(next);
    await until(() => flats.some(f => f.code === "KP"), "the new building to land in flats");
    const bldg = parseQuery("anything in kondapur tonight").bldg;
    eq(bldg, "KP", "building matched for a name added after boot");
    return "live inventory, not the boot seed";
  });

  await test("'this weekend' means this one, on every weekday", () => {
    const src = nextWeekend.toString();
    const forDow = dow => eval("(function(){const DAYS=" + DAYS + ",DOW=" + dow + ";return "
      + src.replace("dateAt(0).getDay()", "DOW").replace(/dateAt\(a\)\.getDay\(\)/, "((DOW+a)%7)")
      + "})()")();
    eq(forDow(6).a, 0, "Saturday must answer about tonight");
    eq(forDow(6).b - forDow(6).a, 2, "Saturday is two nights");
    eq(forDow(0).a, 0, "Sunday must answer about tonight");
    eq(forDow(0).b - forDow(0).a, 1, "Sunday is one night");
    eq(forDow(1).a, 4, "Monday should scan forward to Friday");
    return "Sat→tonight×2, Sun→tonight×1, Mon→Fri";
  });

  /* ══ money reporting ════════════════════════════════════════════════════ */

  /* The book is a set of offsets from the day it was READ, and the app computes
     `today` from the clock. Without a stamp the whole book slid forward one day
     every day — measured the first morning after a real import: a stay the
     sheet records on 29 August rendered as 30 August, the 176-night window
     started a day late, and "3 of 46 free tonight" was yesterday's 3 against
     the sheet's 12. Silent, cumulative, and wrong about every date it holds. */
  await test("the book does not drift when the clock rolls over", () => {
    ok(typeof BOOK_ON === "string" && /^\d{4}-\d{2}-\d{2}$/.test(BOOK_ON),
       "BOOK carries no date to measure its offsets from");
    const on = new Date(BOOK_ON + "T00:00:00"); on.setHours(0, 0, 0, 0);
    const drift = Math.round((on - today) / 86400000);
    /* every row must sit where BOOK_ON said it sits, whatever day it is now */
    /* Every seeded start, per flat, as a SET. Matching a row by (flat, guest,
       nights) is ambiguous — B201 has two Deepa stays of three nights each —
       and an ambiguous matcher reports a drift that is really a lookup picking
       the wrong twin. What must hold is simpler and unambiguous: every stay in
       the book sits on one of the offsets BOOK_ON puts it on.

       Checked against what is PRESENT, not against every seeded row: a settled
       past stay is dropped by keepOnLoad on the next load(), which is correct
       and documented, and an earlier version of this test read that legitimate
       drop as a failure. */
    const want = {};
    for (const [id, start0] of BOOK) {
      const fi = flatIndex[id];
      if (fi === undefined) continue;
      (want[fi] = want[fi] || new Set()).add(start0 + drift);
    }
    let checked = 0;
    for (const r of resv) {
      if (r.manual || isBlock(r)) continue;          // put there by a test, not the seed
      const set = want[r.fi];
      if (!set) continue;
      ok(set.has(r.start),
        `${flats[r.fi].id} · ${r.guest} sits at ${r.start}, which is not an offset BOOK_ON puts it on`);
      checked++;
    }
    ok(checked > 10, `only ${checked} seeded rows present to check`);
    /* and the arithmetic itself, spelled out on one known row */
    const [id0, s0] = BOOK[0];
    const cal = new Date(on); cal.setDate(cal.getDate() + s0);
    eq(dateAt(s0 + drift).toDateString(), cal.toDateString(), "BOOK[0] calendar date");
  });

  await test("the owed rows are a partition of the headline", () => {
    const O = owedStats();
    /* FOUR states, not three. "still in the flat" used to be folded into
       "later", which on the real book put 98.5% of the debt under a heading
       meaning no hurry — see DESIGN.md, "Later is not a state". The partition
       assertion is what makes splitting a bucket safe to do: add a state and
       forget to show it and this goes red instead of the money going quiet. */
    eq(O.gone + O.here + O.soon + O.later, O.total, "rows do not sum to the headline");
    /* and every state the card can show has a row to show it in */
    const shown = O.gone + O.here + O.soon + O.later;
    eq(shown, O.total, "a state carries money the card has no row for");
    ok(O.going <= O.here, "money walking out in two days is not a subset of money in the flat");
    const platformInside = bookings().filter(r => r.amount && dueFrom(r) > 0)
      .reduce((s, r) => s + withPlatform(r), 0);
    eq(platformInside, 0, "platform money is inside the headline, so it must not be shown beside it");
    return `${money(O.total)} = ${money(O.gone)} + ${money(O.here)} + ${money(O.soon)} + ${money(O.later)}`;
  });

  await test("the export's Summary keeps a past arrival in its own month", () => {
    /* any flat: this row sits entirely in the past, so it cannot collide with
       anything in the book. The original searched for a flat free for the first
       eight days and got -1 the week the book filled up, which then wrote
       occ[-1] and failed on a null rather than on the code under test. */
    /* far enough back to be in a PREVIOUS month whatever day of the month it is
       today. -23 was fine when the month was young and landed on the 1st of the
       current month a week later, at which point the test's own guard below
       correctly reported that it was no longer exercising the bug. */
    const back = -(dateAt(0).getDate() + 5);
    resv.push({ fi: 0, start: back, end: 7, nights: 7 - back, guest: "Corporate Co",
                src: "Direct", manual: true, bookedOn: back - 7, amount: 90000, pays: [] });
    recompute();
    const bk = bookings();
    const first = bk.reduce((m, r) => Math.min(m, r.start), 0);
    ok(first < 0, "no booking arrives before today");
    const key = d => { const t = dateAt(d); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0"); };
    ok(key(back) !== key(0), "the past arrival is in the current month anyway — test is not exercising the bug");
    const seeded = [];
    for (let d = Math.min(first, 0); d < DAYS; d++) if (!seeded.includes(key(d))) seeded.push(key(d));
    ok(seeded.includes(key(back)), "no bucket exists for the month the stay arrived in");
    return `${key(back)} bucket exists alongside ${key(0)}`;
  });

  /* The other half of that fix, and the half that broke: seeding a month must
     not also COUNT nights the app has no occupancy data for. occ[]/blk[] start
     at today, so every pre-today index reads undefined — never blocked, never
     sold — and each one landed in the denominator as an empty sellable night. */
  await test("the export's occupancy counts only nights the book holds", () => {
    const sheet = exportRows()[0];
    const head = sheet.rows[0].map(c => c && c.v);
    const iSell = head.findIndex(h => /sellable/i.test(h || ""));
    const iOcc  = head.findIndex(h => /occupan/i.test(h || ""));
    ok(iSell >= 0 && iOcc >= 0, "Summary sheet has no Sellable/Occupancy columns");
    const perMonth = {};
    for (let d = 0; d < DAYS; d++) {
      const dt = dateAt(d), k = MONF[dt.getMonth()] + " " + dt.getFullYear();
      perMonth[k] = perMonth[k] || 0;
      for (let i = 0; i < NF; i++) if (!blk[i][d]) perMonth[k]++;
    }
    const checked = [];
    for (const row of sheet.rows.slice(1)) {
      const label = row[0] && row[0].v, sell = row[iSell] && row[iSell].v;
      if (typeof sell !== "number" || !perMonth[label]) continue;
      eq(sell, perMonth[label], `sellable nights for ${label}`);
      checked.push(`${label} ${sell}`);
    }
    ok(checked.length, "no month rows were checkable");
    /* and a month before today must not claim 0% — it must decline to answer */
    for (const row of sheet.rows.slice(1)) {
      const label = row[0] && row[0].v;
      if (perMonth[label]) continue;                 // a month the book covers
      const occ = row[iOcc] && row[iOcc].v;
      ok(occ === "—" || occ == null,
        `${label} is outside the book but reports occupancy ${JSON.stringify(occ)}`);
    }
    return checked.join(" · ");
  });

  /* ══ touch and gesture ══════════════════════════════════════════════════ */

  await test("an interrupted sheet drag does not pin the sheet", async () => {
    openSheet(0, 0);
    await until(() => document.getElementById("grab") && document.querySelector(".sheet.on"), "the sheet to open");
    const grab = document.getElementById("grab"), sheetEl = document.querySelector(".sheet");
    const t = y => new Touch({ identifier: 1, target: grab, clientX: 180, clientY: y });
    grab.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [t(300)], targetTouches: [t(300)], changedTouches: [t(300)] }));
    grab.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: [t(370)], targetTouches: [t(370)], changedTouches: [t(370)] }));
    grab.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true, touches: [], targetTouches: [], changedTouches: [t(370)] }));
    eq(sheetEl.style.transform, "", "inline transform survives a cancelled drag");
    closeSheet();
    /* wait for the sheet to actually leave, not for a number of milliseconds —
       the close is a CSS transition and its duration is not ours to assume */
    /* Assert the sheet has LEFT, then that the tab bar is reachable. Hit-testing
       alone is hostage to the close transition, and in a backgrounded tab that
       transition runs on a clock this test does not control — which failed a
       working app twice. 12s of budget because a throttled tab polls once a
       second, not every 40ms. */
    /* snap it shut rather than waiting out a transition a hidden tab will not
       run — the assertion is about the inline transform being cleared and the
       tab bar being reachable, not about the animation's duration */
    const prev = sheetEl.style.transition;
    sheetEl.style.transition = "none";
    void sheetEl.offsetHeight;
    sheetEl.style.transition = prev;
    ok(!sheetEl.classList.contains("on"), "closeSheet left the sheet open");
    ok(sheetEl.getBoundingClientRect().top >= window.innerHeight - 1,
       "the sheet is still on screen after closeSheet");
    const b = document.querySelector(".tabbar button").getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    ok(hit && hit.closest(".tabbar"), "the tab bar is still covered once the sheet has gone");
    return "transform cleared, tab bar reachable";
  });

  await test("a cancelled peek does not eat the next tap", async () => {
    document.querySelectorAll(".tabbar button")[0].click();
    await until(() => document.querySelector(".tile"), "the Rooms grid");
    const tile = document.querySelector(".tile");
    tile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50, pointerId: 1 }));
    await until(() => document.querySelector(".peek"), "the peek card to appear");
    tile.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
    ok(!tile._peeked, "the latch was armed by a pointercancel, which no click will ever clear");
    tile.click();
    await until(() => document.querySelector(".sheet.on"), "the first tap to open the sheet");
    return "latch not armed, first tap opens";
  });

  await test("the sweep HUD does not move the calendar under a finger", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".cal"), "the month tab");
    /* The whole book renders in one grid now, so there is always a cell with
       rows above and below it. This used to page forward until it found a month
       with enough days — an assumption that broke a week after it was written. */
    await until(() => document.querySelectorAll(".day[data-d]").length === DAYS, "every day");
    /* And wait for the ENTRANCE ANIMATION to finish before measuring geometry.
       `rise` is translateY(10px) and plays on a screen's first visit only
       (.screen.on:not(.seen)), so the very first run of this test measured the
       calendar mid-flight and reported it moving -10px — the animation's own
       offset, not the HUD's. It passed on retry because .seen had landed by
       then, which is exactly the shape of a flake that looks like a bug.
       Any test that measures pixels has to own this. */
    await until(() => document.querySelector(".screen.on.seen"), "the screen entrance animation to finish");
    const grid = document.querySelector(".cal");
    const cells = [...document.querySelectorAll(".day[data-d]")];
    ok(cells.length > 9, "not enough day cells");
    const cell = cells[9], r = cell.getBoundingClientRect();
    const pt = [r.left + r.width / 2, r.top + r.height / 2];
    /* the cell must be hit-testable before we start — a sheet still fading out,
       or a scroll still settling, makes elementFromPoint return something else
       and the test then fails on a null rather than on the app */
    const dayAt = () => {
      const e = document.elementFromPoint(pt[0], pt[1]);
      const d = e && e.closest(".day[data-d]");
      return d ? d.dataset.d : null;
    };
    await until(() => dayAt() === cell.dataset.d, "the pressed cell to be hit-testable", 12000);
    const pressed = dayAt();
    const top0 = grid.getBoundingClientRect().top;
    const t = () => new Touch({ identifier: 1, target: cell, clientX: pt[0], clientY: pt[1] });
    cell.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [t()], targetTouches: [t()], changedTouches: [t()] }));
    await until(() => document.querySelector(".hud.on"), "the sweep HUD to arm");
    const moved = Math.round(grid.getBoundingClientRect().top - top0);
    const now = dayAt();
    window.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], targetTouches: [], changedTouches: [t()] }));
    eq(moved, 0, "pixels the calendar moved when the HUD armed");
    eq(now, pressed, "the date under the finger changed when the HUD armed");
    return `0px, still on day ${pressed}`;
  });

  await test("a capitalised symptom chip can be deselected", async () => {
    openIssueForm(0);
    await until(() => document.querySelector(".ftile"), "the fault form");
    const elec = [...document.querySelectorAll(".ftile")].find(b => /Electrical/i.test(b.textContent));
    ok(elec, "no Electrical fault tile");
    elec.click();
    await until(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "MCB tripping"), "the symptom chips");
    const chip = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "MCB tripping");
    ok(chip, "no 'MCB tripping' chip");
    const fields = [...document.querySelectorAll(".sheet input, .sheet textarea")];
    chip.click();
    const on = fields.map(f => f.value);
    chip.click();
    const off = fields.map(f => f.value);
    const i = on.findIndex((v, k) => v !== off[k]);
    ok(i >= 0, "tapping the chip twice changed nothing");
    eq(off[i], "", "the note after deselecting");
    return "selects and deselects";
  });

  /* ══ the booking form ═══════════════════════════════════════════════════ */

  await test("a stay may run past the end of the book", () => {
    const fi = flats.findIndex((f, i) => freeSpan(i, DAYS - 4, DAYS + 2));
    ok(fi >= 0, "no flat free at the end of the horizon");
    ok(addBooking(fi, DAYS - 4, 6, "Long Stay", "Direct", { amount: 12000 }),
       "addBooking refused a stay running past DAYS");
    const r = resv[resv.length - 1];
    eq(r.end, DAYS + 2, "stored end");
    eq(r.nights, 6, "stored nights");
    return `${flats[fi].id} · end ${r.end} vs DAYS ${DAYS}`;
  });

  /* ══ regressions the diff review caught ════════════════════════════════ */

  /* The horizon change migrated freeRange→freeSpan at the write guards and the
     booking form, but not at the room sheet or the room tile — so three
     surfaces one tap apart gave three different answers about the same flat,
     the same date and the same length. Assert they agree, because "each is
     individually defensible" is exactly how they drifted apart. */
  await test("sheet, form and tile agree about a stay at the edge of the book", async () => {
    const fi = flats.findIndex((f, i) => freeSpan(i, DAYS - 2, DAYS + 1) && !occ[i][DAYS - 2]);
    ok(fi >= 0, "no flat is free across the end of the horizon");
    document.querySelectorAll(".tabbar button")[0].click();
    await until(() => document.querySelector(".seg button"), "the stay dial");
    const three = [...document.querySelectorAll(".seg button")].find(b => /3 night/i.test(b.textContent));
    ok(three, "no 3-night option on the stay dial");
    three.click();
    await until(() => document.querySelector(".tile"), "the grid to repaint");

    /* The tile used to say "Free 63+n" here and this asserted that "n+" suffix.
       The suffix is gone: 63 was DAYS leaking onto the screen, and a run that
       reaches the end of the book is now said as "Open" (and "no bookings" on
       the wider Month row). What the test is actually guarding is that the tile
       does NOT deny a stay the form and the sheet both accept, so assert that —
       it survives the next rewording, which the literal did not. */
    const note = roomTile(fi, DAYS - 2, 3).querySelector("s").textContent;
    ok(!/^Booked$/.test(note) && !/of 3/.test(note),
       `tile says "${note}" — it is refusing a stay the form and sheet accept`);
    eq(note, freeWords(fi, DAYS - 2, true), "the tile and freeWords disagree");
    ok(roomTile(fi, DAYS - 2, 3).classList.contains("free"), "tile is painted as unavailable");

    openSheet(fi, DAYS - 2);
    await until(() => document.querySelector(".roomAct"), "the room sheet");
    const refusal = document.querySelector(".roomAct .actWhy");
    ok(!refusal, `the sheet refuses it: "${refusal && refusal.textContent.trim()}"`);
    const big = document.querySelector(".roomAct .bigAct s");
    eq(big && big.textContent.trim(), "3 nights", "the sheet's offer");
    closeSheet();

    openBooking(fi, DAYS - 2, 3);
    await until(() => document.querySelector(".bkgo"), "the booking form");
    eq(document.querySelector(".bkgo").textContent.trim(), "Book 3 nights", "the form's button");
    closeSheet();
    return `${flats[fi].id} · all three offer 3 nights`;
  });

  /* Fixing nextWeekend without fixing its callers fixed nothing: both callers
     hardcoded defaultNights:2 and never read the span the function returned. */
  await test("'this weekend' asks for the span nextWeekend actually returns", () => {
    const src = nextWeekend.toString();
    const forDow = dow => eval("(function(){const DAYS=" + DAYS + ",DOW=" + dow + ";return "
      + src.replace("dateAt(0).getDay()", "DOW").replace(/dateAt\(a\)\.getDay\(\)/, "((DOW+a)%7)")
      + "})()")();
    eq(forDow(0).b - forDow(0).a, 1, "a Sunday weekend is one night");
    /* and the caller must read it rather than assume 2 */
    const rd = (typeof readDate === "function" ? readDate.toString() : "");
    ok(/defaultNights:\s*w\.b - w\.a|defaultNights:\s*\(w\.b - w\.a\)|w\.b - w\.a/.test(rd)
       || /w\.b/.test(rd),
       "readDate still hardcodes a weekend length instead of reading nextWeekend's span");
    return "Sunday → 1 night, and the caller reads it";
  });

  /* armConfirm consolidated four hand-written confirms and, in doing so, wrote
     the VISIBLE label into aria-label on disarm — replacing "Cancel X's booking
     in Y" with a bare "✕" for the rest of that render. */
  await test("a lapsed confirm keeps its accessible name", async () => {
    openSheet(0, 0);
    await until(() => [...document.querySelectorAll(".rowx")].some(e => e.textContent.trim() === "✕"),
      "the room sheet");
    const x = [...document.querySelectorAll(".rowx")].find(e => e.textContent.trim() === "✕");
    const resting = x.getAttribute("aria-label");
    ok(resting && resting.length > 3, "the button had no descriptive name to begin with");
    x.click();
    eq(x.getAttribute("aria-label"), "Cancel?", "the armed name");
    await until(() => !x.classList.contains("arm"), "the arm to lapse", 6000);
    eq(x.getAttribute("aria-label"), resting, "the name after the arm lapsed");
    return `"${resting}" survives`;
  });

  /* Reduced transparency removes translucency, not meaning. The !important that
     made the block apply also flattened every opaque STATE fill under it,
     recreating the invisible-armed-confirm bug for the one user who explicitly
     asked the OS for a more legible screen. */
  await test("reduced transparency does not erase the armed destructive state", async () => {
    const m = await import("./audit.js?t=" + Date.now());
    await m.setThemeAndSettle("light");
    const force = document.createElement("style");
    force.textContent = [...document.styleSheets]
      .flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } })
      .filter(r => r.conditionText && /reduced-transparency/.test(r.conditionText))
      .map(r => [...r.cssRules].map(x => x.cssText).join("\n")).join("\n");
    ok(force.textContent.length, "no prefers-reduced-transparency block found to test");
    document.head.appendChild(force);
    try {
      openSheet(0, 0);
      await until(() => [...document.querySelectorAll(".rowx")].some(e => e.textContent.trim() === "✕"),
        "the room sheet");
      const x = [...document.querySelectorAll(".rowx")].find(e => e.textContent.trim() === "✕");
      x.click();
      const armed = freeze(() => ({ bg: getComputedStyle(x).backgroundColor, ink: getComputedStyle(x).color }));
      const bg = m.over(m.parse(armed.bg), m.groundUnder(x.parentElement));
      const ratio = m.ratio(m.over(m.parse(armed.ink), bg), bg);
      ok(ratio >= 4.5, `armed label is ${ratio.toFixed(2)}:1 under reduced transparency`);
      return `armed fill kept, label ${ratio.toFixed(2)}:1`;
    } finally { force.remove(); }
  });

  /* ══ the date-range picker ═════════════════════════════════════════════ */

  await test("a range reads as one band, capped at its ends and at each week", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".cal .day[data-d]"), "the month grid");
    monthOffset = 0; pendingStart = null;
    /* a span long enough to cross a Sunday, so both kinds of cap are exercised */
    sel = { a: 1, n: 9 };
    renderMonth();
    await until(() => document.querySelector(".day.rngA"), "the band to paint");
    const band = [...document.querySelectorAll(".day.rng,.day.rngA,.day.rngB")];
    ok(band.length >= 3, `only ${band.length} cells in the band`);
    for (const c of band) {
      const col = (dateAt(+c.dataset.d).getDay() + 6) % 7;
      const isEnd = c.classList.contains("rngA") || c.classList.contains("rngB");
      if (col === 0) ok(c.classList.contains("capL"), `day ${c.dataset.d} starts a week but is not capped left`);
      if (col === 6) ok(c.classList.contains("capR"), `day ${c.dataset.d} ends a week but is not capped right`);
      /* A cell mid-week and mid-range must bleed both ways, or the band shows a
         seam at every cell and the point of it is lost. Cells that carry a cap
         are excluded: besides the two ends of the range and the two ends of a
         week, a month's first and last day are capped too, because each month
         block starts a fresh row under its own label. */
      const capped = c.classList.contains("capL") || c.classList.contains("capR");
      if (col > 0 && col < 6 && !isEnd && !capped) {
        const b = getComputedStyle(c, "::before");
        eq(b.left, "-3.5px", `day ${c.dataset.d} does not bleed left`);
        eq(b.right, "-3.5px", `day ${c.dataset.d} does not bleed right`);
      }
    }
    const first = document.querySelector(".day.rngA");
    ok(first.classList.contains("capL"), "the arrival is not capped");
    return `${band.length} cells, caps at the ends and every week edge`;
  });

  /* The band is painted behind the content. The first attempt raised the
     content instead, which un-pinned .gg — an absolutely positioned bar — into
     the flex flow, so every free-room count in the range wore its own progress
     bar as a strikethrough. It looked like a font problem in a screenshot. */
  await test("the band does not disturb the cell's own layout", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".cal .day[data-d]"), "the month grid");
    monthOffset = 0; pendingStart = null; sel = { a: 1, n: 5 };
    renderMonth();
    await until(() => document.querySelector(".day.rng"), "the band");
    const plain = document.querySelector(".day[data-d]:not(.rng):not(.rngA):not(.rngB)");
    const offOf = c => {
      const g = c.querySelector(".gg");
      return { pos: getComputedStyle(g).position,
               up: Math.round(c.getBoundingClientRect().bottom - g.getBoundingClientRect().bottom) };
    };
    const ref = plain ? offOf(plain) : null;
    for (const c of document.querySelectorAll(".day.rng,.day.rngA,.day.rngB")) {
      const g = offOf(c);
      eq(g.pos, "absolute", `day ${c.dataset.d}: the meter is no longer pinned`);
      if (ref) eq(g.up, ref.up, `day ${c.dataset.d}: the meter sits at a different height than an unselected cell`);
    }
    return "meter stays pinned in every band cell";
  });

  await test("the picker head states the range and says which end the next tap sets", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".pick"), "the picker head");
    monthOffset = 0; pendingStart = null; sel = { a: 2, n: 4 };
    renderMonth();
    await until(() => document.querySelector(".picks .pn"), "the nights badge");
    const [fIn, fOut] = [...document.querySelectorAll(".pick .pf")];
    eq(fIn.querySelector("b").textContent, fmtL(2), "check-in");
    eq(fOut.querySelector("b").textContent, fmtL(6), "check-out");
    eq(document.querySelector(".picks .pn b").textContent, "4 nights", "the nights readout");
    ok(fIn.classList.contains("on"), "no end is armed, so check-in should carry the underline");
    ok(!fOut.classList.contains("on"), "check-out is underlined when nothing is pending");
    /* arming the departure moves the underline and blanks the date it will set */
    fOut.click();
    await until(() => document.querySelectorAll(".pick .pf")[1].classList.contains("on"),
      "the underline to move to check-out");
    const out2 = document.querySelectorAll(".pick .pf")[1];
    eq(out2.querySelector("b").textContent, "Pick a date", "check-out while armed");
    ok(pendingStart !== null, "tapping check-out did not arm a departure");
    return `${fmtL(2)} → ${fmtL(6)}, underline follows the armed end`;
  });

  await test("a preset sets the span in one tap", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".picks button"), "the preset chips");
    monthOffset = 0; pendingStart = null; sel = { a: 0, n: 1 };
    renderMonth();
    await until(() => document.querySelector(".picks button"), "the chips to repaint");
    const week = [...document.querySelectorAll(".picks button")].find(b => b.textContent === "1 week");
    ok(week, "no '1 week' preset");
    week.click();
    await until(() => sel.n === 7, "the range to become a week");
    eq(sel.n, 7, "nights after tapping '1 week'");
    eq(pendingStart, null, "a preset must not leave a half-made selection");
    const on = [...document.querySelectorAll(".picks button")].find(b => b.classList.contains("on"));
    eq(on && on.textContent, "1 week", "the active preset is not marked");
    /* Clear returns to a single night without moving the arrival */
    const a0 = sel.a;
    document.querySelector(".picks .pclear").click();
    await until(() => sel.n === 1, "clear to reduce the span");
    eq(sel.a, a0, "clear moved the arrival");
    return "1 week → 7 nights, Clear → 1 night, arrival held";
  });

  /* The most ordinary request in this business — "the 28th to the 3rd" — used
     to be impossible: the calendar was paged a month at a time and both arrows
     reset the selection, so an arrival tapped on the 31st was gone the moment
     you went looking for the departure. The months run on now, so this is two
     taps in one grid and there is no navigation to survive. */
  await test("a stay can cross a month boundary in one grid", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".cal .day[data-d]"), "the calendar");
    pendingStart = null; sel = { a: 0, n: 1 };
    renderMonth();
    await until(() => document.querySelector(".cal .day[data-d]"), "the grid to repaint");

    /* every day of the book is rendered, so a boundary is just two adjacent
       cells — find one and pick across it */
    /* Counted from the cells themselves, not from a divider element. The grid
       used to restart at each month and mark the break with a full-width
       .mlab; it now runs on unbroken and marks the seam on the 1st itself, so
       an assertion about .mlab was asserting the old implementation rather than
       the behaviour. How many months are on screen is a fact about the days. */
    const monthsOn = new Set([...document.querySelectorAll(".day[data-d]")]
      .map(c => dateAt(+c.dataset.d).getMonth()));
    ok(monthsOn.size >= 2, `only ${monthsOn.size} month is rendered`);
    ok(document.querySelectorAll(".day.mstart").length >= 1, "no month start is marked");
    eq(document.querySelectorAll(".day[data-d]").length, DAYS, "not every day is rendered");
    let cross = -1;
    for (let d = 1; d < DAYS - 3; d++)
      if (dateAt(d).getMonth() !== dateAt(d + 1).getMonth()) { cross = d; break; }
    ok(cross > 0, "no month boundary inside the horizon");

    const cellFor = d => document.querySelector(`.day[data-d="${d}"]`);
    cellFor(cross - 1).click();
    await until(() => pendingStart === cross - 1, "the arrival to arm");
    cellFor(cross + 2).click();
    await until(() => pendingStart === null, "the range to complete");
    eq(sel.a, cross - 1, "arrival");
    eq(sel.n, 3, "nights across the boundary");

    /* and both ends are on screen at once, which is the point */
    ok(cellFor(sel.a).classList.contains("rngA"), "no opening endpoint");
    ok(cellFor(sel.a + sel.n).classList.contains("rngB"), "no closing endpoint");
    const inOut = [...document.querySelectorAll(".pick .pf b")].map(b => b.textContent);
    eq(inOut[0], fmtL(sel.a), "check-in");
    eq(inOut[1], fmtL(sel.a + sel.n), "check-out");
    return `${inOut[0]} → ${inOut[1]}, both endpoints in one grid`;
  });

  /* Half the requests arrive as a LENGTH, not two dates. The stepper moves the
     departure and leaves the arrival where the caller put it — and it never
     needs the next month on screen, which is the other half of why paging had
     to go. */
  await test("the nights stepper moves the departure and holds the arrival", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".picks .pn"), "the nights control");
    pendingStart = null; sel = { a: 3, n: 2 };
    renderMonth();
    await until(() => document.querySelector(".picks .pn button"), "the stepper");
    const plus = () => [...document.querySelectorAll(".picks .pn button")][1];
    const minus = () => [...document.querySelectorAll(".picks .pn button")][0];
    /* a 44px target on a control a thumb uses mid-call — the arrows it replaced
       were 36px, under the minimum */
    const t = getComputedStyle(plus(), "::after");
    eq(t.width, "44px", "plus target width");
    eq(t.height, "44px", "plus target height");
    plus().click();
    await until(() => sel.n === 3, "nights to go up");
    eq(sel.a, 3, "the arrival moved when nights changed");
    minus().click(); 
    await until(() => sel.n === 2, "nights to come down");
    eq(sel.a, 3, "the arrival moved on the way down");
    /* and it cannot go below one night */
    minus().click();
    await until(() => sel.n === 1, "nights to reach one");
    ok(minus().disabled, "the minus is still live at one night");
    return "nights move, arrival holds, floor at 1";
  });

  /* ══ the frame ═════════════════════════════════════════════════════════ */

  /* The tab was 1705px at 8 free flats and 3730px — four and a half screens —
     on the emptiest night in the book, with the answer starting at y=1065 every
     time. It is a fixed frame now: two bounded troughs move, nothing else, and
     the answer's size cannot change the layout above it. */
  await test("the Month tab does not scroll, at any number of free flats", async () => {
    const scr = document.getElementById("scr-month");
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".calscroll .day[data-d]"), "the calendar trough");
    const check = where => {
      const slack = scr.scrollHeight - scr.clientHeight;
      ok(slack <= 1, `${where}: the page scrolls by ${slack}px`);
    };
    pendingStart = null; sel = { a: 5, n: 4 }; renderMonth();
    await until(() => document.querySelector(".listtrough .row"), "the answer");
    check("a typical selection");
    const rows1 = scr.querySelectorAll(".row").length;

    /* the emptiest night in the book — the worst case for the list */
    let best = { d: 0, f: -1 };
    for (let d = 0; d < DAYS; d++) { const f = freeCount(d); if (f > best.f) best = { d, f }; }
    pendingStart = null; sel = { a: best.d, n: 1 }; renderMonth();
    await until(() => scr.querySelectorAll(".row").length > rows1, "the long answer");
    check(`${best.f} free`);
    const trough = scr.querySelector(".listtrough");
    ok(trough.scrollHeight > trough.clientHeight + 100,
       "the long answer is not actually overflowing its trough — test proves nothing");
    return `${best.f} free · ${Math.round(trough.scrollHeight)}px of list inside a `
         + `${Math.round(trough.clientHeight)}px trough, frame unmoved`;
  });

  /* Pull-to-refresh decided it was "at the top" by reading the SCREEN's
     scrollTop. A screen that cannot scroll reports 0 forever, so a downward
     drag inside a trough already scrolled 200px armed the pull, took the screen
     32.7px down and reloaded the app mid-call — with the trough unable to
     scroll back. It asks the trough under the finger now. */
  await test("a downward drag inside a scrolled trough does not arm pull-to-refresh", async () => {
    const scr = document.getElementById("scr-month");
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".calscroll .day[data-d]"), "the calendar");
    const trough = document.querySelector(".calscroll");
    trough.scrollTop = 120;
    await until(() => trough.scrollTop > 100, "the trough to scroll");
    /* Dispatch ON THE CELL and let it bubble, the way a real touch arrives. The
       first version fired at .screens, which made e.target the host itself —
       so the gate's closest(".calscroll") found nothing, fell back to the
       screen, and the test failed a fix that works. A synthetic event that does
       not carry a realistic target tests the dispatch, not the code. */
    const target = document.querySelector(".calscroll .day[data-d]");
    const t = y => new Touch({ identifier: 1, target, clientX: 180, clientY: y });
    target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true,
      touches: [t(300)], targetTouches: [t(300)], changedTouches: [t(300)] }));
    target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true,
      touches: [t(360)], targetTouches: [t(360)], changedTouches: [t(360)] }));
    const armed = scr.classList.contains("pulling");
    const moved = scr.style.transform;
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true,
      touches: [], targetTouches: [], changedTouches: [t(360)] }));
    trough.scrollTop = 0;
    eq(armed, false, "the pull armed inside a scrolled trough");
    eq(moved, "", "the screen was dragged down inside a scrolled trough");
    return "gate reads the trough, not the screen";
  });

  /* And it must still work where it should — at the top of the trough. */
  await test("pull-to-refresh still arms at the top", async () => {
    const scr = document.getElementById("scr-month");
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".calscroll .day[data-d]"), "the calendar");
    const trough = document.querySelector(".calscroll");
    trough.scrollTop = 0;
    const target = document.querySelector(".calscroll .day[data-d]");
    const t = y => new Touch({ identifier: 1, target, clientX: 180, clientY: y });
    target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true,
      touches: [t(300)], targetTouches: [t(300)], changedTouches: [t(300)] }));
    target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true,
      touches: [t(360)], targetTouches: [t(360)], changedTouches: [t(360)] }));
    const armed = scr.classList.contains("pulling");
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true,
      touches: [], targetTouches: [], changedTouches: [t(360)] }));
    await until(() => !scr.classList.contains("pulling"), "the pull to release", 6000);
    scr.style.transform = "";
    ok(armed, "pull-to-refresh no longer arms at the top of the trough");
    return "still arms where it should";
  });

  /* ══ figures that outran their samples ══════════════════════════════════ */

  /* The repeat card matched on phone alone. The imported book carries no phone
     column at all, so it refused forever on the only book that exists, while
     the same book held 162 names recurring across 595 rows. A refusal you can
     never leave is a dead card, not a refusal. */
  await test("the repeat card matches on what the book actually carries", async () => {
    const backup = resv.slice();
    try {
      const mk = (fi, start, guest, extra) => Object.assign(
        {fi, start, end: start + 2, nights: 2, guest, src: "Direct", kind: "stay"}, extra || {});
      resv = [mk(0, 1, "Ravi"), mk(1, 4, "Ravi"), mk(2, 7, "Meena"),
              mk(3, 10, "Sunil"), mk(0, 14, "Meena")];
      const byName = guestStats();
      eq(byName.idBy, "name", "identity used when no row carries a number");
      eq(byName.repeat, 2, "names seen more than once");
      eq(byName.bookings, 5, "bookings it could match on");
      /* One number is not enough to switch on — the floor is eight, and below
         it the numbers that exist are too few to beat the names. */
      resv = resv.map((r, i) => i === 0 ? Object.assign({}, r, {phone: "9000000001"}) : r);
      eq(guestStats().idBy, "name", "identity with a single number in the book");
      resv = backup.slice();
      /* Enough numbers, and it switches back to the identity that is proof. */
      resv = Array.from({length: 9}, (_, i) =>
        mk(i % NF, i, "G" + i, {phone: "90000000" + String(10 + i)}));
      eq(guestStats().idBy, "phone", "identity once nine rows carry a number");
      return "name → phone, with a floor of 8 between them";
    } finally { resv = backup; recompute(); }
  });

  /* "Yours also spend 57% more than first-timers" was one priced repeat booking
     (Rs 90,875 across 95 nights) against four priced first-timers of 1 to 59
     nights: it compared booking TOTALS, so it measured stay length. */
  await test("the repeat-spend comparison needs a sample on both sides", async () => {
    const backup = resv.slice();
    try {
      const mk = (fi, start, nights, guest, amount) =>
        ({fi, start, end: start + nights, nights, guest, src: "Direct", kind: "stay", amount});
      /* The shipped shape: one priced repeat, four priced first-timers. */
      resv = [mk(0, 1, 95, "Lakshmi", 90875), mk(1, 2, 1, "Lakshmi", 0),
              mk(2, 3, 23, "Syed", 40700), mk(3, 4, 1, "Komali", 5000),
              mk(0, 5, 59, "Rakesh", 154875), mk(1, 6, 6, "Hima", 31500)];
      const thin = guestStats();
      eq(thin.pricedRepeat, 1, "priced returning bookings");
      eq(thin.pricedOnce, 4, "priced first-time bookings");
      eq(thin.cmp, false, "the comparison was drawn from 1 against 4");
      /* Five a side, and it may speak — per NIGHT, so a tenancy cannot beat a
         weekend by being longer. Repeat rows: 2000/night. Once: 1000/night. */
      const rep = [], once = [];
      for (let i = 0; i < 5; i++) {
        rep.push(mk(i % NF, i, 2, "R" + i, 4000), mk(i % NF, 20 + i, 2, "R" + i, 4000));
        once.push(mk(i % NF, 40 + i, 4, "O" + i, 4000));
      }
      resv = rep.concat(once);
      const fat = guestStats();
      eq(fat.cmp, true, "the comparison with five priced rows a side");
      eq(Math.round(fat.avgRepeat), 2000, "returning, per night");
      eq(Math.round(fat.avgOnce), 1000, "first-time, per night");
      return "refuses at 1v4, speaks at 5v5, and compares per night";
    } finally { resv = backup; recompute(); }
  });

  /* Billed sat beside the month's full arrival count on the sheet that goes to
     the accountant, and three of thirty-nine arrivals carried an amount. */
  await test("the export's money columns carry their own denominator", async () => {
    const sum = exportRows().find(s => s.name === "Summary");
    const head = sum.rows[0].map(c => c.v);
    const at = head.indexOf("Arrivals with an amount");
    ok(at > 0, `the Summary has no priced-coverage column — ${head.join(", ")}`);
    ok(at === head.indexOf("Billed") + 1, "the coverage column is not beside the money it qualifies");
    const body = sum.rows.slice(1);
    ok(body.length, "the Summary has no month rows to check");
    body.forEach(r => {
      const arrivals = r[head.indexOf("Arrivals")].v, cell = r[at].v;
      const m = /^(\d+) of (\d+)$/.exec(cell);
      ok(m || cell === "—", `coverage cell reads "${cell}"`);
      if (m) {
        eq(+m[2], arrivals, `denominator against the arrival count on the same row`);
        ok(+m[1] <= +m[2], `${cell} claims more priced arrivals than arrivals`);
      }
    });
    return `${body.length} months, each naming the arrivals behind its money`;
  });

  /* Nothing in the app reads a price, a conversion or an elasticity, so the
     discount depths are constants. They rendered in the pill slot beside real
     money and real night counts, where a reader cannot tell the two apart. */
  await test("a suggested discount does not render as a measured one", async () => {
    const board = todayBoard();
    const pills = board.days.flatMap(d => {
      const seen = [];
      const open = openFlatList;
      try {
        window.openFlatList = (t, s, rows) => rows.forEach(r => seen.push(r.pill));
        d.open();
      } finally { window.openFlatList = open; }
      return seen;
    }).concat(board.extras.map(e => e.pill));
    const depths = pills.filter(p => /%/.test(String(p)));
    ok(depths.length, "no discount pills on the board to check");
    depths.forEach(p => ok(/^try /.test(p), `discount pill reads "${p}", which is a claim, not a suggestion`));
    return `${depths.length} discount pills, all offered rather than asserted`;
  });

  /* ══ the shape of the portfolio ═════════════════════════════════════════ */

  /* The sheet keeps a column per bedroom. Read as flats, Lotus Pond's floors
     became three units that were always booked together — eight phantom flats,
     a tripled denominator, and a month reporting 387 nights sold out of a
     capacity of 248. */
  await test("Lotus Pond's floors are one apartment, not three rooms", async () => {
    const lp = flats.filter(f => f.bname === "Lotus Pond");
    eq(lp.length, 8, "units at Lotus Pond");
    eq(lp.filter(f => f.type === "3 BHK").length, 4, "3 BHKs at Lotus Pond");
    eq(lp.filter(f => f.type === "Studio").length, 4, "studios at Lotus Pond");
    ok(!flats.some(f => /^LP-[1-4]0[123]$/.test(f.id)),
      `a bedroom is still listed as a flat: ${flats.filter(f=>/^LP-[1-4]0[123]$/.test(f.id)).map(f=>f.id).join(", ")}`);
    /* The merge is only sound if it never stacked two lets onto one unit. */
    lp.forEach(f => {
      const fi = flats.indexOf(f);
      const rs = resv.filter(r => r.fi === fi && !isBlock(r)).sort((a,b)=> a.start - b.start);
      for(let i = 1; i < rs.length; i++)
        ok(rs[i-1].end <= rs[i].start,
          `${f.id}: ${rs[i-1].guest} (${rs[i-1].start}–${rs[i-1].end}) overlaps ${rs[i].guest} (${rs[i].start}–${rs[i].end})`);
    });
    /* And TreeTops must NOT have been merged — its rooms are numbered the same
       way and the first pass at this quietly folded them together too. */
    eq(flats.filter(f => f.bname === "TreeTops").length, 10, "flats at TreeTops");
    return `${lp.length} units — 4 apartments, 4 studios — and no unit double-let`;
  });

  /* Thirty-eight tiles in one field is ten rows with no landmarks. */
  await test("the room grid is cut by building and the counts reconcile", async () => {
    await settle();
    document.querySelectorAll(".tabbar button")[0].click();          // Rooms
    await until(() => document.querySelectorAll(".roomfilt button").length, "the building filter");
    const chips = [...document.querySelectorAll(".roomfilt button")];
    const num = b => +(b.textContent.match(/(\d+)\s*$/) || [0,0])[1];
    const all = num(chips[0]);
    eq(chips.slice(1).reduce((a,b)=> a + num(b), 0), all,
      "the building chips do not add up to the All count");
    const secs = [...document.querySelectorAll(".bsec")];
    eq(secs.length, buildingsOf().length, "sections against buildings");
    eq(secs.reduce((a,s)=> a + s.querySelectorAll(".tiles > *").length, 0), NF,
      "tiles across the sections against the portfolio");
    /* Filtering to one building shows that building and drops the header that
       would only repeat the selected chip. */
    const pick = chips[chips.length - 1];
    const want = num(pick);
    pick.click();
    await until(() => document.querySelectorAll(".bsec").length === 1, "the filtered grid");
    eq(document.querySelectorAll(".bsec-h").length, 0, "headers while one building is picked");
    const shown = document.querySelectorAll(".bsec .tiles > *").length;
    const b = buildingsOf()[buildingsOf().length - 1];
    eq(shown, flats.filter(f => f.code === b.code).length, `tiles shown for ${b.name}`);
    chips[0].click();
    await until(() => document.querySelectorAll(".bsec").length > 1, "the unfiltered grid");
    return `${all} free across ${secs.length} buildings, and the filter shows ${want} free of ${shown}`;
  });

  /* ══ the app's own book as the source ═══════════════════════════════════ */

  /* The workbook's newest sheet is Jul 2026 and there is no Aug26, so the
     Profit tab stopped at July while the operator's own August sat in the app
     unread. It now reads those months itself — but cost is complete the day a
     month starts and revenue arrives one typed amount at a time, so subtracting
     them at 19% priced printed a -Rs 9,82,170 "loss" that was entirely a gap in
     data entry. */
  await test("a month the workbook has not closed is read from the app's own book", async () => {
    const key = appMonths()[0];
    ok(key, "no app-sourced month — the book should reach past the workbook's last sheet");
    ok(FIN.every(r => r[0] !== key), `${key} is in the workbook, so it is not app-sourced`);
    const F = finRows(key);
    eq(F.source, "app", "source of the month");
    ok(F.totals, `${key} has no totals`);
    /* Nights are a census and must be exact; money is a sample and must not be
       stated until it covers the nights. */
    ok(F.totals.nights > 0, "nights sold");
    eq(F.totals.canState, F.totals.cover >= 0.8, "the gate against its own coverage");
    ok(!F.totals.canState, `${key} is ${Math.round(F.totals.cover*100)}% priced — expected the shipped book to be thin`);
    /* The refusal must be a state the operator can LEAVE, or it is a dead card
       wearing an apology. Price the month and the figure appears. */
    const d0 = Math.round((new Date(+key.slice(0,4), +key.slice(5,7)-1, 1) - dateAt(0)) / 86400000);
    const d1 = Math.round((new Date(+key.slice(0,4), +key.slice(5,7),   0) - dateAt(0)) / 86400000) + 1;
    const touched = [];
    bookings().forEach(r=>{
      if(Math.min(r.end,d1) <= Math.max(r.start,d0)) return;
      if(!r.amount && r.nights){ touched.push(r); r.amount = 5000 * r.nights; }
    });
    try {
      const full = finRows(key);
      eq(Math.round(full.totals.cover*100), 100, "coverage once every stay is priced");
      ok(full.totals.canState, "the gate did not open at full coverage");
      ok(full.totals.net > 0, `priced at Rs 5,000 a night the month nets ${full.totals.net}, expected a profit`);
    } finally {
      touched.forEach(r => { delete r.amount; });
    }
    const back = finRows(key);
    eq(back.totals.canState, false, "the gate after the fixture was removed");
    return `${key}: ${F.totals.nights} nights sold, ${Math.round(F.totals.cover*100)}% priced — refuses, and opens when priced`;
  });

  /* An amount typed onto a booking has to reach the Profit tab, and finRows is
     memoised on a stamp that only knew about flats, costs and revenue overrides. */
  await test("typing an amount onto a booking moves the month that reads it", async () => {
    const key = appMonths()[0];
    ok(key, "no app-sourced month to test with");
    const d0 = Math.round((new Date(+key.slice(0,4), +key.slice(5,7)-1, 1) - dateAt(0)) / 86400000);
    const d1 = Math.round((new Date(+key.slice(0,4), +key.slice(5,7),   0) - dateAt(0)) / 86400000) + 1;
    const before = finRows(key).totals.revenue;
    const r = bookings().find(x => !x.amount && x.nights
      && Math.min(x.end,d1) > Math.max(x.start,d0));
    ok(r, "no unpriced booking in that month to type onto");
    r.amount = 50000;
    try {
      const after = finRows(key).totals.revenue;
      ok(after > before, `revenue stayed at ${before} — the cache did not notice the booking`);
    } finally { delete r.amount; }
    eq(finRows(key).totals.revenue, before, "revenue after the fixture was removed");
    return `${money(before)} moved when an amount was typed, and moved back`;
  });

  /* ══ the dated ledger ═══════════════════════════════════════════════════ */

  /* Every cost in this app was a STANDING figure — the same every month, which
     is what their Costing sheet is. A plumber paid once had nowhere to go but
     the standing Maintenance line, which would then charge that amount every
     month forever. */
  await test("a logged expense lands in its own month and replaces the standing line", async () => {
    const keep = expenses.slice();
    try {
      expenses.length = 0; expSave();
      const K = FIN[FIN.length-1][0], PREV = FIN[FIN.length-2][0];
      const std = costFor("TT")["Maintenance"];
      ok(std > 0, "TreeTops has no standing Maintenance line to test against");
      const before = finRows(K).rows.find(r => r.code === "TT").cost;
      const prevBefore = finRows(PREV).rows.find(r => r.code === "TT").cost;
      expenses.push({id:"test-led-1", code:"TT", line:"Maintenance", amount: std + 27000,
                     on: K + "-12", note:"fixture"});
      expSave();
      const after = finRows(K).rows.find(r => r.code === "TT").cost;
      /* REPLACES, never adds — adding would charge the standing estimate and
         the real invoice for the same work. */
      eq(after - before, 27000, "the month's cost moved by more than the difference — double counted");
      eq(costMonth("TT", K).basis["Maintenance"], "actual", "basis of a logged line");
      eq(finRows(PREV).rows.find(r => r.code === "TT").cost, prevBefore,
        "an expense dated in one month changed another month");
      /* and a line nobody logged is still the standing figure */
      eq(costMonth("TT", K).basis["Rent"], "standing", "basis of a line with no entry");
      expenses.length = 0; expSave();
      eq(finRows(K).rows.find(r => r.code === "TT").cost, before, "cost after the entry was removed");
      return `${money(std)} standing became ${money(std + 27000)} logged, in ${K} alone`;
    } finally { expenses.length = 0; expenses.push(...keep); expSave(); }
  });

  /* The operator asked whether a repair logged against a flat feeds the
     accounts. It did not: upkeepStats summed the invoices and the Profit tab
     charged a standing Maintenance budget that never saw them. */
  await test("a repair closed against a flat reaches the month's costs by itself", async () => {
    const keepE = expenses.slice(), keepI = issues.slice();
    try {
      expenses.length = 0; expSave();
      const fi = flats.findIndex(f => f.code === "MP");
      ok(fi >= 0, "no Madhapur flat to hang a repair on");
      const K = dayISO(0).slice(0, 7);
      const std = costFor("MP")["Maintenance"];
      const before = finRows(K).rows.find(r => r.code === "MP").cost;
      issues.push({id:"test-iss-1", fi, fault:"Geyser", fixed:0, cost: std + 4500});
      finBust();
      const after = finRows(K).rows.find(r => r.code === "MP").cost;
      eq(after - before, 4500, "the repair invoice did not reach the month's costs");
      const led = ledgerFor(K).filter(r => r.kind === "repair");
      eq(led.length, 1, "repair rows in the ledger");
      eq(led[0].line, "Maintenance", "which line a repair is charged to");
      ok(/Geyser/.test(led[0].note), `the ledger row does not name the fault: ${led[0].note}`);
      /* The LOST NIGHTS must never enter the cost column — they are revenue
         that never arrived, not cash that left, and charging both bills the
         operator twice for one empty room. */
      const lost = upkeepStats().lost;
      ok(lost >= 0, "upkeep lost nights");
      eq(after - before, 4500, "lost nights leaked into the cost column");
      issues.length = 0; issues.push(...keepI); finBust();
      eq(finRows(K).rows.find(r => r.code === "MP").cost, before, "cost after the repair was removed");
      return `a ${money(std + 4500)} repair moved Madhapur by ${money(4500)}, and its nights did not`;
    } finally {
      expenses.length = 0; expenses.push(...keepE); expSave();
      issues.length = 0; issues.push(...keepI); finBust();
    }
  });

  /* An expense is a dated fact. Bookings are stored as offsets and shifted on
     load — "three days out" stays three days out — but an invoice paid on the
     12th is still the 12th tomorrow. */
  await test("an expense does not drift when the clock rolls over", async () => {
    const keep = expenses.slice();
    const realNow = Date.now;
    try {
      expenses.length = 0;
      expenses.push({id:"test-drift", code:"TT", line:"Maintenance", amount: 5000,
                     on:"2026-07-12"});
      expSave();
      eq(ledgerFor("2026-07").length, 1, "the entry before the clock moves");
      const t = new Date(); t.setDate(t.getDate() + 40);
      Date.now = () => t.getTime();
      eq(expenses[0].on, "2026-07-12", "the stored date after 40 days");
      eq(ledgerFor("2026-07").length, 1, "the entry is still in July after 40 days");
      eq(ledgerFor("2026-08").length, 0, "it must not have slid into another month");
      return "still 12 Jul, forty days later";
    } finally { Date.now = realNow; expenses.length = 0; expenses.push(...keep); expSave(); }
  });

  /* A long press on a room tile is how the timeline opens. On touch the
     browser's own long-press ran first and selected the word "BOOKED", so the
     peek either never came or came up under a selection highlight. */
  await test("a long press on a room is a gesture, not a text selection", async () => {
    await settle();
    document.querySelectorAll(".tabbar button")[0].click();
    await until(() => document.querySelector(".tile"), "the room grid");
    const t = document.querySelector(".tile");
    const cs = getComputedStyle(t);
    const sel = cs.userSelect || cs.webkitUserSelect;
    eq(sel, "none", "user-select on a room tile");
    /* every button, not just this one — they are all gestures */
    const bad = [...document.querySelectorAll("button")].filter(b=>{
      const c = getComputedStyle(b);
      return (c.userSelect || c.webkitUserSelect) !== "none";
    });
    eq(bad.length, 0, `${bad.length} selectable buttons, first "${bad[0] && bad[0].textContent.slice(0,20)}"`);
    /* and an input must stay selectable — that is the one place it is the point */
    const inp = document.querySelector("input");
    if(inp){
      const ic = getComputedStyle(inp);
      ok((ic.userSelect || ic.webkitUserSelect) !== "none", "an input was made unselectable too");
    }
    return `${document.querySelectorAll("button").length} buttons, none selectable`;
  });

  /* Eleven lines were charged the way rent is charged: one number, the same
     every month, stated with the confidence of a lease. Rent has earned that.
     An electricity meter and a lift motor have not. */
  await test("a cost line knows what kind of cost it is", async () => {
    const keepK = JSON.parse(JSON.stringify(costKind));
    const keepE = expenses.slice();
    try {
      expenses.length = 0; expSave();
      const K = FIN[FIN.length-1][0];
      const cm = costMonth("TT", K);
      eq(cm.kind["Rent"], "fixed", "what kind of cost rent is");
      eq(cm.kind["Electricity"], "varies", "what kind of cost electricity is");
      eq(cm.kind["Maintenance"], "one-off", "what kind of cost maintenance is");
      /* Known is fixed lines plus anything logged — NOT a count of rows, which
         would treat rent and bonuses as equals. */
      const fixedSum = Object.keys(cm.lines)
        .filter(k => cm.kind[k] === "fixed").reduce((a,k)=> a + cm.lines[k], 0);
      eq(cm.known, fixedSum, "known against the fixed lines");
      eq(cm.known + cm.estimated, cm.total, "known and estimated must partition the total");
      ok(cm.certainty > 0 && cm.certainty < 1,
        `certainty ${cm.certainty} — the shipped model should be neither all known nor all guessed`);
      /* Logging a line makes it known WHATEVER kind it is. */
      expenses.push({id:"test-kind-1", code:"TT", line:"Electricity", amount: 71000, on: K + "-09"});
      expSave();
      const cm2 = costMonth("TT", K);
      eq(cm2.basis["Electricity"], "actual", "basis once the bill is logged");
      eq(cm2.known - cm.known, 71000, "a logged variable line did not become known");
      /* And the classification is correctable, because these defaults are a
         reading of the trade and not of this business. */
      costKind["TT"] = {Electricity: "fixed"};
      expenses.length = 0; expSave();
      const cm3 = costMonth("TT", K);
      eq(cm3.kind["Electricity"], "fixed", "an operator override of a line's kind");
      eq(cm3.known - cm.known, cm.lines["Electricity"], "the override did not move what is known");
      return `${money(cm.known)} known of ${money(cm.total)} — ${Math.round(cm.certainty*100)}% — and an override moves it`;
    } finally {
      Object.keys(costKind).forEach(k=> delete costKind[k]);
      Object.assign(costKind, keepK); jset(KIND_STORE, costKind);
      expenses.length = 0; expenses.push(...keepE); expSave();
    }
  });

  /* Rent is the one number in the model nobody is guessing at. An earlier pass
     hatched every unlogged line, which drew it in the same pattern as a
     maintenance average. */
  await test("rent is drawn as known and an unlogged average is not", async () => {
    const keep = expenses.slice();
    try {
      expenses.length = 0; expSave();
      await settle();
      document.querySelectorAll(".tabbar button")[3].click();
      await until(() => document.getElementById("tabseg"), "the Business segments");
      const chip = [...document.querySelectorAll("#tabseg *")].find(e => e.textContent.trim() === "Profit");
      ok(chip, "no Profit segment"); chip.click();
      await until(() => document.querySelector(".wrow"), "the waterline rows");
      const row = [...document.querySelectorAll(".wrow")].find(w => /Telecom|TreeTops|Madhapur/.test(w.innerText));
      ok(row, "no building row to open"); row.click();
      await until(() => document.querySelector(".costsplit"), "the cost breakdown");
      const rows = [...document.querySelectorAll(".costsplit .cs-r")];
      ok(rows.length, "no cost lines drawn");
      const rent = rows.find(x => /^Rent/.test(x.textContent));
      ok(rent, "no rent line in the breakdown");
      ok(!rent.classList.contains("est"), "rent is drawn as an estimate");
      const est = rows.filter(x => x.classList.contains("est"));
      ok(est.length, "nothing is drawn as an estimate, so the distinction says nothing");
      return `${rows.length} lines, ${est.length} estimated, rent among the known`;
    } finally { expenses.length = 0; expenses.push(...keep); expSave(); closeSheet(); }
  });

  /* ══ Ask, when the question is a person ═════════════════════════════════ */

  /* Ask could only answer "is anything free". A guest's name recognises no date,
     so the parser fell back to its default and reported confidently on rooms
     free TONIGHT — a wrong answer to a question nobody asked. */
  await test("a guest's name is answered with the guest, not with tonight", async () => {
    const who = bookings().filter(r => r.guest && r.nights)
      .reduce((m,r)=>{ const k = nameKey(r.guest); (m[k] = m[k] || []).push(r); return m; }, {});
    const name = Object.keys(who).find(k => who[k].length >= 2 && !NOT_A_NAME.test(k));
    ok(name, "the book has nobody who stayed twice to search for");
    const label = who[name][0].guest;
    /* the route, first: a name must never reach the availability parser */
    const p = parseQuery(label);
    eq(p.how, "tonight", "the parser should find no date in a name");
    const found = personQuery(label, p);
    ok(found && found.length, `"${label}" did not route to a person`);
    eq(found[0].rows.length, who[name].length, "stays found for that person");
    /* and the three states the operator actually asks about */
    const g = found[0];
    eq(g.past.length + g.here.length + g.ahead.length, g.rows.length,
      "past, here and ahead must partition the stays");
    /* a date question still belongs to the parser */
    ok(!personQuery("this weekend", parseQuery("this weekend")), "'this weekend' routed to a person");
    ok(!personQuery("3 bhk", parseQuery("3 bhk")), "'3 bhk' routed to a person");
    ok(!personQuery("tonight", parseQuery("tonight")), "'tonight' routed to a person");
    const fl = flats[0].id;
    ok(!personQuery(fl, parseQuery(fl)), `a flat id (${fl}) routed to a person`);
    return `${label}: ${g.rows.length} stays — ${g.past.length} past, ${g.here.length} in, ${g.ahead.length} ahead`;
  });

  /* A misspelt name used to fall back to the parser and get answered about
     tonight, which is the same wrong answer wearing a different hat. */
  await test("a name that is not in the book says so", async () => {
    const miss = personQuery("Zzyzx", parseQuery("Zzyzx"));
    ok(Array.isArray(miss), "an unknown name did not route to a person at all");
    eq(miss.length, 0, "matches for a name nobody has");
    /* but a long pasted enquiry is not a name and still belongs to the parser */
    const paste = "Hi do you have a 2bhk for four people";
    ok(!personQuery(paste, parseQuery(paste)), "a pasted enquiry routed to a person");
    return "unknown names answered, pasted enquiries left to the parser";
  });

  /* A phone is proof where a name is a guess, so a number wins outright. */
  await test("a phone number finds its guest", async () => {
    const r = bookings().find(x => x.start > 0 && x.guest);
    ok(r, "no forward booking to hang a number on");
    const had = r.phone;
    r.phone = "9876543210";
    try {
      const found = personQuery("9876543210", parseQuery("9876543210"));
      ok(found && found.length, "the number found nobody");
      eq(nameKey(found[0].name), nameKey(r.guest), "which guest the number found");
      eq(found[0].phone, "9876543210", "the number carried onto the person");
      /* and part of a number works, the way part of a name does */
      const part = personQuery("543210", parseQuery("543210"));
      ok(part && part.length, "a partial number found nobody");
      return `${r.guest} found by number, and by the last six digits`;
    } finally { if(had == null) delete r.phone; else r.phone = had; }
  });

  /* freeSpan(fi, FROM, TO) takes an END DAY. The building chips and section
     headers passed the NIGHT COUNT, so for any night but tonight the range ran
     backwards, freeRange returned vacuously true, and every flat counted free —
     38 of 38 where 18 were. Tonight was right by accident (d + n === n at
     d = 0), which is why it survived being looked at. */
  await test("the building counts agree with the tiles on every night", async () => {
    await settle();
    document.querySelectorAll(".tabbar button")[0].click();
    await until(() => document.querySelector(".roomfilt button"), "the building filter");
    /* the invariant, measured directly: what the chips count must be what
       freeSpan says for the SAME span the tiles are drawn for */
    for(const d of [0, 1, 3, 7]){
      for(const n of [1, 3]){
        const byCode = {};
        flats.forEach((f, fi)=>{
          byCode[f.code] = (byCode[f.code] || 0) + (freeSpan(fi, d, d + n) ? 1 : 0);
        });
        const all = flats.reduce((a,f,fi)=> a + (freeSpan(fi, d, d + n) ? 1 : 0), 0);
        eq(Object.values(byCode).reduce((a,v)=> a + v, 0), all,
          `night ${d}, ${n}n: the buildings do not sum to the portfolio`);
        /* and it must not be the vacuous answer */
        ok(!(d > 0 && all === NF && countFreeFor(d, n) !== NF),
          `night ${d}, ${n}n: every one of ${NF} flats counted free — the span is running backwards`);
        eq(all, countFreeFor(d, n),
          `night ${d}, ${n}n: the filter count disagrees with the app's own free count`);
      }
    }
    /* and through the real DOM, on a night that is not tonight */
    setPickedNight(3);
    renderRooms && renderRooms();
    await until(() => document.querySelector(".roomfilt button"), "the filter after moving the night");
    const chips = [...document.querySelectorAll(".roomfilt button")];
    const num = b => +(b.textContent.match(/(\d+)\s*$/) || [0,0])[1];
    const all = num(chips[0]);
    ok(all < NF, `the All chip says ${all} of ${NF} free on a future night — vacuously true again`);
    eq(chips.slice(1).reduce((a,b)=> a + num(b), 0), all, "the chips do not sum to All");
    setPickedNight(0);
    return `four nights x two spans, chips and tiles agree`;
  });

  /* save() keys rows by the flat's TEXT id and load() read them back through
     `flatIndex[r.id] !== undefined`, which DROPS any row whose flat no longer
     exists. That was the whole migration story, and it was fine until the Lotus
     Pond merge retired twelve ids — at which point every device that had used
     the app before it lost its Lotus Pond bookings on the next load. Deleted,
     silently, by an update. */
  await test("a booking on a retired flat id survives the update", async () => {
    const KEY = STORE, INV = "vacancy.inventory.v2";
    const bBook = localStorage.getItem(KEY), bInv = localStorage.getItem(INV);
    const keepR = resv.slice(), keepF = flats.slice(), keepNF = NF;
    try {
      const iso = new Date(); iso.setHours(0,0,0,0);
      const stamp = iso.getFullYear() + "-" + String(iso.getMonth()+1).padStart(2,"0")
                  + "-" + String(iso.getDate()).padStart(2,"0");
      /* the three rows a pre-merge device holds for ONE let of the 3rd floor */
      localStorage.setItem(KEY, JSON.stringify({savedOn: stamp, rows: [
        {id:"LP-301", start:5, end:8, guest:"Fixture Rao", src:"Direct", amount:18000, manual:true},
        {id:"LP-302", start:5, end:8, guest:"Fixture Rao", src:"Direct", manual:true},
        {id:"LP-303", start:5, end:8, guest:"Fixture Rao", src:"Direct", manual:true},
        {id:"M2",     start:1, end:3, guest:"Fixture Control", src:"Direct", amount:12000, manual:true},
      ]}));
      ok(load(), "the fixture book did not load at all");
      recompute();
      const rows = resv.filter(r => /^Fixture /.test(r.guest || ""));
      const rao = rows.filter(r => r.guest === "Fixture Rao");
      /* not dropped … */
      eq(rao.length, 1, "rows kept for a let stored across three retired ids");
      eq(flats[rao[0].fi].id, "LP-3", "which flat the retired ids resolved to");
      /* … and the money on the one row that carried it is not lost */
      eq(rao[0].amount, 18000, "the amount survived the collapse");
      /* a flat that did not change is untouched */
      const ctl = rows.find(r => r.guest === "Fixture Control");
      ok(ctl && flats[ctl.fi].id === "M2", "the control booking moved or vanished");
      /* and the destination actually reads as booked — the reported symptom */
      ok(occ[rao[0].fi][5], "LP-3 still reads free on a night it is let");
      return `three rows on retired ids became one let on LP-3, ${money(18000)} intact`;
    } finally {
      if(bBook == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, bBook);
      if(bInv  == null) localStorage.removeItem(INV);  else localStorage.setItem(INV, bInv);
      resv = keepR; flats = keepF; NF = keepNF;
      flatIndex = Object.fromEntries(flats.map((f,i)=>[f.id,i]));
      recompute();
    }
  });

  /* ══ the activity log ═══════════════════════════════════════════════════ */

  /* Every action the operator takes is a change to somebody's booking, and none
     of it left a trace on the phone. "Did I cancel that, or did the app?" had
     no answer without opening Supabase, which is the wrong place to look. */
  await test("every change the operator makes is recorded, in order", async () => {
    const keep = activity.slice();
    const KEY = LOG_STORE;
    const backup = localStorage.getItem(STORE);
    try {
      activity.length = 0; jset(KEY, activity);
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 3));
      ok(fi != null, "no flat free for the fixture");
      ok(addBooking(fi, 0, 2, "Log Fixture", "Direct", {amount: 15000}), "fixture booking refused");
      const b = resv.find(r => r.guest === "Log Fixture");
      addPayment(b, 5000, "UPI");
      const to = flats.map((f,i)=>i).find(i => i !== b.fi && freeSpan(i, 0, b.end));
      if(to != null) moveBooking(b, to);
      cancelBooking(resv.find(r => r.guest === "Log Fixture"));

      const kinds = activity.map(a => a.k);
      /* newest first — the answer to "what did I just do" is the top line */
      eq(kinds[0], "cancel", `the newest entry is "${kinds[0]}", not the cancellation`);
      ok(kinds.indexOf("book") === kinds.length - 1, "the booking is not the oldest entry");
      ["book","paid","cancel"].forEach(k =>
        ok(kinds.indexOf(k) >= 0, `no "${k}" entry was recorded`));
      if(to != null) ok(kinds.indexOf("move") >= 0, "no move entry was recorded");

      /* precise: the flat and the guest, so a line can be audited */
      const booked = activity.find(a => a.k === "book");
      ok(/Log Fixture/.test(booked.s), `the line does not name the guest: ${booked.s}`);
      ok(/₹15,000/.test(booked.s), `the line does not carry the amount: ${booked.s}`);
      eq(booked.g, "Log Fixture", "the guest on the entry");
      eq(booked.f, flats[fi].id, "the flat on the entry");

      /* an absolute timestamp, like the expense ledger — an action happened at
         a wall clock moment and is still that moment tomorrow */
      ok(/^\d{4}-\d{2}-\d{2}T/.test(booked.on), `the time is not an ISO stamp: ${booked.on}`);

      /* capped, so it can never crowd out the bookings in the same storage */
      for(let i = 0; i < LOG_CAP + 20; i++) logAct("book", "filler " + i);
      eq(activity.length, LOG_CAP, "the log grew past its cap");

      /* and it survives a reload */
      const round = JSON.parse(localStorage.getItem(KEY));
      eq(round.length, LOG_CAP, "the log on disk does not match the log in memory");
      return `book → paid → move → cancel, newest first, capped at ${LOG_CAP}`;
    } finally {
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(KEY, activity);
      if(backup != null) localStorage.setItem(STORE, backup);
      load(); recompute();
    }
  });

  /* A number is typed, dictated, and mostly PASTED out of WhatsApp, where it
     arrives wearing "+91 ", or a leading 0, or dashes. The field took every one
     of those verbatim, so one guest could be stored four ways. */
  await test("a phone number is stored one way however it is pasted", async () => {
    const cases = [
      ["+91 98765 43210", "9876543210"], ["0 9876543210",    "9876543210"],
      ["+91-98765-43210", "9876543210"], ["00919876543210",  "9876543210"],
      ["98765 43210",     "9876543210"], ["9876543210",      "9876543210"],
      ["(+91) 98765-43210","9876543210"],
    ];
    cases.forEach(([raw, want]) => eq(tidyPhone(raw), want, `tidyPhone(${JSON.stringify(raw)})`));
    /* and through a real field, on the input event a paste fires */
    const i = document.createElement("input");
    phoneField(i);
    eq(i.maxLength, 10, "the field's maxLength");
    i.value = "+91 98765 43210";
    i.dispatchEvent(new Event("input", {bubbles:true}));
    eq(i.value, "9876543210", "the value after an input event");
    /* a half-typed number must not be mangled while it is being typed */
    i.value = "98765"; i.dispatchEvent(new Event("input", {bubbles:true}));
    eq(i.value, "98765", "a partial number was rewritten mid-typing");
    /* and the lookup key agrees with what is stored, or search breaks */
    eq(digits10(tidyPhone("+91 98765 43210")), "9876543210", "digits10 of a tidied number");
    return `${cases.length} shapes, one stored number`;
  });

  /* "Everything you have done" has to mean everything — repairs, collections,
     finance and inventory, not just bookings. */
  await test("the log records repairs, collections and inventory too", async () => {
    const keep = activity.slice();
    try {
      activity.length = 0; jset(LOG_STORE, activity);
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 3));
      ok(addBooking(fi, 0, 2, "Cover Fixture", "Direct", {amount: 9000}), "fixture refused");
      const b = resv.find(r => r.guest === "Cover Fixture");
      addPayment(b, 4000, "UPI");
      dropPayment(b, b.pays[0]);
      addIssue(fi, "Geyser", "note", "urgent");
      closeIssue(issues[issues.length-1], "Ramesh", "9876543210", 3500);
      cancelBooking(resv.find(r => r.guest === "Cover Fixture"));
      const kinds = activity.map(a => a.k);
      ["book","paid","unpaid","fault","fixed","cancel"].forEach(k =>
        ok(kinds.indexOf(k) >= 0, `nothing recorded for "${k}" — the log is not everything`));
      /* and every kind the app can emit has a glyph; a "·" in a log is the app
         admitting it does not know what it recorded */
      [...new Set(kinds)].forEach(k => ok(ACT_ICON[k], `no glyph for the "${k}" kind`));
      return `${[...new Set(kinds)].length} kinds recorded, every one with a glyph`;
    } finally {
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
      issues = issues.filter(x => x.fault !== "Geyser" || x.fixer !== "Ramesh");
      recompute();
    }
  });

  /* ══ turning the cloud on ═══════════════════════════════════════════════ */

  /* signIn() used to be: authenticate, cloudPull(), jdel(STORE). cloudPull
     replaces flats and resv wholesale with whatever the server has, and jdel
     throws the local book away. The app has been local-only since it shipped,
     so the operator's real book lives in localStorage and NOWHERE ELSE, and the
     server is empty — signing in would have replaced 700+ real bookings with
     nothing and then deleted the only copy. */
  await test("signing in to an empty server adopts the book instead of erasing it", async () => {
    const keepR = resv.slice(), keepF = flats.slice(), keepNF = NF,
          keepQ = queue.slice(), keepMode = MODE, keepHost = hostId,
          keepSess = session, keepIss = issues.slice();
    const backup = localStorage.getItem(STORE);
    const realApi = window.api;
    try {
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 3));
      ok(addBooking(fi, 0, 2, "Adoption Fixture", "Direct", {amount: 31000}), "fixture refused");
      const before = bookings().length;

      /* an EMPTY server, and no network touched */
      window.api = async (path)=>{
        if(/token\?grant_type=password/.test(path))
          return {access_token:"t", refresh_token:"r", expires_in:3600, user:{id:"u1"}};
        if(/\/rest\/v1\/memberships/.test(path))
          return [{host_id:"h1", role:"owner", hosts:{name:"Crescent Stays", slug:"crescent-stays"}}];
        return [];
      };
      await signIn("x@y.z", "pw");

      /* the book is still here — in memory AND on disk */
      eq(bookings().length, before, "bookings after signing in to an empty server");
      ok(bookings().some(r => r.guest === "Adoption Fixture"), "the operator's own booking was erased");
      eq(NF, keepNF, "flats after signing in");
      ok(localStorage.getItem(STORE), "the local book was deleted from storage");
      /* and it is on its way up rather than sitting there */
      ok(queue.length > before, `only ${queue.length} writes queued for ${before} bookings + ${NF} flats`);
      ok(queue.some(op => op.k === "flat+"), "no flats queued — a stay would reference nothing");
      ok(queue.some(op => op.k === "stay+"), "no stays queued");
      /* every queued stay must name a flat, or it will be rejected on arrival */
      const bad = queue.filter(op => op.k === "stay+" && !(op.body && op.body.flat_id));
      eq(bad.length, 0, `${bad.length} queued stays carry no flat_id`);
      return `${before} bookings kept, ${queue.length} writes queued to adopt them`;
    } finally {
      window.api = realApi;
      resv = keepR; flats = keepF; NF = keepNF; queue = keepQ; issues = keepIss;
      MODE = keepMode; hostId = keepHost; session = keepSess;
      flatIndex = Object.fromEntries(flats.map((f,i)=>[f.id,i]));
      if(backup != null) localStorage.setItem(STORE, backup);
      jset(QUEUE_KEY, queue);
      recompute();
    }
  });

  /* The owner's one hard requirement: it must stay as fast as it is now. Every
     read is served from memory in both modes; the cloud only ever appears on
     the WRITE path, behind a queue. */
  await test("no read touches the network, in either mode", async () => {
    const realFetch = window.fetch, seen = [];
    const wasMode = MODE, wasHost = hostId;
    try {
      window.fetch = (...a)=>{ seen.push(String(a[0])); return realFetch(...a); };
      MODE = "live"; hostId = "h1";
      recompute(); moneyStats(); owedStats(); finRows(FIN[FIN.length-1][0]);
      findPeople("ra"); exportRows(); appMonth(dayISO(0).slice(0,7));
      SCREENS.forEach(sc => sc.render());
      eq(seen.length, 0, `a read went to the network: ${seen.slice(0,2).join(", ")}`);
      return "every stat, render and query served from memory";
    } finally { window.fetch = realFetch; MODE = wasMode; hostId = wasHost; }
  });

  /* The fill already says booked — it is the whole point of the colour — so
     "BOOKED" under the room number spent the tile's one line restating what the
     eye had read. The name is what the operator wants off this grid. */
  await test("a booked room names its guest, and the states that carry facts keep them", async () => {
    await settle();
    document.querySelectorAll(".tabbar button")[0].click();
    await until(() => document.querySelector(".tile"), "the room grid");
    const named = [...document.querySelectorAll(".tile s.who")];
    ok(named.length, "no tile names a guest");
    /* every named tile must match a real stay on that flat tonight */
    named.slice(0, 8).forEach(sEl=>{
      const id = sEl.parentElement.querySelector("b").textContent;
      const fi = flatIndex[id];
      const stay = resv.find(r => !isBlock(r) && r.fi === fi && 0 >= r.start && 0 < r.end);
      ok(stay, `${id} shows a name but has no stay tonight`);
      eq(sEl.textContent, (stay.guest || "").trim(), `the name on ${id}`);
    });
    /* a name is not a status: no caps, and it does not ellipsise */
    const cs = getComputedStyle(named[0]);
    eq(cs.textTransform, "none", "a guest name is being upper-cased");
    eq(cs.textOverflow, "clip", "a guest name is ellipsising instead of fading");
    ok(/linear-gradient/.test(cs.maskImage || cs.webkitMaskImage || ""),
      "no fade mask on the name");
    /* the states that carry a fact the fill cannot keep their word */
    const words = [...document.querySelectorAll(".tile s:not(.who)")].map(e=>e.textContent);
    ok(words.some(w => /^Open|^Till |^Free /.test(w)), `no free-state wording found: ${words.slice(0,4)}`);
    /* and a name is inert — el() sets textContent, and this proves it stays that way */
    const probe = '<img src=x onerror="window.__tilepwn=1">Zed';
    /* Not just any free flat: a stay that ENDS tonight makes the tile a
       turnaround, and turnaround outranks the name by design — it is a fact the
       fill cannot carry. The fixture needs a room whose tonight is plain. */
    const fi2 = flats.map((f,i)=>i).find(i =>
      freeSpan(i, 0, 3) && !resv.some(r => r.fi === i && r.end === 0));
    ok(fi2 != null, "no room free for three nights with a quiet tonight");
    ok(addBooking(fi2, 0, 2, probe, "Direct"), "probe booking refused");
    try {
      SCREENS[0].render();
      await until(() => [...document.querySelectorAll(".tile s.who")]
        .some(e => e.textContent.indexOf("Zed") >= 0), "the probe tile");
      ok(!window.__tilepwn, "a guest name executed from a room tile");
      const t = [...document.querySelectorAll(".tile s.who")].find(e=>e.textContent.indexOf("Zed")>=0);
      eq(t.children.length, 0, "the name was parsed as markup, not text");
    } finally {
      const p = resv.find(r => r.guest === probe);
      if(p) cancelBooking(p);
      recompute();
    }
    return `${named.length} rooms named, status wording kept where it carries a fact`;
  });

  /* ══ the whole surface ══════════════════════════════════════════════════ */

  await test("no text falls below AA in either theme", async () => {
    const m = await import("./audit.js?t=" + Date.now());
    const out = [];
    for (const t of ["light", "dark"]) {
      await m.setThemeAndSettle(t);
      const r = await m.contrast({ sheets: false });
      ok(r.settled, `${t}: theme was not settled, numbers are unreliable`);
      ok(r.failures === 0,
        `${t}: ${r.failures} below AA, worst ${r.worst[0] && r.worst[0].r}:1 on "${r.worst[0] && r.worst[0].text}"`);
      out.push(`${t} ${r.checked}`);
    }
    return out.join(" · ") + " nodes clean";
  });

  const passed = results.filter(r => r.pass).length;
  const flaky = results.filter(r => r.pass && /\[flaky:/.test(r.detail || ""));
  return {
    passed, failed: results.length - passed,
    flaky: flaky.length,
    failures: results.filter(r => !r.pass),
    all: results.map(r => `${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? " — " + r.detail : ""}`),
    ...(flaky.length ? { note: "some tests only passed on retry — the page was being driven by something else, or a real intermittent bug is hiding here" } : {}),
  };
}
