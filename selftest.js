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
    /* LET THE IN-FLIGHT WRITES LAND FIRST. A test that stubs the network and
       holds the answer releases it on the way out — so its eight parallel
       reads resolve AFTER this block would have run, and cloudPull assigns
       `flats = []` to an inventory this code has already put back. The next
       test then snapshots the emptiness as its own starting point and every
       one after it fails with "no flat free for the fixture".
       Restoring before the dust settles is not restoring. */
    await wait(30);
    // every test runs against the real book; put it back exactly
    try {
      /* A RESTORE MUST BE DUMB AND TOTAL. This used applyInventory, which is a
         MIGRATION: it re-keys every booking through the old flat list, logs an
         activity line, and writes to storage. Handed the good snapshot after a
         test had emptied `flats`, it mapped every row through an empty list —
         and if it threw, the catch below swallowed it and left the inventory
         empty for good, because the NEXT test then snapshotted the emptiness
         as its own starting point. That is how one leaked stub turned into
         thirty failures reading "no flat free for the fixture".
         Restoring is not migrating. Put the three variables back. */
      if (JSON.stringify(flats) !== snapF) {
        flats = JSON.parse(snapF);
        NF = flats.length;
        flatIndex = Object.fromEntries(flats.map((f, i) => [f.id, i]));
      }
      resv = JSON.parse(snapR);
      recompute();
      window.closeGate && closeGate();
      closeSheet();
      /* AND CLEAR THE TOASTS. A test that cancels a booking or extends a stay
         raises one, and they linger for up to twenty seconds — so a run left a
         stack of "Ended Fixture now leaves 12 Sep" over the app, which the
         owner saw while watching the preview and reasonably read as the app
         shouting at him. They are also a hazard inside the suite itself:
         undoButton() searches every toast on screen, so one left by an earlier
         test is a button a later test can click by mistake. */
      document.querySelectorAll(".toast").forEach(t => t.remove());
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

  /* THE SUITE DOES NOT TALK TO THE SERVER ABOUT ITSELF. Every test that books,
     pays, cancels or ticks calls logAct, logAct calls track, and track posts to
     app_events — as anon, with no host, from whatever machine is running the
     tests. 23,717 rows of "Priya Fixture", "filler 317" and "Gone Fixture" had
     piled up in the operator's telemetry against 72 real ones before anybody
     looked, and the only reason it did no visible harm is that the activity
     sheet filters on host_id and so could never see them.

     Restored in the finally below, because a suite that leaves telemetry off
     is a suite that hides the next real crash. */
  const telWas = telOff;
  telOff = true;
  try {

  /* ══ data loss ══════════════════════════════════════════════════════════ */

  /* THE UNDO, not whichever button is nearest the top of the document. Every
     toast now carries a ✕, so `.toast button` finds the dismiss control of
     whatever toast a previous test left on screen and quietly clicks that
     instead — the cancellation stands, the row never comes back, and the
     failure reads as a storage bug. Ask for the button by what it says. */
  const undoButton = () =>
    [...document.querySelectorAll(".toast button")].find(b => b.textContent.trim() === "Undo");

  await test("a guest who leaves owing survives the next day's rollover", async () => {
    const KEY = STORE;   // the app's own key, not a copy of it — see the v2 bump
    const backup = localStorage.getItem(KEY);
    /* BUILT, NOT FOUND. This looked for a guest who had already left owing and
       asserted the rollover kept them — which held while the shipped book
       happened to contain one. It does not any more, and the test then failed
       for having no fixture rather than for the grace window being broken. The
       money half (nothing erased) still passed throughout.
       Same rule as everywhere else in this file: build the case you are
       testing, then you are testing it. */
    let built = null;
    if(!bookings().some(r => r.end < 0 && dueFrom(r) > 0)){
      /* addBooking() refuses a negative start by design — you cannot take a
         booking for a night that has gone — so a stay that ALREADY DEPARTED has
         to be laid into the book directly, the way load() does it. */
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, -3, -1));
      ok(fi != null, "no flat free for a past stay, so the fixture cannot be built");
      resv.push({fi, start:-3, end:-1, nights:2, guest:"Rollover Fixture",
                 src:"Direct", manual:true, amount:9000, pays:[], bookedOn:-5});
      recompute();
      built = resv.find(r => r.guest === "Rollover Fixture");
      ok(built && dueFrom(built) > 0, "the fixture is not actually owing");
    }
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
    if(backup != null) localStorage.setItem(KEY, backup); else localStorage.removeItem(KEY);
    load(); recompute();
    const still = resv.find(r => r.guest === "Rollover Fixture");
    if(still) resv.splice(resv.indexOf(still), 1);
    recompute();
    eq(owedBefore - owedAfter, 0, "rupees erased by one rollover");
    ok(kept > 0, "no departed-unpaid bookings were kept at all — the grace window is not working");
    return `₹0 erased, ${kept} unpaid departures kept`;
  });

  await test("undo restores a stay that runs past the end of the book", async () => {
    const past = resv.find(r => !isBlock(r) && r.end > DAYS);
    ok(past, "seed has no stay ending past DAYS — this test can no longer see the bug it guards");
    const { fi, guest } = past, n0 = resv.length, end0 = past.end, start0 = past.start;
    cancelWithUndo(past, fi);
    const btn = undoButton();
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
    undoButton().click();
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
    undoButton().click();
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

  /* The sheet's one-night "Block" on TT-402 ended on the 28th and a guest was
     in that morning; six days later the board still asked "Is TT-402 back in
     service?" — and the operator read that, reasonably, as the app saying the
     flat was out. Built rather than found, because whether the seed holds a
     block a guest followed is not the test's business. */
  await test("a past block a guest has since followed is not asked about", async () => {
    // nobody in it from five nights ago to tomorrow, or the book has an answer
    // before the fixture asks the question
    const fi = flats.findIndex((f, i) => !resv.some(r => r.fi === i && r.end > -5 && r.start < 2));
    ok(fi >= 0, "no flat empty from five nights ago through tomorrow");
    const n0 = resv.length;
    const blk = { fi, start: -5, end: -4, nights: 1, kind: "block",
                  reason: "Owner use", note: "Block", guest: "Out of service", src: "Block" };
    resv.push(blk); recompute();
    eq(blockNudges().some(x => x.r === blk), true, "a block that ended 4 days ago, nobody in since, is asked about");
    const stay = { fi, start: -4, end: 1, nights: 5, guest: "Since", src: "Direct", pays: [] };
    resv.push(stay); recompute();
    eq(blockNudges().some(x => x.r === blk), false, "asked about a flat a guest has slept in since");
    stay.start = 0; stay.nights = 1; recompute();
    eq(blockNudges().some(x => x.r === blk), false, "a guest arriving this morning also answers it");
    stay.start = 1; stay.end = 2; recompute();
    eq(blockNudges().some(x => x.r === blk), true, "a stay that has not begun is treated as an answer");
    resv.splice(resv.indexOf(stay), 1); resv.splice(resv.indexOf(blk), 1); recompute();
    eq(resv.length, n0, "row count after the fixture was removed");
    return "ended block · guest in since → no question; nobody since → still asked";
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
    /* openDay, since the three ops sheets became one. The claim is unchanged:
       a guest name is text wherever it is drawn. */
    openDay(0);
    await until(() => document.querySelector(".sheet .meta"), "the day sheet to render");
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

  /* THIS ONE WRITES TO DISK, so it has to clean up after itself. applyInventory
     is not a setter — it re-keys every booking and PERSISTS the result — so the
     harness putting `flats` back in memory left Kondapur in localStorage. Every
     full run then booted with last run's extra flat and added another: NF read
     38, then 39, then 40, with two KP-101 rows sharing an id, and the failure
     surfaced somewhere else entirely. A test that touches storage restores
     storage. */
  await test("Ask matches a building added after boot", async () => {
    const before = localStorage.getItem(INV_STORE);
    const wasFlats = flats.map(f => ({ ...f }));
    try {
      const next = flats.map(f => ({ ...f }));
      next.push({ id: "KP-101", code: "KP", bname: "Kondapur", bshort: "Kondapur",
                  type: "2 BHK", floor: 1, rate: 3000 });
      applyInventory(next);
      await until(() => flats.some(f => f.code === "KP"), "the new building to land in flats");
      const bldg = parseQuery("anything in kondapur tonight").bldg;
      eq(bldg, "KP", "building matched for a name added after boot");
      return "live inventory, not the boot seed";
    } finally {
      applyInventory(wasFlats);
      if (before != null) localStorage.setItem(INV_STORE, before);
      else localStorage.removeItem(INV_STORE);
    }
  });

  /* The invariant that would have caught the above on the run that caused it,
     rather than three runs later on an unrelated test. */
  await test("no test has left a flat behind in the inventory", () => {
    const ids = flats.map(f => f.id);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    eq(dupes.length, 0, `flats sharing an id: ${[...new Set(dupes)].join(", ")}`);
    const stored = (() => { try { return JSON.parse(localStorage.getItem(INV_STORE) || "null"); }
                           catch (e) { return null; } })();
    const rows = stored && (Array.isArray(stored) ? stored : stored.flats);
    if (rows) {
      const sIds = rows.map(f => f.id);
      const sd = sIds.filter((v, i) => sIds.indexOf(v) !== i);
      eq(sd.length, 0, `stored inventory has duplicates: ${[...new Set(sd)].join(", ")}`);
    }
    ok(!flats.some(f => f.code === "KP"), "Kondapur is still in the book");
    return `${NF} flats, every id its own`;
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
      /* and the handful the sample anchors to TODAY on purpose, so the public
         link always opens on a day with turnarounds on it. They carry the flag
         precisely so this invariant can exclude them by name rather than by
         accident; everything from BOOK is still held to BOOK_ON. */
      if (r.today) continue;
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

  /* The tab was a fixed frame — two bounded troughs and nothing else moved —
     and the answer sat in a 156px box. It is a page again: the calendar
     scrolls away, the answer bar pins under the top bar, and the list runs
     its full length with no inner scroll. This test used to assert the page
     could not scroll; it now asserts what the page does when it does. */
  await test("the Month tab scrolls as a page, the answer bar pins, and the list is never boxed", async () => {
    const scr = document.getElementById("scr-month");
    const keep = {a: sel.a, n: sel.n};
    try {
      document.querySelectorAll(".tabbar button")[1].click();
      await until(() => document.querySelector(".calscroll .day[data-d]"), "the calendar trough");
      await until(() => document.querySelector(".screen.on.seen"), "the entrance to finish");
      /* the emptiest night in the book — the longest list */
      let best = { d: 0, f: -1 };
      for (let d = 0; d < DAYS; d++) { const f = freeCount(d); if (f > best.f) best = { d, f }; }
      pendingStart = null; sel = { a: best.d, n: 1 }; renderMonth();
      await until(() => document.querySelector(".freelist .row"), "the answer");
      const list = scr.querySelector(".freelist"), bar = scr.querySelector(".answerbar");
      ok(list && bar, "no answer list or no answer bar");
      /* the list is page content: nothing of it is clipped inside itself */
      ok(list.scrollHeight <= list.clientHeight + 1, "the list still scrolls inside a box of its own");
      ok(scr.scrollHeight > scr.clientHeight + 200, "the page does not scroll with the longest list");
      /* at rest, nothing is stuck and the nights label is the plain count */
      ok(!bar.classList.contains("stuck"), "the bar reads as stuck before anything scrolled");
      eq(bar.querySelector(".pn b").textContent, "1 night", "the resting nights label");
      /* scroll the page: the calendar leaves, the bar pins at the screen's top.
         The scroll EVENT that flips the stuck flag fires on the next painted
         frame, and a pane driven from a tool call does not always paint — so
         the mark is called directly here and the pin itself is asserted from
         geometry, which position:sticky settles synchronously. */
      scr.scrollTop = 600;
      stuckMark && stuckMark();
      ok(bar.classList.contains("stuck"), "the bar does not know it is pinned");
      const st = scr.getBoundingClientRect().top, bt = bar.getBoundingClientRect().top;
      ok(Math.abs(bt - st) <= 1, `the bar is ${(bt - st).toFixed(1)}px from the top of the screen while stuck`);
      const cal = scr.querySelector(".calscroll").getBoundingClientRect();
      ok(cal.bottom <= bt + 1, "the calendar is still on screen under the pinned bar");
      /* and the list is what is under the bar */
      const under = document.elementFromPoint(window.innerWidth / 2, bt + bar.offsetHeight + 40);
      ok(under && under.closest(".freelist"), `what scrolls under the bar is ${under && under.className}`);
      /* stuck, the nights control says which nights, because the head has gone */
      ok(/Sep|Oct|Nov|Aug/.test(bar.querySelector(".pn b").textContent),
        `the pinned bar does not carry the dates: ${bar.querySelector(".pn b").textContent}`);
      /* tapping it goes back to the calendar — a smooth scroll, so it takes
         frames; given the pane paints, it is there well inside the wait */
      bar.querySelector(".pn b").click();
      await until(() => scr.scrollTop < 5, "the tap to scroll back to the top", 8000);
      stuckMark && stuckMark();
      ok(!bar.classList.contains("stuck"), "the bar stayed stuck at the top of the page");
      eq(bar.querySelector(".pn b").textContent, "1 night", "the nights label back at rest");
      return `${best.f} free · ${Math.round(scr.scrollHeight)}px page, bar pinned at ${Math.round(bt - st)}px, list unboxed`;
    } finally {
      sel = keep; pendingStart = null; scr.scrollTop = 0;
    }
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
    /* SCOPED TO THE SCREEN IT IS ABOUT. Both Rooms and Month live in the
       document at once — only one carries .on — and Month now has a building
       filter of its own, so a bare ".roomfilt button" collects both screens'
       chips and the counts came out as 89 against an All of 21. The chip row
       is a shared component; the assertion is about one screen's copy of it. */
    await until(() => document.querySelectorAll("#scr-rooms .roomfilt button").length, "the building filter");
    const chips = [...document.querySelectorAll("#scr-rooms .roomfilt button")];
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
    await until(() => document.querySelector("#scr-rooms .roomfilt button"), "the building filter");
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
    await until(() => document.querySelector("#scr-rooms .roomfilt button"), "the filter after moving the night");
    const chips = [...document.querySelectorAll("#scr-rooms .roomfilt button")];
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
      /* number pasted with its context — the digits before it must lose */
      ["Flat 402 9876543210", "9876543210"],
    ];
    cases.forEach(([raw, want]) => eq(tidyPhone(raw), want, `tidyPhone(${JSON.stringify(raw)})`));

    /* THROUGH THE REAL EDITING PIPELINE, not through .value. The first
       version of this test assigned .value and asserted maxLength === 10 —
       and maxLength is applied by the browser BEFORE script sees the text,
       so it truncated every real paste of "+91 98765 43210" to "+91 98765 "
       while the test, whose assignment maxLength does not constrain, stayed
       green. The test asserted the bug. execCommand("insertText") goes
       through the same pipeline a paste does, so a returned truncation would
       be caught here. */
    const i = document.createElement("input");
    phoneField(i);
    ok(i.maxLength < 0 || i.maxLength > 15,
       `maxLength is back (${i.maxLength}) — it truncates pastes before script runs`);
    document.body.appendChild(i);
    try {
      i.focus();
      const piped = document.execCommand("insertText", false, "+91 98765 43210");
      if (piped) {
        await wait(30);
        eq(i.value, "9876543210", "a paste through the editing pipeline");
        /* an eleventh TYPED digit is refused, the way maxLength used to feel */
        i.setSelectionRange(10, 10);
        document.execCommand("insertText", false, "5");
        await wait(30);
        eq(i.value, "9876543210", "an eleventh typed digit was accepted");
      } else {
        /* pipeline not available here (hidden pane, no edit focus) — the
           .value path below still guards the tidier itself */
        i.value = "+91 98765 43210";
        i.dispatchEvent(new Event("input", {bubbles:true}));
        eq(i.value, "9876543210", "the value after an input event");
      }
      /* a half-typed number must not be mangled while it is being typed */
      i.value = "98765"; i.dispatchEvent(new Event("input", {bubbles:true}));
      eq(i.value, "98765", "a partial number was rewritten mid-typing");
    } finally { i.remove(); }
    /* and the lookup key agrees with what is stored, or search breaks */
    eq(digits10(tidyPhone("+91 98765 43210")), "9876543210", "digits10 of a tidied number");
    return `${cases.length} shapes, one stored number, pasted through the pipeline`;
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

  /* THE ONE THE OWNER CAUGHT ON HIS OWN PHONE. G02 showed "Sumit 8 Sep → 15
     Sep" from the real book and "Kavan 8 Sep → 15 Sep" from the sample, side
     by side, as though one flat held two guests. Postgres was clean — Kavan is
     a row in BOOK, not in the database — but reconcile MERGES the rows it
     reports, so the invented book was folded into the live one on screen and
     then written to the cloud cache, where it survived reloads.

     The sibling of the adoption test above, and the two constrain each other:
     an EDITED book must survive signing in, and a BROWSED one must not. */
  await test("a browsed sample book does not follow you into the live one", async () => {
    const keepR = resv.slice(), keepF = flats.slice(), keepNF = NF,
          keepQ = queue.slice(), keepMode = MODE, keepHost = hostId,
          keepSess = session, keepIss = issues.slice(), keepDemo = usingDemo;
    const backup = localStorage.getItem(STORE), cloudWas = localStorage.getItem(CLOUD_KEY);
    const realApi = window.api;
    try {
      /* browsing, not working: the book is the sample and nothing has been
         entered into it */
      usingDemo = true;
      const sample = bookings().slice(0, 4).map(r => r.guest);
      ok(sample.length >= 2, "the sample book is too small to prove anything");
      const serverGuest = "Real Server Guest";
      const fi = flats.map((f, i) => i).find(i => freeSpan(i, 20, 24));
      ok(fi != null, "no flat free for the server fixture");

      /* a server that HAS a book of its own — one flat, one stay */
      window.api = async (path) => {
        if (/token\?grant_type=password/.test(path))
          return {access_token: "t", refresh_token: "r", expires_in: 3600, user: {id: "u1"}};
        if (/\/rest\/v1\/memberships/.test(path))
          return [{host_id: "h1", role: "owner", hosts: {name: "Crescent Stays", slug: "cs"}}];
        if (/\/rest\/v1\/buildings/.test(path))
          return [{id: "b1", code: flats[fi].code, name: flats[fi].bname,
                   short_name: flats[fi].bshort, sort_order: 0}];
        if (/\/rest\/v1\/flats/.test(path))
          return [{id: "f1", building_id: "b1", code: flats[fi].id, floor: 1,
                   unit_type: flats[fi].type, nightly_rate: 3000}];
        if (/\/rest\/v1\/stays/.test(path))
          return [{id: "s1", flat_id: "f1", kind: "booking",
                   starts_on: dayISO(20), ends_on: dayISO(23),
                   guest_name: serverGuest, source: "Direct"}];
        return [];
      };
      await signIn("x@y.z", "pw");

      /* the server's book, and ONLY the server's book */
      const now = bookings().map(r => r.guest);
      ok(now.includes(serverGuest), "the server's own booking did not arrive");
      const leaked = sample.filter(g => now.includes(g));
      eq(leaked.length, 0, `invented guests followed the sign-in through: ${leaked.join(", ")}`);
      eq(bookings().length, 1, `${bookings().length} bookings after signing in to a server with one`);
      /* nothing invented was queued for the shared book either */
      eq(queue.filter(o => o.k === "stay+").length, 0,
        `${queue.filter(o => o.k === "stay+").length} invented stays queued to go up`);
      /* and the cache written on the way out is clean, or it comes back on
         the next reload */
      const cached = jget(CLOUD_KEY) || {};
      const cachedGuests = (cached.rows || []).map(r => r.guest);
      eq(sample.filter(g => cachedGuests.includes(g)).length, 0,
        "the sample was written into the cloud cache and will return on reload");
      return `${sample.length} sample guests dropped, ${serverGuest} kept`;
    } finally {
      window.api = realApi;
      resv = keepR; flats = keepF; NF = keepNF; queue = keepQ; issues = keepIss;
      MODE = keepMode; hostId = keepHost; session = keepSess; usingDemo = keepDemo;
      flatIndex = Object.fromEntries(flats.map((f, i) => [f.id, i]));
      if (backup != null) localStorage.setItem(STORE, backup); else jdel(STORE);
      if (cloudWas != null) localStorage.setItem(CLOUD_KEY, cloudWas); else jdel(CLOUD_KEY);
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
      /* The activity sheet is the ONE deliberate read in the app, it is opened
         by a tap rather than by rendering, and it paints from memory before it
         asks — all of which the next test asserts on its own. An earlier test
         that opened it can still have its fetch land inside this window, which
         is a scheduling artifact and not a screen touching the network. */
      const blocking = seen.filter(u => !/\/app_events/.test(u));
      eq(blocking.length, 0, `a read went to the network: ${blocking.slice(0,2).join(", ")}`);
      return "every stat, render and query served from memory";
    } finally { window.fetch = realFetch; MODE = wasMode; hostId = wasHost; }
  });

  /* The shared timeline is the only screen that has to ask a server anything,
     because the whole point of it is the OTHER phone's work. That makes it the
     one place the owner's "it must stay as fast as it is now" could quietly be
     lost — so it paints what this phone knows first and folds the answer in
     when it arrives, and this pins both halves of that. */
  await test("the activity sheet paints before the network answers, and asks once", async () => {
    const realFetch = window.fetch, realRest = window.rest;
    const wasMode = MODE, wasHost = hostId, wasWho = typeof actWho !== "undefined" ? actWho : null;
    /* NOTHING ELSE MAY USE THE WIRE WHILE IT IS STUBBED. This test counts the
       requests the activity sheet makes, and it makes them through a stub that
       answers [] to everything — so a background cloudPull slipping through
       the same stub both breaks the count (nine requests, not one) and, far
       worse, hands the app an empty book and an empty INVENTORY. That is
       exactly what happened: flats went to zero here and every later test
       failed with "no flat free for the fixture", thirty of them, which read
       for three runs like test pollution and was this.
       flush() calls cloudPull when needPull is set and the queue has drained,
       so both are cleared for the duration and put back afterwards. */
    const wasNeed = needPull, wasQueue = queue.slice(), wasFlats = flats.slice(), wasNF = NF;
    const realPull = cloudPull;
    const hits = [];
    let release;
    const held = new Promise(r => { release = r; });
    try {
      MODE = "live"; hostId = "h1";
      needPull = false; queue = [];
      /* AND THE DOOR needPull AND queue DO NOT CLOSE. Those two guard the pull
         that flush() starts. They do nothing about the one on visibilitychange,
         which fires whenever this pane is fronted or hidden and calls
         flush().then(cloudPull) on the strength of MODE alone — which this test
         has just set to "live".

         That is how eleven book reads landed in a counter meant to see one, on
         a run where the only thing that changed was me bringing the tab to the
         front. It cost three separate investigations before the assertion was
         made to name the paths it caught rather than only count them. The test
         is about the activity sheet; it should not also be a report on whether
         somebody switched windows while it ran. */
      cloudPull = async () => {};
      actWho = {};                                  // membership already known
      window.rest = async (m, p)=>{ hits.push(p); await held; return []; };
      openActivity();
      await wait(120);
      /* the list is on screen while the server has not answered */
      const rows = document.querySelectorAll(".sheet .actrow").length;
      const head = (document.querySelector(".sheet .n") || {}).textContent || "";
      ok(rows > 0 || /nothing yet|looking/.test((document.querySelector(".sheet .m")||{}).textContent||""),
         "the sheet was blank while it waited for the server");
      eq(head, "Everything that has happened", "the sheet did not open");
      /* Name the intruder. "asked the server 12 times" says a pull got
         through and nothing about WHICH, and this test has now twice been the
         place a leaked cloudPull surfaced — once as thirty downstream failures
         and once as a count that moved from 9 to 12 the day cloudPull grew
         three more reads. The paths are the diagnosis. */
      const strays = hits.filter(p => !/app_events/.test(p));
      eq(strays.length, 0,
        `${strays.length} request(s) reached the wire that are not the activity `
        + `sheet's: ${[...new Set(strays.map(p => String(p).split("?")[0]))].join(", ")}`);
      eq(hits.length, 1, `asked the server ${hits.length} times, want 1`);
      ok(/app_events/.test(hits[0]), `asked for the wrong thing: ${hits[0]}`);
      release([]);
      await wait(120);
      return `${rows} rows painted before the answer, 1 request`;
    } finally {
      release && release([]);
      cloudPull = realPull;
      window.fetch = realFetch; window.rest = realRest;
      MODE = wasMode; hostId = wasHost; actWho = wasWho;
      needPull = wasNeed; queue = wasQueue; jset(QUEUE_KEY, queue);
      /* and the inventory, in case a pull got through anyway — an empty one
         is the single most destructive thing a leaked stub can leave behind */
      if(flats.length !== wasNF){
        flats = wasFlats; NF = wasNF;
        flatIndex = Object.fromEntries(flats.map((f, i) => [f.id, i]));
        recompute();
      }
      closeSheet();
    }
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

  /* The owner asked for no cloud until he is ready. That has to be true of the
     whole app, not just the sign-in screen: with the flags off NOTHING may
     leave the phone, on any path, including the one that was quietly posting
     two 401s per launch. */
  /* The cloud is on now, but a phone that has not signed in must still behave
     exactly as it did before: reads from memory, nothing on the wire. Sync is
     something you opt into by signing in, not something that starts happening
     to you. */
  await test("a signed-out phone still never talks to a server for its data", async () => {
    eq(MODE, "sample", "MODE before anyone signs in");
    ok(!session, "a session exists before sign-in");
    const real = window.fetch, seen = [];
    try {
      window.fetch = (...a)=>{ seen.push(String(a[0])); return real(...a); };
      /* every outbound path the app has */
      await telStart();
      track("probe", {x:1});
      telError("probe error");
      await telFlush();
      /* and a full round of ordinary work */
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 2));
      addBooking(fi, 0, 1, "No Network Fixture", "Direct", {amount: 1000});
      const b = resv.find(r => r.guest === "No Network Fixture");
      addPayment(b, 500, "UPI");
      cancelBooking(resv.find(r => r.guest === "No Network Fixture"));
      SCREENS.forEach(sc => sc.render());
      await wait(120);
      /* telemetry is allowed out — it is anonymous, carries no guest data and is
         the thing the owner asked for. The operator's BOOK is what must not
         travel until he signs in. */
      const off = seen.filter(u => !/^(blob:|data:)/.test(u) && !/localhost|127\.0\.0\.1/.test(u));
      const bookLeaked = off.filter(u => /\/(stays|payments|flats|buildings|issues|expenses|cost_lines|revenue_months)/.test(u));
      eq(bookLeaked.length, 0, `the book went out while signed out: ${bookLeaked.slice(0,2).join(", ")}`);
      eq(queue.length, 0, `${queue.length} writes queued while signed out`);
      /* and the sign-in gate must not be reachable */
      const gate = document.getElementById("gate");
      ok(!gate || !gate.classList.contains("on"), "the sign-in gate is showing");
      ok(!/sign in/i.test(document.body.innerText), "'sign in' is on screen somewhere");
      return "no outbound request on any path, and no sign-in on screen";
    } finally { window.fetch = real; recompute(); }
  });

  /* signOut() had `else issues = []`, which deleted every logged fault —
     permanently, with no cloud involved. load() restores them from storage two
     lines above; throwing them away was a leftover from when signing out meant
     discarding a cloud book. A flat's repair history cannot be reconstructed
     from anything else. */
  await test("signing out does not delete the repair history", async () => {
    const keepI = issues.slice(), keepR = resv.slice();
    const backup = localStorage.getItem(STORE);
    try {
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 2));
      addIssue(fi, "Geyser", "signout fixture", "urgent");
      save();
      /* signOut() falls back to seedRealBook() when load() finds nothing, and
         that clears issues BY DESIGN — a seeded book has no repair history. The
         claim under test is only about the path where a book is restored, so
         the precondition is asserted rather than hoped for. */
      ok(localStorage.getItem(STORE), "no saved book, so signOut would reseed and the test means nothing");
      const before = issues.length;
      ok(before > 0, "no issue to test with");
      signOut(false);
      eq(issues.length, before, `${before} faults before signing out, ${issues.length} after`);
      ok(issues.some(x => x.note === "signout fixture"), "the fixture fault was deleted");
      return `${before} faults survived a sign-out`;
    } finally {
      issues = keepI; resv = keepR;
      if(backup != null) localStorage.setItem(STORE, backup); else localStorage.removeItem(STORE);
      load(); recompute();
    }
  });

  /* clearAll() enqueued a bare {k:"wipe"} -> DELETE /stays?host_id=eq.<host>:
     every stay belonging to the whole property. Harmless with one phone; the
     moment two people share a book it deletes the other person's work from a
     screen labelled "test bookings". */
  await test("clearing the test book cannot reach past this device", async () => {
    const keepR = resv.slice(), keepQ = queue.slice(), keepMode = MODE, keepHost = hostId;
    const backup = localStorage.getItem(STORE);
    try {
      resv = resv.map((r,i) => i < 5 ? {...r, sid: "s" + i} : r);
      /* MODE is flipped for exactly one synchronous call and put straight back,
         because clearAll() only queues when live and a leaked "live" makes the
         next test assert against the wrong mode. */
      MODE = "live"; hostId = "h1"; queue = [];
      try { clearAll(); } finally { MODE = keepMode; hostId = keepHost; }
      const wipes = queue.filter(op => /^wipe/.test(op.k));
      ok(wipes.length, "nothing queued to remove the stays");
      wipes.forEach(op=>{
        ok(op.body && Array.isArray(op.body.ids), `a wipe op carries no id list: ${JSON.stringify(op).slice(0,80)}`);
        ok(op.body.ids.length <= 60, "a wipe op carries more ids than a URL can hold");
      });
      /* the decisive property: it names ids, never the host */
      const all = JSON.stringify(queue);
      ok(!/host_id/.test(all), "a queued op still targets the whole host");
      eq(wipes.reduce((a,op)=> a + op.body.ids.length, 0), 5, "ids queued for removal");
      return `${wipes.length} chunk(s), 5 ids, none host-wide`;
    } finally {
      resv = keepR; queue = keepQ; MODE = keepMode; hostId = keepHost;
      jset(QUEUE_KEY, queue);
      eq(MODE, keepMode, "MODE leaked out of the wipe test");
      if(backup != null) localStorage.setItem(STORE, backup);
      load(); recompute();
    }
  });

  /* ══ the cloud cannot eat the book ══════════════════════════════════════ */

  /* rejected() called rollBack() for ANY error that was not a duplicate, a room
     race or an auth failure — which lumps "somebody took the nights" together
     with "this client sent a malformed row". Measured with the old adoption
     bug: 708 bookings spliced out of the live book, one red toast each. */
  await test("a server refusing a row does not delete it from the phone", async () => {
    const keepR = resv.slice(), keepMode = MODE;
    try {
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 2));
      ok(addBooking(fi, 0, 1, "Reject Fixture", "Direct", {amount: 5000}), "fixture refused");
      const r = resv.find(x => x.guest === "Reject Fixture");
      r.sid = "sid-fixture";
      const before = bookings().length;
      /* every client-fault class the server can answer with */
      for(const e of [{code:"23514", message:"violates check constraint"},
                      {code:"22P02", message:"invalid input syntax for uuid"},
                      {code:"23503", message:"violates foreign key"},
                      {status:400,  message:"Bad Request"}]){
        await rejected({k:"stay+", id:"sid-fixture"}, e);
        eq(bookings().length, before, `a ${e.code || e.status} deleted the booking`);
        ok(resv.some(x => x.guest === "Reject Fixture"), `${e.code || e.status} removed the row`);
      }
      ok(resv.find(x => x.guest === "Reject Fixture").unsent, "the row is not marked unsent");
      /* a genuine lost race still rolls back — that one IS the operator's loss */
      return "check, uuid, fk and 4xx all keep the row and mark it unsent";
    } finally {
      const p = resv.find(x => x.guest === "Reject Fixture");
      if(p) resv.splice(resv.indexOf(p), 1);
      MODE = keepMode; resv = keepR; recompute();
    }
  });

  /* A live session that dies mid-adoption can leave MODE "sample" holding an
     emptied book, and the next save() wrote that over the only copy. */
  await test("save() refuses to overwrite a real book with an empty one", async () => {
    const backup = localStorage.getItem(STORE), keepR = resv.slice();
    try {
      save();
      const storedBefore = JSON.parse(localStorage.getItem(STORE)).rows.length;
      ok(storedBefore > 10, "the fixture store is too small to be meaningful");
      resv = [];                       // what a collapsed live session looks like
      save();
      const after = JSON.parse(localStorage.getItem(STORE)).rows.length;
      eq(after, storedBefore, `the stored book shrank from ${storedBefore} to ${after}`);
      /* And the deliberate path is still open. Asserted through the flag rather
         than by calling clearAll(), because clearAll() empties the REAL book and
         a test that guts the fixture for every test after it is worse than the
         bug it guards — which is what the first version of this did. */
      allowShrink = true;
      try { save(); } finally { allowShrink = false; }
      eq(JSON.parse(localStorage.getItem(STORE)).rows.length, 0,
        "an emptying save was refused even when it was asked for");
      return `${storedBefore} rows survived an accidental empty save; a deliberate one still lands`;
    } finally {
      resv = keepR;
      if(backup != null) localStorage.setItem(STORE, backup);
      load(); recompute();
    }
  });

  /* Signing out — including the silent one a single expired token triggers —
     emptied the pending writes and deleted them from disk. */
  await test("signing out keeps the writes that have not been sent", async () => {
    const keepQ = queue.slice(), keepMode = MODE, keepSess = session, keepHost = hostId;
    try {
      queue = [{k:"stay+", id:"q1", body:{}}, {k:"pay+", id:"q2", body:{}}];
      jset(QUEUE_KEY, queue);
      signOut(true);
      eq(queue.length, 2, "the pending queue was emptied in memory");
      const onDisk = jget(QUEUE_KEY) || [];
      eq(onDisk.length, 2, "the pending queue was deleted from disk");
      return "two pending writes survived a silent sign-out";
    } finally {
      queue = keepQ; jset(QUEUE_KEY, queue);
      MODE = keepMode; session = keepSess; hostId = keepHost;
    }
  });

  /* ══ two phones, one book ═══════════════════════════════════════════════ */

  /* A stay's id was minted at push time, so the same booking seeded into two
     phones got two primary keys and arrived as two rows. The exclusion
     constraint does not save you — it tests OVERLAP, so an identical copy is
     refused as a stranger and an edited copy sails through as a second
     booking. Neither converges. The id is derived from the stay now. */
  await test("the same booking gets the same id on any phone", async () => {
    const r = bookings().find(x => x.guest && !x.openEnd);
    ok(r, "no booking to key");
    const a = stayKey(r);
    /* the same stay, described by a different object — what the other phone has */
    const twin = {...r, sid: undefined, amount: (r.amount || 0) + 5000, note: "edited elsewhere"};
    eq(stayKey(twin), a, "an edited copy of the same stay got a different id");
    /* and things that genuinely ARE different bookings must not collide */
    eq(stayKey({...r, start: r.start + 1}) === a, false, "a different arrival shares the id");
    eq(stayKey({...r, guest: r.guest + " Jr"}) === a, false, "a different guest shares the id");
    const other = flats.findIndex((f,i) => i !== r.fi);
    eq(stayKey({...r, fi: other}) === a, false, "a different flat shares the id");
    /* well-formed enough for a uuid column */
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a),
      `not a valid uuid: ${a}`);
    /* deterministic across calls */
    eq(stayKey(r), a, "the same object keyed twice gave two answers");
    /* no collisions across the whole book */
    const keys = new Set(bookings().map(stayKey));
    eq(keys.size, bookings().length, `${bookings().length - keys.size} bookings collided on one id`);
    return `${keys.size} bookings, ${keys.size} distinct ids, stable under edits`;
  });

  /* Adoption fired only when the server came back completely empty, so a push
     that died halfway could never be finished and a SECOND phone was told
     there was nothing to do and dropped from the shared record. */
  await test("a second phone's bookings are not silently dropped", async () => {
    const keepR = resv.slice(), keepMode = MODE, keepHost = hostId, keepQ = queue.slice();
    try {
      MODE = "live"; hostId = "h1";
      /* the server already holds most of the book … */
      const all = resv.slice();
      const serverHas = all.slice(0, all.length - 3).map(r => ({...r, sid: stayKey(r)}));
      const onlyHere  = all.slice(all.length - 3);
      resv = serverHas;                                   // what a pull leaves behind
      queue = [];
      const missing = reconcile(onlyHere);
      /* … and the three it has never seen are found and kept on screen */
      eq(missing.length, 3, `${missing.length} rows identified as missing, expected 3`);
      eq(resv.length, all.length, "the merge lost or duplicated rows");
      missing.forEach(r => ok(r.sid, "a missing row was not given an id"));
      /* running it again must be a no-op — this is what makes it resumable */
      const second = reconcile(onlyHere);
      eq(second.length, 0, `re-running reconcile queued ${second.length} more rows — it is not idempotent`);
      eq(resv.length, all.length, "a second reconcile duplicated rows");
      return `3 unseen rows adopted, and a re-run is a no-op`;
    } finally {
      resv = keepR; MODE = keepMode; hostId = keepHost; queue = keepQ;
      jset(QUEUE_KEY, queue); recompute();
    }
  });

  /* ══ two staff, one room ════════════════════════════════════════════════ */

  /* The double-booking case an operator actually meets is not two guests — it
     is ONE enquiry entered twice, because the caller rang while a colleague was
     already writing it down. Those must collapse. Two different guests for the
     same nights is a genuine conflict and must not. */
  await test("the same enquiry entered twice collapses; two guests do not", async () => {
    const keepR = resv.slice();
    try {
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 3, 6));
      ok(fi != null, "no room free for the fixture");
      ok(addBooking(fi, 3, 3, "Priya Fixture", "Direct", {amount: 15000}), "fixture refused");
      const a = resv.find(r => r.guest === "Priya Fixture");
      /* the other phone's copy of the same enquiry — same room, nights, guest;
         a different amount typed, because two people rarely agree on that */
      const twin = {...a, sid: undefined, amount: 16000, note: "typed by the other staff"};
      eq(stayKey(twin), stayKey(a), "the same enquiry twice produced two different rows");
      /* a genuinely different guest for the same nights must stay distinct, so
         the exclusion constraint can do its job */
      const rival = {...a, sid: undefined, guest: "Rahul Fixture"};
      ok(stayKey(rival) !== stayKey(a), "two different guests collapsed into one booking");
      return "one enquiry converges, two guests conflict";
    } finally {
      const p = resv.find(r => r.guest === "Priya Fixture");
      if(p) cancelBooking(p);
      resv = keepR; recompute();
    }
  });

  /* Losing the race is not the operator's fault and "conflict" is not an answer
     he can read out — by the time the server says no he has already told
     somebody the room is theirs. */
  await test("losing a room offers the next best one, ranked the way it would be offered", async () => {
    const r = bookings().find(x => x.start > 0 && x.nights <= 3 && !x.openEnd);
    ok(r, "no forward booking to model the loss on");
    const want = flats[r.fi];
    const free = flats.map((f,i)=>i).filter(i => i !== r.fi && freeSpan(i, r.start, r.end));
    ok(free.length, "nothing else is free for those nights, so there is nothing to offer");
    const score = i => (flats[i].code === want.code ? 2 : 0) + (flats[i].type === want.type ? 1 : 0);
    free.sort((x,y)=> score(y) - score(x));
    const best = free[0];
    /* the ranking must prefer the swap a guest does not feel */
    free.forEach(i => ok(score(best) >= score(i), "a worse room outranked the best one"));
    if(free.some(i => score(i) === 3))
      eq(score(best), 3, "a same-building same-size room existed and was not offered first");
    return `${free.length} alternatives, best is ${flats[best].id} (${flats[best].code === want.code ? "same block" : "across town"}, `
         + `${flats[best].type === want.type ? "same size" : flats[best].type})`;
  });

  /* The Supabase dashboard offers only "send recovery email", and that email
     lands here with its token in the URL fragment — which nothing read, so the
     link did nothing and neither person could ever change their password. */
  await test("a recovery link opens a set-a-password screen and swallows its token", async () => {
    const g = document.getElementById("gate");
    const lab1 = document.querySelector('label[for="gateEmail"]');
    const was = {lede: g.querySelector(".lede").textContent, lab: lab1.textContent,
                 type: document.getElementById("gateEmail").type,
                 go: document.getElementById("gateGo").textContent,
                 skip: document.getElementById("gateSkip").hidden,
                 onsubmit: document.getElementById("gateForm").onsubmit};
    const href = location.href;
    try {
      /* the shape Supabase actually sends */
      history.replaceState(null, "", location.pathname + "#access_token=T_FIXTURE&type=recovery");
      const tok = recoveryToken("#access_token=T_FIXTURE&refresh_token=r&type=recovery");
      eq(tok, "T_FIXTURE", "the token was not read out of the fragment");
      /* and it must not survive in the address bar — a recovery link in history
         is a live credential */
      ok(location.href.indexOf("T_FIXTURE") < 0, "the token is still in the URL");
      /* a fragment without type=recovery is somebody deep-linking, not resetting */
      ok(!recoveryToken("#rooms"), "a plain deep link was read as a recovery token");
      ok(!recoveryToken("#access_token=X"), "a token with no type=recovery was accepted");

      openReset(tok);
      eq(document.getElementById("gateEmail").type, "password", "the first field is not a password field");
      eq(lab1.textContent, "New password", "the first field is still labelled Email");
      ok(document.getElementById("gateSkip").hidden, "'browse' is still offered mid-reset");
      ok(/password/i.test(document.getElementById("gateGo").textContent), "the button still says Sign in");

      /* the two guards that do not need a server */
      const err = document.getElementById("gateErr"), form = document.getElementById("gateForm");
      const fire = ()=> form.dispatchEvent(new Event("submit", {bubbles:true, cancelable:true}));
      document.getElementById("gateEmail").value = "abcde";
      document.getElementById("gatePass").value  = "abcde";
      fire(); await wait(60);
      ok(/6 characters/.test(err.textContent), `a 5-character password was accepted: "${err.textContent}"`);
      /* and the boundary itself must pass the length gate — a rule that also
         rejects the shortest legal password is the same bug in the other
         direction, and it would only surface on a live token */
      document.getElementById("gateEmail").value = "abcdef";
      document.getElementById("gatePass").value  = "zzzzzz";
      fire(); await wait(60);
      ok(!/characters/.test(err.textContent), `6 characters was rejected on length: "${err.textContent}"`);
      document.getElementById("gateEmail").value = "longenough1";
      document.getElementById("gatePass").value  = "different11";
      fire(); await wait(60);
      ok(/do not match/.test(err.textContent), `mismatch accepted: "${err.textContent}"`);
      return "token read once, stripped, and the form guards both hold";
    } finally {
      /* put the gate back the way an ordinary sign-in needs it */
      g.querySelector(".lede").textContent = was.lede;
      lab1.textContent = was.lab;
      const e2 = document.getElementById("gateEmail");
      e2.type = was.type; e2.value = ""; e2.setAttribute("autocomplete","username");
      document.getElementById("gatePass").value = "";
      document.getElementById("gateGo").textContent = was.go;
      document.getElementById("gateGo").disabled = false;
      document.getElementById("gateSkip").hidden = was.skip;
      document.getElementById("gateForm").onsubmit = was.onsubmit;
      document.getElementById("gateErr").textContent = "";
      g.classList.remove("on");
      history.replaceState(null, "", href);
    }
  });

  /* ══ changing a stay ════════════════════════════════════════════════════ */

  /* The operators' own report: a guest books five nights, is in the flat, and
     wants two more — and nothing on the room sheet could do it. Move refused
     an in-house guest and the ✕ would have cost the row its payments. */
  await test("a guest who is in the flat can be kept longer, and the dates change is recorded", async () => {
    const keep = activity.slice(), stored = localStorage.getItem(STORE);
    try {
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, -2, 8));
      ok(fi != null, "no flat free for the fixture");
      resv.push({fi, start:-2, end:2, nights:4, guest:"Extend Fixture", src:"Direct",
                 manual:true, amount:8000, pays:[], bookedOn:-3});
      recompute();
      const r = resv.find(x => x.guest === "Extend Fixture");
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .rowdt"), "the guest's row");
      /* THROUGH THE ROW, which is the way in. There used to be a "Change X's
         dates" route on the band as well, and it sat directly above a Coming
         up row naming the same guest, the same dates, and carrying the glyph
         that opens the same editor — the owner counted the guest's name four
         times on one screen and asked for the duplicates to go. The row is
         what remains, so the row is what this drives. */
      const glyph = [...document.querySelectorAll(".sheet.on .rowdt")]
        .find(b => /Extend Fixture/.test(b.getAttribute("aria-label") || ""));
      ok(glyph, "the guest's own row has no dates glyph");
      ok(![...document.querySelectorAll(".sheet.on .roomRoutes.stay button")]
        .some(b => /Change Extend Fixture/.test(b.textContent)),
        "the band still repeats a guest who is already a row");
      /* and the band does not name them a third time either */
      const band = document.querySelector(".sheet.on .actWhy");
      ok(!band || !/Extend Fixture/.test(band.textContent),
        `the band repeats the guest: ${band && band.textContent}`);
      glyph.click();
      await until(() => document.querySelector(".stepWide.locked"), "the editor, with the arrival locked");
      const go = document.querySelector(".bkgo");
      ok(go.disabled, "Save is live before anything has changed");
      ok(/Nothing changed/.test(go.textContent), `resting label: ${go.textContent}`);
      const more = document.querySelector('.step button[aria-label="A night more"]');
      more.click(); more.click();
      eq(document.querySelector(".step b").textContent, "6", "nights after two taps");
      eq(r.end, 2, "the row changed before Save was tapped");
      ok(/Keep Extend Fixture until/.test(go.textContent), `Save says "${go.textContent}"`);
      ok(/2 nights more/.test(document.querySelector(".bkstate").textContent),
        `the state line: ${document.querySelector(".bkstate").textContent}`);
      /* two more nights on the deal's own terms — ₹8,000 for four is ₹2,000 a
         night, so ₹12,000 is offered, not the flat's rack rate */
      eq(document.querySelector(".bkamt input").value, "12000", "the total offered for two more nights");
      /* and what that total means for the money: nothing taken yet, so all of it is due */
      const ms = [...document.querySelectorAll(".bkstate")].pop();
      ok(/₹12,000 due · nothing paid yet/.test(ms.textContent), `the money line: ${ms.textContent}`);
      /* a payment on the stay is never touched by a change to the total */
      addPayment(r, 5000, "UPI");
      document.querySelector(".bkamt input").dispatchEvent(new Event("input"));
      ok(/₹5,000 paid · ₹7,000 still due/.test(ms.textContent), `the money line after a payment: ${ms.textContent}`);
      go.click();
      await until(() => !document.querySelector(".bkgo"), "the editor to close");
      eq(r.end, 4, "the new end");
      eq(r.nights, 6, "the new nights");
      eq(r.amount, 12000, "the new total");
      eq(paidOn(r), 5000, "the payment survived the change");
      eq(dueFrom(r), 7000, "what is owed after the change");
      eq(occ[fi][3], 1, "the third night is not held after the extension");
      const a = activity[0];
      eq(a.k, "dates", "the newest activity kind");
      ok(/now leaves .* not .*2 nights more/.test(a.s), `the line: ${a.s}`);
      eq(a.g, "Extend Fixture", "the guest on the entry");
      /* THE ROW SAYS THE NEW END. This read the night count, which an
         in-the-flat row no longer prints — the card at the top of the sheet
         says "night 2 of 6" and printing 6 again here was the third telling.
         The end DATE is what actually moved, and it is the better assertion
         anyway: a night count can be right while the dates are wrong. */
      const row = [...document.querySelectorAll(".sheet .row.bk .meta")]
        .find(m => /Extend Fixture/.test(m.textContent));
      ok(row, "the extended guest is not on the sheet");
      ok(row.textContent.includes(fmt(r.end)),
        `the sheet row does not show the new end ${fmt(r.end)}: ${row.textContent}`);
      const btn = undoButton();
      ok(btn, "no Undo on the toast");
      btn.click();
      await wait(60);
      eq(r.end, 2, "end after undo");
      eq(r.amount, 8000, "total after undo");
      return "route + glyph, +2 nights, ₹12,000 offered, logged, undone";
    } finally {
      const r = resv.find(x => x.guest === "Extend Fixture");
      if (r) resv.splice(resv.indexOf(r), 1);
      recompute();
      /* the STORED book as well as the one in memory: changeStay saved the
         fixture, and the harness restores memory only, so a run left a
         fixture in localStorage that the next run then found first */
      if (stored != null) localStorage.setItem(STORE, stored);
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* "While booking we need a small option to mark it as paid, so that I don't
     have to follow up; some customers pay partial while booking." Driven
     through the real form: one box, its "all" tag, its method tag, the caption
     that says what is left, the button that says what it will record — and the
     row that comes out of it, which must carry the money as a payment. */
  await test("a booking can be taken as paid, in full or in part, and a platform booking asks nothing", async () => {
    const stored = localStorage.getItem(STORE), keep = activity.slice();
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, 0, 14));
    ok(fi != null, "no flat free for the fixtures");
    const q = sel => document.querySelector(".sheet.on " + sel);
    const tag = label => [...document.querySelectorAll(".sheet.on .recTools button")].find(b => b.textContent === label);
    const cap = () => q(".bkcap.tail span:last-child").textContent;
    const type = (input, v) => { input.value = v; input.dispatchEvent(new Event("input", {bubbles:true})); };
    const open = async (day, n) => { openBooking(fi, day, n); await until(() => q(".bkgo"), "the booking form"); };
    const book = async name => { type(q('input[aria-label^="Guest name"]'), name); q(".bkgo").click();
      await until(() => !q(".bkgo"), "the form to close"); return resv.find(x => x.guest === name); };
    try {
      /* paid in full, by the tag */
      await open(1, 2);
      const rec = () => q('input[aria-label="Amount received now"]');
      ok(rec(), "no box for the money received");
      eq(rec().value, "", "the box is not empty to begin with");
      type(q('input[aria-label="Total agreed for the stay"]'), "12000");
      eq(cap(), "₹12,000 due on arrival", "the caption with nothing received");
      ok(tag("all") && !tag("all").hidden, "no all tag while the box is short of the total");
      eq(tag("UPI") && tag("UPI").textContent, "UPI", "the assumed method");
      tag("all").click();
      eq(rec().value, "12000", "the all tag did not fill the box");
      ok(tag("all").hidden, "the all tag stays once the box holds the total");
      eq(cap(), "settled", "the caption for a stay paid in full");
      eq(q(".bkgo").textContent, "Book 2 nights · ₹12,000 paid", "the button says what it records");
      const full = await book("Paid Fixture");
      ok(full, "the booking was not taken");
      eq(full.amount, 12000, "the total on the row");
      eq(paidOn(full), 12000, "the money on the row");
      eq(full.pays[0].method, "UPI", "the method on the payment");
      eq(dueFrom(full), 0, "still due on a stay paid in full");
      ok(activity.some(a => a.k === "paid" && /Paid Fixture/.test(a.s) && /12,000/.test(a.s)), "the payment is not in the log");
      /* paid in part, in cash, by typing */
      await open(4, 2);
      type(q('input[aria-label="Total agreed for the stay"]'), "10000");
      type(rec(), "4000");
      eq(cap(), "₹6,000 still due", "the caption for a part payment");
      tag("UPI").click();
      ok(tag("Cash"), `one tap from UPI did not reach Cash: ${[...document.querySelectorAll(".sheet.on .recTools button")].map(b => b.textContent)}`);
      eq(q(".bkgo").textContent, "Book 2 nights · ₹4,000 paid", "the button for a part payment");
      const partR = await book("Part Fixture");
      ok(partR, "the part-paid booking was not taken");
      eq(paidOn(partR), 4000, "the money on the part-paid row");
      eq(partR.pays[0].method, "Cash", "the method on the part payment");
      eq(dueFrom(partR), 6000, "still due after a part payment");
      /* nothing: a box emptied again records nothing */
      await open(7, 1);
      type(q('input[aria-label="Total agreed for the stay"]'), "5000");
      type(rec(), "1000");
      type(rec(), "");
      eq(cap(), "₹5,000 due on arrival", "the caption after the box is emptied");
      eq(q(".bkgo").textContent, "Book 1 night", "the button when nothing is taken");
      const owing = await book("Owing Fixture");
      eq((owing.pays || []).length, 0, "payments on a stay taken as unpaid");
      eq(dueFrom(owing), 5000, "due on a stay taken as unpaid");
      /* a platform booking: no box, a line, and the platform payment as before */
      await open(9, 1);
      type(q('input[aria-label="Total agreed for the stay"]'), "7000");
      tag("all").click();
      [...document.querySelectorAll(".sheet.on .srcRow button")].find(b => b.textContent === "Airbnb").click();
      ok(q(".bkamt.recv").hidden, "the box is still asked of a platform booking");
      ok(/₹7,000 paid to Airbnb/.test(q(".bkstate:last-of-type").textContent), `the platform line: ${q(".bkstate:last-of-type").textContent}`);
      eq(q(".bkgo").textContent, "Book 1 night", "the button claims a payment on a platform booking");
      const plat = await book("Plat Fixture");
      eq(withPlatform(plat), 7000, "the platform payment");
      eq(plat.pays.length, 1, "payments on a platform booking taken with the box full");
      return "all · UPI, ₹4,000 typed · Cash with ₹6,000 due, emptied · nothing, Airbnb untouched";
    } finally {
      closeSheet();
      ["Paid Fixture","Part Fixture","Owing Fixture","Plat Fixture"].forEach(g => {
        const r = resv.find(x => x.guest === g); if (r) resv.splice(resv.indexOf(r), 1); });
      recompute();
      if (stored != null) localStorage.setItem(STORE, stored);
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  await test("the dates editor stops at the next guest and refuses an arrival that lands on one", async () => {
    const stored = localStorage.getItem(STORE);
    try {
    const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 12));
    ok(fi != null, "no flat with twelve free nights");
    ok(addBooking(fi, 2, 3, "Edit Fixture", "Direct", {quiet:1}), "fixture refused");   // 2 → 5
    const r = resv[resv.length - 1];                   // the row just added, not a namesake
    ok(addBooking(fi, 7, 2, "Wall Fixture", "Direct", {quiet:1}), "wall refused");      // 7 → 9
    eq(r.guest, "Edit Fixture", "the fixture row");
    openStayDates(r, ()=>{});
    await until(() => document.querySelector(".bkgo"), "the editor");
    ok(!document.querySelector(".stepWide.locked"), "a future arrival is locked");
    ok(document.querySelector(".roomRoutes.stay button"), "no move route for a guest not yet in");
    const more = document.querySelector('.step button[aria-label="A night more"]');
    more.click(); more.click();                        // five nights → ends on 7, the wall
    eq(document.querySelector(".step b").textContent, "5", "nights at the wall");
    ok(more.disabled, "+ is still live at the wall");
    ok(/the night after is taken/.test(document.querySelector(".bkstate").textContent),
      `the state does not name the wall: ${document.querySelector(".bkstate").textContent}`);
    const later = document.querySelector('.stepWide button[aria-label="A day later"]');
    later.click(); later.click(); later.click();       // 5 → 10, straight over the wall
    const st = document.querySelector(".bkstate");
    ok(st.classList.contains("bad"), "a collision is not marked bad");
    ok(/Wall Fixture holds/.test(st.textContent), `the state does not say who holds it: ${st.textContent}`);
    ok(document.querySelector(".bkgo").disabled, "Save is live on a collision");
    eq(changeStay(r, 5, 5), false, "changeStay accepted an overlap");
    eq(r.start, 2, "start after the refusal");
    eq(r.end, 5, "end after the refusal");
    const earlier = document.querySelector('.stepWide button[aria-label="A day earlier"]');
    earlier.click(); earlier.click(); earlier.click(); earlier.click();   // → arrives 1, five nights → 6
    ok(!document.querySelector(".bkgo").disabled, "Save is dead on a change that fits");
    document.querySelector(".bkgo").click();
    await wait(60);
    eq(r.start, 1, "the new arrival");
    eq(r.end, 6, "the new end");
    eq(occ[fi][1], 1, "the new first night is not held");
    eq(occ[fi][6], 0, "night 6 is held by nobody but shows taken");
    document.querySelectorAll(".toast").forEach(x => x.remove());   // the Undo toast, not left for a later test
    return "capped at the wall, collision named, then 1 → 6 saved";
    } finally {
      if (stored != null) localStorage.setItem(STORE, stored);
    }
  });

  /* The exclusion constraint is the authority, and it fires on an UPDATE as
     readily as an INSERT. The phone has already applied the change by the time
     the server says no; what it must not do is keep the refused dates until
     the next pull, or offer to "put them in" another flat — that is a second
     copy of a guest who is already in the book. */
  await test("a dates change the server refuses puts the old dates back and says what stands", async () => {
    const keep = activity.slice(), stored = localStorage.getItem(STORE);
    document.querySelectorAll(".toast").forEach(x => x.remove());
    try {
      const fi = flats.map((f,i)=>i).find(i => freeSpan(i, 0, 8));
      ok(fi != null, "no flat free for the fixture");
      ok(addBooking(fi, 1, 3, "Race Fixture", "Direct", {quiet:1}), "fixture refused");   // 1 → 4
      const r = resv[resv.length - 1];                 // the row just added, not a namesake
      eq(r.fi, fi, "the fixture is not in the flat it was booked into");
      r.sid = "race-fixture-sid";
      r.end = 6; r.nights = 5; recompute();                  // the phone already extended it
      const op = {k:"stay~", id:r.sid, body:{ends_on: dayISO(6)},
                  was:{starts_on: dayISO(1), ends_on: dayISO(4), amount:null}};
      await lostTheChange(op);
      eq(r.end, 4, "end after the refusal");
      eq(r.nights, 3, "nights after the refusal");
      eq(occ[fi][5], 0, "night 5 is still held after the refusal");
      const t = [...document.querySelectorAll(".toast")].find(x => /not free for those nights/.test(x.textContent));
      ok(t, "no refusal toast");
      /* the flat in the headline is the guest's own — a uid lookup with no uid
         to look up named G01 for a stay in another building */
      ok(t.textContent.startsWith(flats[fi].id + " is not free"),
        `the toast names the wrong flat: ${t.textContent.slice(0, 40)}`);
      ok(/Race Fixture still leaves/.test(t.textContent), `the toast does not say what stands: ${t.textContent}`);
      ok(!/Put them in/.test(t.textContent), "the toast offers a second copy of the guest");
      eq(activity[0].k, "refused", "the refusal is not logged");
      ok(/Could not change Race Fixture/.test(activity[0].s), `the line: ${activity[0].s}`);
      t.remove();                       // not left for a later test to find
      return "old dates back, night 5 free again, toast says what stands";
    } finally {
      if (stored != null) localStorage.setItem(STORE, stored);
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
      document.querySelectorAll(".toast").forEach(x => x.remove());
    }
  });

  /* The operators' second report: the cards led with the free count and
     carried the date small, and a guest names a date, not a count. */
  await test("the night cards and the month grid lead with the date, not the count", async () => {
    const fs = e => parseFloat(getComputedStyle(e).fontSize);
    switchTo(SCREENS.findIndex(s => s.id === "rooms"));
    await until(() => document.querySelector(".night .d em"), "the night cards");
    const em = document.querySelector(".night .d em"), n = document.querySelector(".night .n");
    const emPx = fs(em), nPx = fs(n);            // read now — switching screens rebuilds these nodes
    ok(emPx >= 2 * nPx, `night card: date ${emPx}px against count ${nPx}px`);
    ok(/free|full/.test(n.textContent), `the count carries no unit: "${n.textContent}"`);
    const dLab = document.querySelector(".night .d");
    ok(dLab.firstElementChild === em, "the date is not the first thing on the card");
    switchTo(SCREENS.findIndex(s => s.id === "month"));
    await until(() => document.querySelector(".cal .day[data-d] .dd"), "the month grid");
    const dd = document.querySelector(".cal .day[data-d] .dd"), fn = document.querySelector(".cal .day[data-d] .fn");
    const ddPx = fs(dd), fnPx = fs(fn);
    ok(ddPx >= 1.5 * fnPx, `month cell: date ${ddPx}px against count ${fnPx}px`);
    const tag = document.querySelector(".day.mstart .dd i");
    ok(tag && /^[A-Z][a-z]{2}$/.test(tag.textContent), "the 1st does not carry its month");
    /* the tag fits its cell and does not run into the number beside it */
    const cell = tag.closest(".day").getBoundingClientRect(), tb = tag.getBoundingClientRect();
    ok(tb.right <= cell.right + 0.5 && tb.left >= cell.left - 0.5, "the month tag runs outside its cell");
    const rg = document.createRange(); rg.selectNodeContents(tag.parentElement.firstChild);
    const nb = rg.getBoundingClientRect();
    ok(nb.right <= tb.left + 0.5, `the month tag overlaps the date (number ends ${nb.right.toFixed(1)}, tag starts ${tb.left.toFixed(1)})`);
    switchTo(SCREENS.findIndex(s => s.id === "rooms"));
    return `night ${emPx}/${nPx}px · month ${ddPx}/${fnPx}px · "1 ${tag.textContent}" fits`;
  });

  /* ══ the Month building filter ══════════════════════════════════════════ */

  /* "Give me an option to filter the location so that I don't have to scroll
     to see what rooms are available." Forty-one free flats ordered by flat id
     is four screens, and every TreeTops row comes before the first Madhapur
     one. */
  await test("the Month list can be narrowed to one building, and the filter survives picking dates", async () => {
    const keep = {a: sel.a, n: sel.n, code: monthCode};
    try {
      monthCode = null; sel = {a: 0, n: 1}; pendingStart = null;
      switchTo(SCREENS.findIndex(s => s.id === "month"));
      await until(() => document.querySelector(".monthfilt button"), "the filter row");
      const chips = () => [...document.querySelectorAll(".monthfilt button")];
      eq(chips()[0].textContent.replace(/\d+$/, ""), "All", "the first chip");
      /* the chip counts are the answer per building, and they add up to the
         answer for the portfolio — a filter whose counts did not reconcile
         with the headline would be a second opinion, not a filter */
      const all = +chips()[0].querySelector("i").textContent;
      const parts = chips().slice(1).reduce((s2, c) => s2 + +c.querySelector("i").textContent, 0);
      eq(parts, all, "the building counts do not add up to the All count");
      eq(all, document.querySelectorAll(".freelist .row").length, "rows shown against the All count");

      /* pick the building with the most free, so the assertion is not about an
         empty list by accident */
      const pick = chips().slice(1).reduce((b, c) =>
        +c.querySelector("i").textContent > +b.querySelector("i").textContent ? c : b);
      const want = +pick.querySelector("i").textContent;
      const name = pick.querySelector("span").textContent;
      pick.click();
      await wait(60);
      const rows = [...document.querySelectorAll(".freelist .row")];
      eq(rows.length, want, `rows shown for ${name}`);
      ok(rows.every(r => r.textContent.includes(name)), `a row from another building is still listed`);
      /* the All chip stays the whole portfolio's answer whatever is picked —
         it is the count line now, and a count that moved with the filter
         would leave "3" with nothing on screen saying three of what */
      eq(chips()[0].querySelector("i").textContent, String(all),
        "the All chip followed the filter instead of staying the portfolio's answer");

      /* THE FILTER MUST SURVIVE THE DATES. renderMonth rebuilds on every tap of
         a date, so a filter held inside it would reset the moment the operator
         picked the nights they wanted it for. */
      const cells = [...document.querySelectorAll(".cal .day[data-d]")];
      cells[4].click(); await wait(50);
      cells[7].click(); await wait(120);
      eq(sel.n, 3, "the range that was picked");
      const still = [...document.querySelectorAll(".monthfilt button")]
        .find(c => c.getAttribute("aria-selected") === "true");
      ok(still && still.querySelector("span").textContent === name,
        "the building filter was lost when the dates changed");

      /* and it is a way of LOOKING, not a setting: leaving the tab clears it */
      switchTo(SCREENS.findIndex(s => s.id === "rooms"));
      await wait(40);
      switchTo(SCREENS.findIndex(s => s.id === "month"));
      await wait(80);
      eq(monthCode, null, "the filter outlived the tab");
      return `${all} free = ${parts} across ${chips().length - 1} chips · ${name} kept across a date change`;
    } finally {
      monthCode = keep.code; sel = {a: keep.a, n: keep.n}; pendingStart = null;
    }
  });

  /* ══ the Money tab ══════════════════════════════════════════════════════ */

  /* A figure abbreviated for a tile must still be the figure. */
  await test("a shortened amount never rounds into a different number", async () => {
    eq(moneyShort(198500), "₹1.99L", "lakhs keep two decimals below ten");
    eq(moneyShort(3436582), "₹34.4L", "tens of lakhs keep one");
    eq(moneyShort(41238982), "₹4.12Cr", "crores keep two below ten");
    eq(moneyShort(57750), "₹57.8k", "tens of thousands");
    eq(moneyShort(9800), "₹9,800", "under ten thousand is written out in full");
    eq(moneyShort(0), "₹0", "nothing");
    /* the bug this guards: one decimal turned 1.985 into 2.0, JavaScript threw
       away the trailing zero, and ₹1,98,500 was shown as a flat "₹2L" */
    ok(!/^₹2L$/.test(moneyShort(198500)), "₹1,98,500 is being shown as ₹2L");
    return "1.99L / 34.4L / 4.12Cr / 57.8k, none rounded into another figure";
  });

  /* The running month leads with money that was actually taken, because that
     is the one money figure in the app that is a count and not a sample. */
  await test("the month's money in hand counts payments dated in that month, and only those", async () => {
    const cur = dayISO(0).slice(0, 7);
    /* addBooking and addPayment both save(). The harness restores `resv` in
       memory and not the store, so without this the fixture survives into
       localStorage and the next load() brings it back. */
    const stored = localStorage.getItem(STORE);
    const before = cashMonth(cur);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, 0, 2));
    ok(fi != null, "no flat free for the fixture");
    ok(addBooking(fi, 0, 1, "Cash Fixture", "Direct", {amount: 9000, quiet: 1}), "fixture refused");
    const r = resv[resv.length - 1];
    addPayment(r, 4000, "UPI");                       // dated today, so inside this month
    const after = cashMonth(cur);
    eq(after.inHand - before.inHand, 4000, "a payment taken today did not land in this month");
    eq(after.n - before.n, 1, "the payment count");
    eq(after.by.UPI - (before.by.UPI || 0), 4000, "the payment did not land under its method");
    /* a payment dated outside the month is not this month's money, however
       recently it was typed */
    r.pays[r.pays.length - 1].on = after.d0 - 1;
    const moved = cashMonth(cur);
    eq(moved.inHand, before.inHand, "a payment dated before the month is still counted in it");
    /* platform money is the guest's payment, not the operator's — kept apart
       for the same reason the owed card keeps it apart */
    r.pays[r.pays.length - 1].on = 0;
    r.pays[r.pays.length - 1].method = "Platform";
    const plat = cashMonth(cur);
    eq(plat.inHand, before.inHand, "platform money was counted as in hand");
    eq(plat.platform - before.platform, 4000, "platform money was not counted at all");
    resv.splice(resv.indexOf(r), 1); recompute();
    if (stored != null) localStorage.setItem(STORE, stored);
    return "₹4,000 in, dated out again, then counted as a platform payout";
  });

  /* The run rate is an average, and an average is where a bad month hides. */
  await test("the run rate leaves out the running month and any month too thin to price", async () => {
    const cur = dayISO(0).slice(0, 7);
    const W = moneyRun(24);
    ok(W.all.length, "no months at all");
    ok(!W.all.some(m => m.key >= cur), "the running month is in the series");
    ok(W.counted.every(m => m.firm), "a thin month is inside the average");
    /* the average is the counted months and nothing else */
    const byHand = W.counted.reduce((a, m) => a + m.revenue, 0) / W.counted.length;
    ok(Math.abs(W.avg - byHand) < 1, `the average does not match its own months: ${W.avg} vs ${byHand}`);
    eq(W.thin, W.win.length - W.counted.length, "the hatched count");
    /* a shorter window is a subset of a longer one, ending at the same month */
    const S = moneyRun(6);
    ok(S.win.length <= 6, `the 6-month window holds ${S.win.length} months`);
    eq(S.win[S.win.length - 1].key, W.win[W.win.length - 1].key, "the windows end on different months");
    return `${W.win.length} months drawn, ${W.counted.length} averaged, ${W.thin} hatched`;
  });

  /* The whole complaint about this card: four true figures and no way to find
     out who they were. */
  await test("every owed figure opens onto the people behind it", async () => {
    const stored = localStorage.getItem(STORE);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, 1, 4));
    ok(fi != null, "no flat free for the fixture");
    ok(addBooking(fi, 1, 2, "Owed Fixture", "Direct",
                  {amount: 12000, phone: "9876500011", quiet: 1}), "fixture refused");
    const r = resv[resv.length - 1];
    try {
      const O = owedStats();
      /* the buckets partition the rows, not just the rupees */
      const bucketed = ["gone", "here", "soon", "later"]
        .reduce((a, k) => a + O.byBucket[k].length, 0);
      eq(bucketed, O.all.length, "the buckets do not partition the bookings");
      ok(O.byBucket.soon.indexOf(r) >= 0, "a guest arriving tomorrow is not in the week's bucket");

      openOwed("all");
      await until(() => document.querySelector(".sheet .moneylist .row"), "the owed sheet");
      const rows = [...document.querySelectorAll(".sheet .moneylist .row")];
      eq(rows.length, O.all.length, "rows against bookings owing");
      const mine = rows.find(x => /Owed Fixture/.test(x.textContent));
      ok(mine, "the fixture is not listed");
      ok(/arrives/.test(mine.textContent), `the row does not say when: ${mine.textContent}`);
      ok(mine.textContent.includes(money(12000)), "the row does not carry what is due");
      ok(mine.querySelector('a[href^="tel:"]'), "a booking with a number has no way to ring it");
      /* biggest first — that is the order they get rung */
      const dues = rows.map(x => +x.querySelector(".paid").textContent.replace(/[^\d]/g, ""));
      ok(dues.every((v, i) => i === 0 || dues[i - 1] >= v), `not sorted by what is owed: ${dues}`);
      /* and the chips move between buckets without leaving the sheet */
      const chip = [...document.querySelectorAll(".sheet .roomfilt button")]
        .find(c => /This week/.test(c.textContent));
      ok(chip, "no bucket chips");
      chip.click();
      await wait(80);
      const only = [...document.querySelectorAll(".sheet .moneylist .row")];
      eq(only.length, O.byBucket.soon.length, "rows after switching to this week");
      /* the amount due is the control that records a payment against it */
      const pay = only[0].querySelector("button.paid");
      ok(pay, "the amount owed is not a way to record a payment");
      pay.click();
      await until(() => document.querySelector(".sheet .bkgo"), "the payment form");
      ok(/due/.test(document.querySelector(".sheet .n").textContent), "the payment form did not open on the balance");
      return `${O.all.length} owing, bucketed and sorted, each one a call and a payment`;
    } finally {
      closeSheet();
      const still = resv.indexOf(r);
      if (still >= 0) resv.splice(still, 1);
      recompute();
      if (stored != null) localStorage.setItem(STORE, stored);
    }
  });

  /* The card the operators said made no sense to them is gone, and nothing
     that referred to it is left pointing at a hole. */
  await test("the Money tab leads with the month and says nothing about a card it no longer has", async () => {
    const was = pulseSeg;
    try {
      pulseSeg = "money";
      switchTo(SCREENS.findIndex(s => s.id === "trends"));
      await until(() => document.querySelector("#scr-trends .tcard h3"), "the Money cards");
      const titles = [...document.querySelectorAll("#scr-trends .tcard h3")].map(h => h.textContent);
      ok(!titles.includes("What a night is worth"), "the rate card is still on the Money tab");
      const cur = dayISO(0).slice(0, 7);
      /* OWED LEADS. It is the only card here anybody can act on this
         afternoon; the run rate is a month-end question and the month's
         ledger is a summary. */
      eq(titles[0], "What you are owed", `the tab leads with "${titles[0]}"`);
      eq(titles[1], MON[+cur.split("-")[1] - 1] + " " + cur.split("-")[0],
        `the running month is not second: "${titles[1]}"`);
      ok(titles.includes("What a month brings in"), "no run-rate card");
      const foot = document.querySelector("#scr-trends").textContent;
      ok(!/rate at the top/.test(foot), "the footer still describes the card that was removed");
      /* and it is said ONCE. The month card used to carry an owed tile as
         well, directly under the card that states it in full. */
      const monthCard = [...document.querySelectorAll("#scr-trends .tcard")]
        .find(c => c.querySelector("h3").textContent === titles[1]);
      const tiles = [...monthCard.querySelectorAll(".opp")];
      eq(tiles.length, 3, "tiles on the month card");
      ok(!tiles.some(t => /owed/.test(t.textContent)), "the month card repeats what is owed");
      ok(tiles.every(t => t.tagName === "BUTTON"), "a tile is not a control");
      eq(tiles.map(t => t.querySelector("s").textContent.split(" ·")[0]).join(","), "taken,spent,nights",
        "the month's three facts");
      /* nothing runs off a 375px phone */
      const wide = [...document.querySelectorAll("#scr-trends .deck *")]
        .filter(e => { const b = e.getBoundingClientRect(); return b.width && b.right > window.innerWidth + 0.5; });
      eq(wide.length, 0, `${wide.length} elements overflow the screen: ${wide.slice(0,3).map(e=>e.className)}`);
      return `${titles.length} cards, leading with ${titles[0]}, three tiles, nothing overflowing`;
    } finally { pulseSeg = was; }
  });

  /* ── every screen and sheet, measured for panels that touch or overlap ────
     Panels stacked on a shared edge read as one panel broken; a panel whose
     content runs past its own bottom reads as an overlap. The owner circled
     both on Money, then a band on Month, and asked for every screen to be
     checked the same way. So this walks the four screens, the six Business
     segments, Month at rest, pinned and with a range, and every sheet that
     opens without a server — and measures rather than looks. */
  await test("no two panels share an edge or overlap on any screen or sheet, and nothing spills out of its panel", async () => {
    const PANELS = ".card, .tcard, .answerbar, .night, .tile, .opp, .costsbtn, .ops-row, .seg, .bigAct, "
      + ".roomRoutes button, .actWhy, .stepWide, .step, .bkamt, .bkgo, .strip-call, .blocked, .paid, .rowx, .pill";
    /* a descendant inside a scroller between it and the panel is clipped by
       that scroller — the calendar grid inside its trough is the obvious one */
    const clipped = (e, top) => {
      for (let p = e.parentElement; p && p !== top; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(cs.overflowY + " " + cs.overflowX)) return true;
      }
      return false;
    };
    const short = e => (e.className || e.tagName || "").toString().trim().slice(0, 20);
    const scan = (root, label) => {
      const bad = [];
      const boxes = [...root.querySelectorAll(PANELS)].filter(e => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      const stuck = root.querySelector(".answerbar.stuck");
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a2 = boxes[i], b2 = boxes[j];
        if (a2.contains(b2) || b2.contains(a2)) continue;
        if (stuck && (a2 === stuck || b2 === stuck)) continue;   // what scrolled under the pinned bar is under it by design
        const ra = a2.getBoundingClientRect(), rb = b2.getBoundingClientRect();
        const across = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        if (across <= 4) continue;                                   // side by side: not this test's business
        const vov = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        const touch = Math.abs(rb.top - ra.bottom) < 2 || Math.abs(ra.top - rb.bottom) < 2;
        if (vov > 1) bad.push(`${label}: ${short(a2)} overlaps ${short(b2)} by ${vov.toFixed(1)}px`);
        else if (touch) bad.push(`${label}: ${short(a2)} touches ${short(b2)}`);
      }
      root.querySelectorAll(".card, .tcard").forEach(c => {
        const rc = c.getBoundingClientRect();
        if (!rc.height) return;
        c.querySelectorAll("*").forEach(e => {
          const r = e.getBoundingClientRect();
          if (!r.height || clipped(e, c)) return;
          const over = Math.max(r.bottom - rc.bottom, r.right - rc.right);
          if (over > 1) bad.push(`${label}: ${short(e)} spills its card by ${over.toFixed(1)}px`);
        });
      });
      return bad;
    };

    const steps = [];
    const at = (label, prep) => steps.push([label, prep]);
    const go = id => switchTo(SCREENS.findIndex(x => x.id === id));
    const scr = id => document.getElementById("scr-" + id);
    at("rooms", async () => { go("rooms"); await until(() => scr("rooms").querySelector(".tile"), "rooms"); return scr("rooms"); });
    at("month", async () => { calLean = false; pendingStart = null; sel = {a: 0, n: 1}; monthCode = null; go("month");
      await until(() => scr("month").querySelector(".freelist .row, .freelist .empty"), "month"); return scr("month"); });
    at("month · pinned", async () => { const m = scr("month"); m.scrollTop = 600; stuckMark && stuckMark(); return m; });
    at("month · a range", async () => { pendingStart = null; sel = {a: 9, n: 4}; calLean = true; renderMonth();
      await until(() => scr("month").querySelector(".day.rngA"), "the band"); return scr("month"); });
    at("ask", async () => { go("ask"); askText = "3 nights"; renderAsk(); await wait(120); return scr("ask"); });
    ["now", "money", "profit", "rooms", "guests", "upkeep"].forEach(seg => at("business · " + seg, async () => {
      pulseSeg = seg; go("trends");
      await until(() => scr("trends").querySelector(".tcard, .empty"), seg);
      scr("trends").classList.add("seen"); return scr("trends"); }));
    const sheetOf = (label, open, ready) => at("sheet · " + label, async () => {
      open();
      await until(() => document.querySelector(".sheet.on") && (!ready || ready()), label);
      return document.querySelector(".sheet");
    });
    const inHouse = bookings().find(r => r.start <= 0 && r.end > 1 && !r.openEnd);
    const freeFi = flats.map((f, i) => i).find(i => freeSpan(i, 0, 3));
    const owing = bookings().find(r => dueFrom(r) > 0);
    const future = bookings().find(r => r.start > 0 && r.end < DAYS && !r.openEnd);
    const cur = dayISO(0).slice(0, 7);
    sheetOf("room", () => openSheet(inHouse ? inHouse.fi : 0, 0), () => document.querySelector(".sheet .bigAct"));
    sheetOf("booking form", () => openBooking(freeFi, 0, 2), () => document.querySelector(".sheet .bkgo"));
    if (inHouse) sheetOf("stay editor", () => openStayDates(inHouse, () => {}), () => document.querySelector(".sheet .bkgo"));
    if (future) sheetOf("move picker", () => openGuestMove(future, () => {}), () => document.querySelector(".sheet .row.move, .sheet .movenote"));
    sheetOf("block form", () => openBlockForm(freeFi, 0), () => document.querySelector(".sheet .fgrid"));
    sheetOf("fault form", () => openIssueForm(freeFi, 0), () => document.querySelector(".sheet .fgrid"));
    if (owing) sheetOf("payment", () => openPayment(owing, owing.fi, 0), () => document.querySelector(".sheet .bkgo"));
    sheetOf("owed", () => openOwed("all"), () => document.querySelector(".sheet .moneylist"));
    sheetOf("cash", () => openCash(cur), () => document.querySelector(".sheet .moneylist"));
    sheetOf("spend", () => openSpend(cur), () => document.querySelector(".sheet .moneylist"));
    if (FIN.length >= 2) sheetOf("compare", () => openCompare({title: "Month on month", aLabel: "A", bLabel: "B",
      aKeys: [FIN[FIN.length - 2][0]], bKeys: [FIN[FIN.length - 1][0]]}), () => document.querySelector(".sheet .kpis"));
    sheetOf("data", () => openDataSheet(), () => document.querySelector(".sheet .blocked"));
    sheetOf("activity", () => openActivity(), () => document.querySelector(".sheet .n"));
    sheetOf("inventory", () => openInventory(), () => document.querySelector(".sheet .row, .sheet .card"));
    sheetOf("the day", () => openDay(0), () => document.querySelector(".sheet .n"));

    const was = {seg: pulseSeg, a: sel.a, n: sel.n, lean: calLean, code: monthCode, ask: askText};
    const bad = [], seen = [];
    try {
      for (const [label, prep] of steps) {
        try {
          const root = await prep();
          await wait(60);
          freeze(() => bad.push(...scan(root, label)));
          seen.push(label);
        } catch (e) {
          bad.push(`${label}: could not open — ${e && e.message || e}`);
        } finally { closeSheet(); }
      }
    } finally {
      pulseSeg = was.seg; sel = {a: was.a, n: was.n}; calLean = was.lean; monthCode = was.code; askText = was.ask;
      pendingStart = null; scr("month").scrollTop = 0; closeSheet();
    }
    eq(bad.length, 0, `${bad.length} — ${bad.slice(0, 6).join(" · ")}`);
    return `${seen.length} screens and sheets measured, none touching, none spilling`;
  });

  /* The owner asked for what he is owed at the top of Money, or on the Now
     board, and asked not to be shown the same thing twice. It is split: the
     board takes the slice with a deadline on it, Money keeps the whole. */
  await test("money that stops being collectable when a guest walks out reaches the Now board", async () => {
    const was = pulseSeg, stored = localStorage.getItem(STORE);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, 0, 2));
    ok(fi != null, "no flat free for the fixture");
    /* in the flat tonight, out tomorrow, part paid — the exact case */
    resv.push({fi, start: -2, end: 1, nights: 3, guest: "Leaving Fixture", src: "Direct",
               manual: true, amount: 21000, phone: "9876500022",
               pays: [{id: "lf1", amount: 6000, method: "Cash", on: -2}], bookedOn: -4});
    recompute();
    try {
      eq(dueFrom(resv[resv.length - 1]), 15000, "what the fixture owes");
      pulseSeg = "now";
      switchTo(SCREENS.findIndex(s => s.id === "trends"));
      await until(() => document.querySelector("#scr-trends .tcard"), "the Now board");
      /* EITHER WORDING. The fixture is one guest, but the board counts every
         guest leaving within two days still owing, and the shipped book has
         since grown one of its own — so this asserted "before a guest leaves"
         and failed on "before 2 guests leave", which is the feature working. */
      const btn = [...document.querySelectorAll("#scr-trends button")]
        .find(b => /before (a guest leaves|\d+ guests leave)/.test(b.textContent));
      ok(btn, "the board does not raise money that leaves with the guest");
      /* the plural moves with the noun: "before 1 guest leave" shipped once */
      ok(!/guest leave\b/.test(btn.textContent), `bad grammar: ${btn.textContent.slice(0, 60)}`);
      ok(/Collect ₹[\d,]+/.test(btn.textContent), `the board raises no figure: ${btn.textContent.slice(0, 60)}`);
      btn.click();
      await until(() => document.querySelector(".sheet.on .row"), "the list of who to collect from");
      const txt = document.querySelector(".sheet").textContent;
      ok(/Leaving Fixture/.test(txt), "the list does not name the guest");
      ok(/9876500022/.test(txt), "the list does not carry the number to ring");
      ok(/leaves/.test(txt), "the list does not say when the door closes");
      /* a guest leaving further out is NOT on the board — the board is things
         that expire, not everything owed */
      closeSheet();
      resv[resv.length - 1].end = 9; recompute();
      switchTo(SCREENS.findIndex(s => s.id === "trends"));
      await until(() => document.querySelector("#scr-trends .tcard"), "the board again");
      /* The CARD may still stand — other guests can legitimately be leaving
         within two days — so the claim is about this stay, not about the card.
         The board's rule is a deadline; nine days away is not one. */
      const later = [...document.querySelectorAll("#scr-trends button")]
        .find(b => /before (a guest leaves|\d+ guests leave)/.test(b.textContent));
      if(later){
        later.click();
        await until(() => document.querySelector(".sheet.on .row"), "the collect list again");
        ok(!/Leaving Fixture/.test(document.querySelector(".sheet.on").textContent),
          "a guest leaving in nine days is still raised as expiring today");
        closeSheet();
      }
      return "₹15,000 raised with a day left, named and dialable, gone when the date moves out";
    } finally {
      closeSheet();
      const i = resv.findIndex(r => r.guest === "Leaving Fixture");
      if (i >= 0) resv.splice(i, 1);
      recompute();
      if (stored != null) localStorage.setItem(STORE, stored);
      pulseSeg = was;
    }
  });

  /* The operators had twelve guests who left in August, paid at the door and
     were never written down. Recording each one landed on the room sheet,
     three screens from the list, and dated the money today — September's
     figure for August's cash. */
  await test("a payment recorded from the owed list returns to the list, dated to the day the guest left", async () => {
    const keep = activity.slice(), stored = localStorage.getItem(STORE);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, -12, -8));
    ok(fi != null, "no flat free for a past stay");
    /* left ten days ago, in the month before this one when the date allows */
    resv.push({fi, start: -12, end: -10, nights: 2, guest: "Gone Fixture", src: "Direct",
               manual: true, amount: 8800, pays: [], bookedOn: -14});
    recompute();
    const r = resv[resv.length - 1];
    const leftMonth = dayISO(r.end).slice(0, 7), cur = dayISO(0).slice(0, 7);
    const beforeLeft = cashMonth(leftMonth).inHand, beforeCur = cashMonth(cur).inHand;
    try {
      ok(owedStats().byBucket.gone.indexOf(r) >= 0, "the fixture is not in the already-left bucket");
      openOwed("gone");
      await until(() => document.querySelector(".sheet .moneylist .row"), "the owed list");
      const row = [...document.querySelectorAll(".sheet .moneylist .row")].find(x => /Gone Fixture/.test(x.textContent));
      ok(row, "the fixture is not listed");
      row.querySelector("button.paid").click();
      await until(() => document.querySelector(".sheet .bkgo"), "the payment form");
      /* the balance is filled in, and the date defaults to the day they left */
      eq(document.querySelector(".sheet .bkamt input").value, "8800", "the balance offered");
      /* and the stay reads forwards. Clamping the arrival to today printed
         "5 Sep → 26 Aug" for a stay of 24–26 Aug — a booking ending before it
         began, on the form for settling it. */
      eq(document.querySelector(".sheet .m").textContent,
        `Gone Fixture · ${flats[fi].id} · ${fmt(r.start)} → ${fmt(r.end)}`, "the stay in the header");
      const when = [...document.querySelectorAll(".sheet .srcRow")].pop();
      const pressed = [...when.children].find(b => b.getAttribute("aria-pressed") === "true");
      ok(pressed && /When they left/.test(pressed.textContent), `the default date is "${pressed && pressed.textContent}"`);
      ok(pressed.textContent.includes(fmt(r.end)), "the chip does not name the day they left");
      document.querySelector(".sheet .bkgo").click();
      /* .sheet.on, not .sheet: closeSheet only drops the class, it never
         empties the node, so a bare ".sheet .bkgo" still matches the form that
         has just been dismissed. */
      await until(() => document.querySelector(".sheet.on .moneylist"), "back on the owed list");
      ok(!/Gone Fixture/.test(document.querySelector(".sheet.on").textContent), "the settled guest is still listed as owing");
      ok(/owed/.test(document.querySelector(".sheet.on .n").textContent), `the sheet that came back is "${document.querySelector(".sheet.on .n").textContent}"`);
      eq(dueFrom(r), 0, "still owing after the payment");
      const p = r.pays[r.pays.length - 1];
      eq(p.on, r.end, "the payment is not dated to the day they left");
      /* and the money lands in the month they left, not in this one */
      eq(cashMonth(leftMonth).inHand - beforeLeft, 8800, "the month they left did not receive the money");
      if (leftMonth !== cur) eq(cashMonth(cur).inHand - beforeCur, 0, "this month was credited with last month's cash");
      ok(/dated/.test(activity[0].s), `the log line does not say it was back-dated: ${activity[0].s}`);
      /* THE SAME MONEY, FROM THE BOARD. "Worth doing now" raises the job and
         its list held the balance in a <span>, so tapping the money fell
         through to the row and opened the room — the board naming the task
         and then sending the operator to go and find it. */
      closeSheet();
      const inFlat = bookings().find(z => z.start <= 0 && z.end > 0 && z.end <= NOW + 1 && dueFrom(z) > 0);
      let built = null;
      if(!inFlat){
        const f2 = flats.map((f, i) => i).find(i => freeSpan(i, 0, 2));
        ok(f2 != null, "no flat free for the leaving fixture");
        resv.push({fi: f2, start: -2, end: 1, nights: 3, guest: "Board Fixture", src: "Direct",
                   manual: true, amount: 9000, pays: [], bookedOn: -4});
        recompute();
        built = resv[resv.length - 1];
      }
      const target = inFlat || built;
      const board = todayBoard();
      const item = board.todo.find(x => /before a guest leaves|guests leave/.test(x.label));
      ok(item, "the board no longer raises money leaving with a guest");
      item.open();
      await until(() => document.querySelector(".sheet.on .row"), "the collect list");
      const brow = [...document.querySelectorAll(".sheet .row")].find(x => new RegExp(target.guest).test(x.textContent));
      ok(brow, "the guest is not on the collect list");
      const bpay = brow.querySelector("button.paid");
      ok(bpay, "the balance on the board's list is not a control");
      ok(bpay.textContent.includes(money(dueFrom(target))), "the control does not carry the balance");
      bpay.click();
      await until(() => document.querySelector(".sheet.on .bkgo"), "the payment form from the board");
      ok(/due/.test(document.querySelector(".sheet.on .n").textContent), "the money did not open the payment form");
      /* Record it settles them and never lands on the room. With one row left
         the job is done and the sheet closes; with more, the list comes back
         without the guest just paid. */
      document.querySelector(".sheet.on .bkgo").click();
      await until(() => !document.querySelector(".sheet.on .bkgo"), "the form to close");
      eq(dueFrom(target), 0, "still owing after recording from the board");
      const stillOn = document.querySelector(".sheet.on");
      if(stillOn){
        ok(/to collect/.test(stillOn.querySelector(".n").textContent),
          `recording from the board landed on "${stillOn.querySelector(".n").textContent}"`);
        ok(!new RegExp(target.guest).test(stillOn.textContent), "the settled guest is still on the collect list");
      }
      if(built){ const j = resv.indexOf(built); if(j >= 0) resv.splice(j, 1); recompute(); }
      /* a payment can never be dated ahead of today */
      addPayment(r, 100, "Cash", "", 5);
      eq(r.pays[r.pays.length - 1].on, 0, "a future-dated payment was accepted");
      return `₹8,800 dated ${fmt(r.end)}, back on the list, ${leftMonth} credited`;
    } finally {
      closeSheet();
      const i = resv.indexOf(r); if (i >= 0) resv.splice(i, 1);
      recompute();
      if (stored != null) localStorage.setItem(STORE, stored);
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* ══ the day, and the guest who has already gone ════════════════════════ */

  /* "Some tenant booked 2 Sep to 9 Sep, today they left — but it shows free.
     They said at the last moment they would continue to the 12th. Right now I
     can't see the previous booking, I can't edit it, or do anything." The stay
     was in memory the whole time, holding its payments and its id, and no
     screen would show it. */
  await test("a guest who left this morning is still on the room sheet, and can be kept on", async () => {
    const stored = localStorage.getItem(STORE), keep = activity.slice();
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, -7, 5));
    ok(fi != null, "no flat free for the fixture");
    /* the owner's own case: in on the 2nd, out this morning, ₹31,500 for 7 */
    resv.push({fi, start: -7, end: 0, nights: 7, guest: "Ended Fixture", src: "Direct",
               manual: true, amount: 31500, pays: [], bookedOn: -9});
    recompute();
    const r = resv[resv.length - 1];
    try {
      /* the calendar is right: the room IS free tonight */
      eq(!!occ[fi][0], false, "the flat is held on a night the guest has left");
      ok(justLeft(fi).some(z => z.guest === "Ended Fixture"),
        `the departed stay is not reachable: ${justLeft(fi).map(z=>z.guest)}`);
      eq(justLeft(fi)[0].guest, "Ended Fixture", "the most recent departure is not the one who left today");
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .roomAct"), "the room sheet");
      /* the route, in their own name, on the band */
      const route = [...document.querySelectorAll(".sheet .roomRoutes.stay button")]
        .find(b => /Extend Ended Fixture/.test(b.textContent));
      ok(route, "no way to put back a guest who left this morning");
      ok(/left this morning/.test(route.textContent), `the route does not say when they left: ${route.textContent}`);
      /* and the stay is listed, not only routed to */
      ok(/Just left/.test(document.querySelector(".sheet.on").textContent), "no Just left section");
      route.click();
      await until(() => document.querySelector(".sheet.on .bkgo"), "the dates editor");
      ok(/left this morning/.test(document.querySelector(".sheet .m").textContent),
        `the editor calls a departed guest something else: ${document.querySelector(".sheet .m").textContent}`);
      /* the arrival is a fact and stays locked; the nights extend */
      ok(document.querySelector(".sheet .stepWide.locked"), "a departed guest's arrival is editable");
      const more = document.querySelector('.sheet .step button[aria-label="A night more"]');
      more.click(); more.click(); more.click();
      eq(document.querySelector(".sheet .step b").textContent, "10", "nights after three taps");
      /* the deal's own rate, not the rate card: ₹31,500 over 7 is ₹4,500 */
      eq(document.querySelector(".sheet .bkamt input").value, "45000", "the total offered for three more nights");
      const go = document.querySelector(".sheet .bkgo");
      ok(/is staying/.test(go.textContent), `the button says "${go.textContent}"`);
      go.click();
      await until(() => !document.querySelector(".sheet.on .bkgo"), "the editor to close");
      eq(r.end, 3, "the new end");
      eq(r.nights, 10, "the new nights");
      eq(r.amount, 45000, "the new total");
      /* and the room is theirs again tonight — the point of the whole thing */
      eq(!!occ[fi][0], true, "the room is still free on a night the guest is now staying");
      eq(!!occ[fi][2], true, "the last extended night is not held");
      ok(/now leaves/.test(activity[0].s), `the change was not logged: ${activity[0].s}`);
      /* nothing was re-typed: the same row, so the money and the id survive */
      eq(resv.filter(x => x.guest === "Ended Fixture").length, 1, "the extension made a second booking");
      return "left this morning, put back to 12 Sep on the same booking, ₹45,000 at the stay's own rate";
    } finally {
      const i = resv.indexOf(r); if (i >= 0) resv.splice(i, 1);
      recompute(); closeSheet();
      if (stored != null) localStorage.setItem(STORE, stored);
      activity.length = 0; keep.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* "I don't have to tap on Leaving and see, and then see on Arriving, and then
     see what is Turnaround. I need one view." */
  await test("one day view holds arrivals, departures and turnarounds, each flat once", async () => {
    const stored = localStorage.getItem(STORE);
    const free = flats.map((f, i) => i).filter(i => freeSpan(i, -3, 6));
    ok(free.length >= 3, "not enough free flats for the fixture");
    const [a, b, c] = free;
    const made = [
      {fi: a, start: -3, end: 0, nights: 3, guest: "Turn Out", src: "Airbnb", manual: true, pays: []},
      {fi: a, start: 0, end: 4, nights: 4, guest: "Turn In", src: "Direct", manual: true, amount: 20000, pays: []},
      {fi: b, start: -2, end: 0, nights: 2, guest: "Out Only", src: "Direct", manual: true, amount: 9000, pays: []},
      {fi: c, start: 0, end: 3, nights: 3, guest: "In Only", src: "Agoda", manual: true, amount: 12000, pays: []},
    ];
    made.forEach(m => resv.push(m));
    recompute();
    try {
      openDay(0);
      await until(() => document.querySelector(".sheet.on .dayrows .row"), "the day view");
      const sheet = document.querySelector(".sheet.on");
      /* every group present, and named */
      const heads = [...sheet.querySelectorAll(".lbl")].map(x => x.textContent);
      ok(heads.some(h => /^Turnaround · /.test(h)), `no turnaround group: ${heads}`);
      ok(heads.some(h => /^Leaving · /.test(h)), `no leaving group: ${heads}`);
      ok(heads.some(h => /^Arriving · /.test(h)), `no arriving group: ${heads}`);
      /* THE POINT: both halves of a turnaround on one row, so nothing has to be
         cross-referenced against a second list */
      const turn = [...sheet.querySelectorAll(".dayrows .row")]
        .find(x => /Turn Out/.test(x.textContent));
      ok(turn, "the turnaround flat is not listed");
      ok(/Turn In/.test(turn.textContent), `the row does not name who is coming in: ${turn.textContent}`);
      /* and that flat is NOT repeated under leaving or arriving */
      const rows = [...sheet.querySelectorAll(".dayrows .row")];
      const ids = rows.map(x => x.querySelector(".id").textContent);
      eq(ids.length, new Set(ids).size, `a flat appears twice: ${ids}`);
      eq(rows.filter(x => /Turn Out|Turn In/.test(x.textContent)).length, 1,
        "the turnaround guests appear outside the turnaround group");
      /* the money that has to be collected before a door shuts is on the row */
      const out = rows.find(x => /Out Only/.test(x.textContent));
      ok(/₹9,000/.test(out.textContent), `a departing balance is not shown: ${out.textContent}`);
      /* and none of it is clipped — this view exists to save the tapping */
      rows.forEach(x => {
        const m = x.querySelector(".meta");
        ok(m.scrollWidth <= m.clientWidth + 1, `a row is clipped: ${x.textContent.slice(0, 40)}`);
      });
      /* BY BUILDING. The five addresses get visited by different people, so
         "what is happening in Madhapur today" has to be one tap, not a read
         down a list ordered by flat id. */
      const chips = [...sheet.querySelectorAll(".roomfilt button")];
      ok(chips.length >= 2, "no building filter on a day spanning several buildings");
      eq(chips[0].querySelector("span").textContent, "All", "the first chip");
      /* the chip counts are flats-to-handle and must add up to the All chip */
      const num = c => +c.querySelector("i").textContent;
      eq(chips.slice(1).reduce((a2, c) => a2 + num(c), 0), num(chips[0]),
        "the building chips do not add up to All");
      const one = chips.slice(1).find(c => num(c) > 0);
      const name = one.querySelector("span").textContent;
      one.click();
      await wait(80);
      const only = [...sheet.querySelectorAll(".dayrows .row")];
      eq(only.length, num(one), `rows shown for ${name}`);
      ok(only.every(x => x.textContent.includes(name)), "a row from another building is still listed");
      ok(sheet.querySelector(".m").textContent.includes(name),
        `the sheet does not say which building: ${sheet.querySelector(".m").textContent}`);
      chips[0].click();
      await wait(80);
      eq(sheet.querySelectorAll(".dayrows .row").length, rows.length, "All did not bring the rest back");

      /* the three tiles on Rooms all open THIS, not three separate sheets */
      closeSheet();
      switchTo(SCREENS.findIndex(s2 => s2.id === "rooms"));
      await until(() => document.querySelector("#scr-rooms .op"), "the ops row");
      const tiles = [...document.querySelectorAll("#scr-rooms .op")];
      eq(tiles.length, 3, "the three counts are gone");
      for (const t of tiles) {
        t.click();
        await until(() => document.querySelector(".sheet.on .dayrows"), "the day view from a tile");
        const n = document.querySelector(".sheet.on .n").textContent;
        ok(/September|October|November|August/.test(n), `a tile opened "${n}" instead of the day`);
        closeSheet();
        await wait(40);
      }
      return `${rows.length} flats, one row each, all three tiles open the one view`;
    } finally {
      made.forEach(m => { const i = resv.indexOf(m); if (i >= 0) resv.splice(i, 1); });
      recompute(); closeSheet();
      if (stored != null) localStorage.setItem(STORE, stored);
    }
  });

  /* THE ONE THING THIS APP MUST NEVER SHOW. The sample book is what the public
     link opens and what every test below builds its fixtures against, so a
     flat let to two people in it is both a lie on the demo and a booby trap
     under the suite. Caught for real: a seeded demo day used freeRange's
     `Math.max(a, 0)` as a collision guard, which checks no nights at all for a
     stay that ended this morning, and B201 shipped with two guests leaving it
     on the same day. */
  await test("no flat in the sample book is let to two people at once", async () => {
    const clash = [];
    for (let fi = 0; fi < NF; fi++) {
      const mine = resv.filter(r => r.fi === fi).sort((a, b) => a.start - b.start);
      for (let i = 1; i < mine.length; i++)
        if (mine[i].start < mine[i - 1].end)
          clash.push(`${flats[fi].id}: ${mine[i - 1].guest} ${mine[i - 1].start}\u2192${mine[i - 1].end}`
                   + ` over ${mine[i].guest} ${mine[i].start}\u2192${mine[i].end}`);
    }
    eq(clash.length, 0, `overlapping stays: ${clash.slice(0, 3).join(" \u00b7 ")}`);
    /* and the day view can therefore never list one flat twice */
    const ops = dayOps(0);
    const outs = ops.departures.map(r => r.fi), ins = ops.arrivals.map(r => r.fi);
    eq(outs.length, new Set(outs).size, "two guests leave one flat today");
    eq(ins.length, new Set(ins).size, "two guests arrive in one flat today");
    return `${resv.length} stays across ${NF} flats, none overlapping`;
  });

  /* ══ the clean between two guests ═══════════════════════════════════════ */

  /* The app could always say a turnaround was COMING and had no idea whether
     one had HAPPENED. This is the whole loop: the job appears because somebody
     left, the first tick starts the clock, an item the owner marked cannot be
     ticked without a photograph, and the room is not ready until the list is. */
  await test("a clean runs from the first tick to ready, and refuses to finish early", async () => {
    const keepChecks = checklist, keepTurns = JSON.stringify(turns);
    const keepAct = activity.slice(), stored = localStorage.getItem(STORE);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, -3, 5));
    ok(fi != null, "no flat free for the fixture");
    const type = flats[fi].type;
    resv.push({fi, start: -3, end: 0, nights: 3, guest: "Cleaner Out", src: "Direct",
               manual: true, pays: []});
    resv.push({fi, start: 0, end: 3, nights: 3, guest: "Cleaner In", src: "Direct",
               manual: true, pays: []});
    recompute();
    try {
      /* a departure raises the job; an arrival into an already-empty room
         does not, because nobody has slept in it */
      const jobs = turnJobs(0);
      ok(jobs.some(j => j.fi === fi && j.rush), "a same-day turnaround is not raised as a job");
      const arriveOnly = dayOps(0).arrivals.find(r => !dayOps(0).departures.some(z => z.fi === r.fi));
      if (arriveOnly)
        ok(!jobs.some(j => j.fi === arriveOnly.fi),
          "an arrival into an empty room is being raised as a clean");

      /* two items, one of which the owner says needs a photograph */
      saveList(type, [
        {id: "t-plain", label: "Bins emptied", photo: false},
        {id: "t-photo", label: "TV remote present", photo: true},
      ]);
      eq(turnProgress(fi, 0).state, "waiting", "a job starts as anything but waiting");

      openTurn(fi, 0);
      await until(() => document.querySelector(".sheet.on .chkbox"), "the clean sheet");
      const boxes = () => [...document.querySelectorAll(".sheet.on .chkbox")];
      eq(boxes().length, 2, "items on the sheet");
      const go = () => document.querySelector(".sheet.on .bkgo");
      ok(go().disabled, "ready is offered before anything is checked");

      /* the plain one ticks, and that first tick is what starts the clock —
         nobody presses "begin" */
      boxes()[0].click();
      await until(() => turnProgress(fi, 0).state === "cleaning", "the clock to start");
      const t = turnAt(fi, 0);
      ok(t.started, "the job records no start time");
      eq(Object.keys(t.checks).length, 1, "ticks recorded");
      ok(t.checks["t-plain"].at, "the tick carries no time");
      ok(go().disabled, "ready is offered with an item outstanding");
      ok(/1 still to check/.test(go().textContent), `the button says "${go().textContent}"`);

      /* THE PHOTO ITEM. Cancelling the camera must not tick it — the whole
         point of marking an item is that a tick without a picture is not a
         tick. Simulated by refusing the picker the way a cancel does. */
      const realAsk = window.askForPhoto;
      try {
        window.askForPhoto = async () => null;
        boxes()[1].click();
        await wait(120);
        eq(Object.keys(turnAt(fi, 0).checks).length, 1,
          "an item that needs a photo was ticked without one");
      } finally { window.askForPhoto = realAsk; }

      /* with a picture, it ticks and the room can be finished */
      turnTick(fi, 0, {id: "t-photo", label: "TV remote present"}, "local/x/y.jpg");
      openTurn(fi, 0);
      await until(() => document.querySelector(".sheet.on .bkgo"), "the sheet again");
      ok(!go().disabled, "ready is refused with every item checked");
      ok(/Ready for the next guest/.test(go().textContent), `the button says "${go().textContent}"`);
      go().click();
      await until(() => turnProgress(fi, 0).state === "ready", "the room to go ready");
      ok(turnAt(fi, 0).ready, "the job records no ready time");
      ok(/is ready for the next guest/.test(activity[0].s), `not logged: ${activity[0].s}`);
      return "raised, started on the first tick, refused without a photo, ready on the last";
    } finally {
      closeSheet();
      resv = resv.filter(r => !/^Cleaner /.test(r.guest || ""));
      recompute();
      checklist = keepChecks; checkSave();
      turns = JSON.parse(keepTurns); turnSave();
      if (stored != null) localStorage.setItem(STORE, stored);
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* A studio has no second bedroom, and asking about one teaches staff to tick
     without reading. */
  await test("each flat type carries its own checklist, and editing one leaves the others alone", async () => {
    const keep = checklist, keepAct = activity.slice();
    try {
      const types = unitTypes();
      ok(types.length >= 2, "the book has only one flat type, so this proves nothing");
      const before = types.map(t => checksFor(t).length);
      saveList(types[0], checksFor(types[0]).concat([{id: "only-here", label: "Balcony swept", photo: true}]));
      eq(checksFor(types[0]).length, before[0] + 1, "the edited type did not grow");
      types.slice(1).forEach((t, i) =>
        eq(checksFor(t).length, before[i + 1], `${t} changed when ${types[0]} was edited`));
      ok(checksFor(types[0]).some(i => i.label === "Balcony swept" && i.photo),
        "the new item did not keep its photo flag");
      /* removing it takes it away again, and only from that type */
      saveList(types[0], checksFor(types[0]).filter(i => i.id !== "only-here"));
      eq(checksFor(types[0]).length, before[0], "the item was not removed");
      ok(/Changed the/.test(activity[0].s), `not logged: ${activity[0].s}`);
      return `${types.length} types, ${before.join("/")} items, edits stay put`;
    } finally {
      checklist = keep; checkSave();
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* Two phones must agree what a job is called without asking each other. */
  await test("a clean has the same id on any phone, and a tick belongs to it", () => {
    const fi = 0, f = flats[fi];
    const a = turnKey(f.uid || f.id, 0), b = turnKey(f.uid || f.id, 0);
    eq(a, b, "the same flat and day produced two different ids");
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a),
      `not a uuid Postgres will take: ${a}`);
    ok(turnKey(f.uid || f.id, 0) !== turnKey(f.uid || f.id, 1), "two days share one id");
    ok(turnKey(flats[1].uid || flats[1].id, 0) !== a, "two flats share one id");
    eq(checkKey(a, "item-1"), checkKey(a, "item-1"), "a tick's id is not stable");
    ok(checkKey(a, "item-1") !== checkKey(a, "item-2"), "two items share one tick id");
    return "stable per flat and day, distinct across both";
  });

  /* The manager's question is "is 3B done yet", and it should not need a
     second screen to answer. */
  await test("the day view carries every clean's state, and opens it", async () => {
    const keepTurns = JSON.stringify(turns), stored = localStorage.getItem(STORE);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, -3, 3));
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -3, end: 0, nights: 3, guest: "Pill Fixture", src: "Direct",
               manual: true, pays: []});
    recompute();
    try {
      openDay(0);
      await until(() => document.querySelector(".sheet.on .dayrows .row"), "the day view");
      const rowOf = () => [...document.querySelectorAll(".sheet.on .dayrows .row")]
        .find(x => /Pill Fixture/.test(x.textContent));
      ok(rowOf(), "the departing flat is not on the day view");
      const pill = () => rowOf().querySelector(".pill.turn");
      ok(pill(), "a flat somebody has left carries no clean state");
      eq(pill().textContent, "to clean", "an untouched clean does not say so");
      /* the count line agrees with the pills */
      const jobs = turnJobs(0).length;
      const pills = document.querySelectorAll(".sheet.on .pill.turn").length;
      eq(pills, jobs, `${pills} pills against ${jobs} jobs`);
      /* and the pill is the way in */
      pill().click();
      await until(() => document.querySelector(".sheet.on .chkbox"), "the clean, from the pill");
      ok(document.querySelector(".sheet.on .n").textContent === flats[fi].id,
        "the pill opened somebody else's flat");
      return `${jobs} jobs, ${pills} pills, each one a door`;
    } finally {
      closeSheet();
      resv = resv.filter(r => r.guest !== "Pill Fixture");
      recompute();
      turns = JSON.parse(keepTurns); turnSave();
      if (stored != null) localStorage.setItem(STORE, stored);
    }
  });

  /* ══ the small frictions ════════════════════════════════════════════════ */

  /* "Number of guests should default: 1 BHK or studio 2, 2 BHK 4, 3 BHK 6,
     4 BHK 8." Two was the default for a studio and a penthouse alike, so every
     larger flat was re-counted by hand on every booking. */
  await test("the guest count starts at what the flat sleeps", async () => {
    eq(paxFor("Studio"), 2, "a studio");
    eq(paxFor("1 BHK"), 2, "a 1 BHK");
    eq(paxFor("2 BHK"), 4, "a 2 BHK");
    eq(paxFor("3 BHK"), 6, "a 3 BHK");
    eq(paxFor("4 BHK"), 8, "a 4 BHK");
    eq(paxFor("Penthouse"), 8, "a penthouse");
    eq(paxFor(""), 2, "a type nobody has named");
    ok(paxFor("12 BHK") <= 12, "the stepper's own ceiling is not respected");
    /* and the form actually opens on it — the pax stepper is the SECOND .step
       on the sheet, the first being the nights one */
    const shown = {};
    for (const ty of unitTypes()) {
      const fi = flats.map((f, i) => i).find(i => flats[i].type === ty && freeSpan(i, 0, 2));
      if (fi == null) continue;
      openBooking(fi, 0, 2);
      await until(() => document.querySelectorAll(".sheet.on .step b").length >= 2, `the ${ty} form`);
      const steps = [...document.querySelectorAll(".sheet.on .step b")];
      shown[ty] = +steps[steps.length - 1].textContent;
      eq(shown[ty], paxFor(ty), `the ${ty} booking form opens on the wrong count`);
      closeSheet();
      await wait(40);
    }
    ok(Object.keys(shown).length >= 3, `only ${Object.keys(shown).length} types could be checked`);
    return Object.entries(shown).map(([t, n]) => `${t} ${n}`).join(" · ");
  });

  /* "Logging expenses is a bit of a hassle, needs to tap a few times." Two
     <select>s on a phone are two full-screen wheels, in front of the one field
     the operator opened the sheet holding a number for. */
  await test("an expense is the amount, then two taps that remember themselves", async () => {
    const keepExp = expenses.slice(), keepLast = localStorage.getItem("vacancy.lastexpense.v1");
    const keepAct = activity.slice();
    try {
      openExpense(null, dayISO(0).slice(0, 7));
      await until(() => document.querySelector(".sheet.on .bkamt input"), "the expense form");
      const sheet = () => document.querySelector(".sheet.on");
      /* no wheels: every answer is visible and one tap away */
      eq(sheet().querySelectorAll("select").length, 0, "the form still uses a dropdown");
      const rows = () => [...sheet().querySelectorAll(".roomfilt")];
      eq(rows().length, 2, "the building and cost-line chip rows");
      eq(rows()[0].children.length, buildingsOf().length, "a building is missing from the chips");
      ok(rows()[1].children.length >= 3, "the cost lines are not offered as chips");
      /* the amount comes first, and Save refuses an empty form */
      const first = sheet().querySelector(".bkform > *");
      ok(first.classList.contains("bkamt"), `the form leads with ${first.className}`);
      const go = () => sheet().querySelector(".bkgo");
      ok(go().disabled, "Save is live with nothing entered");
      /* pick a building and a line that are NOT the defaults, then log it */
      const b2 = [...rows()[0].children].find(c => c.getAttribute("aria-selected") === "false");
      const wantB = b2.textContent;
      b2.click(); await wait(60);
      const l2 = [...rows()[1].children].find(c => c.getAttribute("aria-selected") === "false");
      const wantL = l2.textContent;
      l2.click(); await wait(60);
      const amt = sheet().querySelector(".bkamt input");
      amt.value = "3100"; amt.dispatchEvent(new Event("input"));
      await wait(80);
      ok(!go().disabled, "Save is refused with an amount entered");
      ok(/3,100/.test(go().textContent), `the button does not name the figure: ${go().textContent}`);
      go().click();
      await until(() => expenses.length === keepExp.length + 1, "the expense to be logged");
      const e = expenses[expenses.length - 1];
      eq(e.amount, 3100, "the amount logged");
      eq(e.line, wantL, "the cost line logged");

      /* THE POINT: the next one starts where the last one ended, so a second
         receipt for the same building and line is the amount and Save. */
      document.querySelectorAll(".toast").forEach(t => t.remove());
      openExpense(null, dayISO(0).slice(0, 7));
      await until(() => document.querySelector(".sheet.on .roomfilt"), "the form again");
      eq(rows()[0].querySelector('[aria-selected="true"]').textContent, wantB,
        "the building was not remembered");
      eq(rows()[1].querySelector('[aria-selected="true"]').textContent, wantL,
        "the cost line was not remembered");
      /* and the remembered line is ON SCREEN, not hanging off the right edge */
      const on = rows()[1].querySelector('[aria-selected="true"]');
      const rr = rows()[1].getBoundingClientRect(), ro = on.getBoundingClientRect();
      ok(ro.left >= rr.left - 1 && ro.right <= rr.right + 1,
        `the chosen cost line is off screen: ${on.textContent}`);
      return `${wantB} · ${wantL} remembered, amount and Save is the whole of the next one`;
    } finally {
      closeSheet();
      expenses.length = 0; keepExp.forEach(e => expenses.push(e)); expSave();
      if (keepLast != null) localStorage.setItem("vacancy.lastexpense.v1", keepLast);
      else localStorage.removeItem("vacancy.lastexpense.v1");
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
      document.querySelectorAll(".toast").forEach(t => t.remove());
    }
  });

  /* "I don't need this open night info, we are showing this in multiple places
     and no point showing 62 nt open." How long a room stays empty is a selling
     question the strip, the tiles and Open stretches all answer already. */
  await test("the day view spends its one pill on the clean, not on nights nobody asked about", async () => {
    const stored = localStorage.getItem(STORE), keepTurns = JSON.stringify(turns);
    const fi = flats.map((f, i) => i).find(i => freeSpan(i, -3, 3));
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -3, end: 0, nights: 3, guest: "Pill Only", src: "Direct",
               manual: true, pays: []});
    recompute();
    try {
      openDay(0);
      await until(() => document.querySelector(".sheet.on .dayrows .row"), "the day view");
      const txt = document.querySelector(".sheet.on").textContent;
      ok(!/nt open/.test(txt), "the day view still counts nights nobody asked for");
      ok(!/re-let same day/.test(txt), "the old leaving pill is still there");
      const row = [...document.querySelectorAll(".sheet.on .dayrows .row")]
        .find(x => /Pill Only/.test(x.textContent));
      const pills = row.querySelectorAll(".pill");
      eq(pills.length, 1, `a leaving row carries ${pills.length} pills`);
      ok(pills[0].classList.contains("turn"), "the one pill is not the clean's state");
      /* and openOps is gone rather than merely unreachable */
      eq(typeof window.openOps, "undefined", "the three old sheets are still in the file");
      return "one pill, and it says whether the room has been cleaned";
    } finally {
      closeSheet();
      resv = resv.filter(r => r.guest !== "Pill Only");
      recompute();
      turns = JSON.parse(keepTurns); turnSave();
      if (stored != null) localStorage.setItem(STORE, stored);
    }
  });

  /* A NOTE WHERE A TEST BRIEFLY WAS. While chasing the cascade above I added a
     guard in cloudPull refusing to replace a non-empty inventory with an empty
     answer, and a test for it, on the reasoning that save() has refused to
     write an empty book over a stored one since day one.

     It was wrong, and the suite said so. rest() throws on any non-2xx, so an
     empty array is not a failed read — it is a 200 saying this host has no
     flats, which is precisely the state a first sign-in is in. The guard
     returned early from cloudPull, adoption never ran, and "signing in to an
     empty server adopts the book instead of erasing it" went red. That test
     exists because erasing the operator's book on first sign-in was once a
     real bug, and it outranks a symmetry argument.

     Both were reverted. The cascade's actual cause was the stub above reaching
     a background pull, which is fixed where it happens. */

  /* ══ the whole surface ══════════════════════════════════════════════════ */

  /* ══ the cleaner's seat ══════════════════════════════════════════════════ */

  /* A staff session takes an entirely different road: staffPull, not cloudPull,
     and the phone ends up holding flats, movements and a checklist — no stays,
     no payments, no expenses, no other building. This drives that shape
     through the real render rather than the RPCs, which need a live account. */
  const asStaff = (fn) => async () => {
    const keepMe = me, keepMode = MODE, keepFlats = flats.slice(),
          keepResv = resv.slice(), keepBook = staffBook, keepDay = staffDay,
          keepTurns = JSON.stringify(turns), keepAct = activity.slice();
    try {
      /* the building with the most movement across the three days it holds */
      const cnt = {};
      [-1, 0, 1].forEach(d => dayOps(d).departures.forEach(r => {
        const b = flats[r.fi].bname; cnt[b] = (cnt[b] || 0) + 1; }));
      const bname = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
      const all = flats.slice();
      me = { role: "staff", buildings: ["fake-building"] };
      MODE = "live";
      /* exactly the shape staffPull builds: no rate, one building, and the
         building code replaced by its id because a cleaner is never told it */
      flats = all.filter(f => f.bname === bname)
                 .map(f => ({ ...f, code: "bid", bshort: f.bname, rate: 0 }));
      NF = flats.length;
      flatIndex = Object.fromEntries(flats.map((f, i) => [f.id, i]));
      staffBook = {};
      [-1, 0, 1].forEach(d => {
        const ops = dayOps(d), m = new Map();
        ops.departures.forEach(r => { const f = all[r.fi]; if (f.bname !== bname) return;
          m.set(f.id, { fi: flatIndex[f.id], out: true, in: false }); });
        ops.arrivals.forEach(r => { const f = all[r.fi]; if (f.bname !== bname) return;
          const e = m.get(f.id); if (e) e.in = true;
          else m.set(f.id, { fi: flatIndex[f.id], out: false, in: true }); });
        staffBook[dayISO(d)] = [...m.values()];
      });
      /* held before resv is emptied: the names this seat must never see */
      const guests = [...new Set(keepResv.map(r => r.guest).filter(Boolean))];
      resv = []; recompute();
      staffDay = 0;
      return await fn(bname, all, guests);
    } finally {
      closeSheet();
      me = keepMe; MODE = keepMode; staffBook = keepBook; staffDay = keepDay;
      flats = keepFlats; NF = flats.length;
      flatIndex = Object.fromEntries(flats.map((f, i) => [f.id, i]));
      resv = keepResv; recompute();
      turns = JSON.parse(keepTurns); turnSave();
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
      leaveStaff();
      document.querySelectorAll(".toast").forEach(t => t.remove());
    }
  };

  /* THE WHOLE POINT OF THE ROLE. Not "the money is hidden" — the money was
     never sent, so there is nothing on the phone to hide. */
  await test("a cleaner's phone holds the day's rooms and nothing else",
    asStaff(async (bname, all, guests) => {
      const d = 1;
      staffDay = d; paintStaff();
      await until(() => document.querySelector("#scr-staff .jobcard, #scr-staff .staffend"),
        "the cleaner's screen");
      eq(resv.length, 0, "a cleaner's phone is holding stays");
      ok(document.documentElement.classList.contains("staffmode"), "the app is not in staff mode");
      eq(document.getElementById("tabbar").hidden, true, "the four tabs are still offered");
      ok(document.getElementById("scr-staff").classList.contains("on"),
        "the cleaner's screen is not the one on show");
      const txt = document.getElementById("scr-staff").textContent;
      ok(!/₹/.test(txt), "money reached the cleaner's screen");
      /* no guest anywhere on it — the names are in `all`, which this seat
         never received */
      const names = guests.filter(n => n.length > 3);
      const leaked = names.filter(n => txt.includes(n));
      eq(leaked.length, 0, `guest names on the cleaner's screen: ${leaked.slice(0, 3)}`);
      /* and no other building */
      const others = [...new Set(all.map(f => f.bname))].filter(b => b !== bname);
      eq(others.filter(b => txt.includes(b)).length, 0, "another building is named");
      return `${flats.length} flats in ${bname}, no stay, no rupee, no name`;
    }));

  /* Every card is a door into that room's checklist, and it opens the right
     room — a cleaner tapping 3B and getting 3A ticks the wrong list. */
  await test("every room on the cleaner's screen opens its own checks",
    asStaff(async () => {
      const withWork = [-1, 0, 1].find(d => dayMoves(d).some(m => m.out));
      ok(withWork !== undefined, "no departure in three days of the fixture");
      staffDay = withWork; paintStaff();
      await until(() => document.querySelector("#scr-staff .jobcard"), "the cards");
      const cards = [...document.querySelectorAll("#scr-staff .jobcard")];
      eq(cards.length, dayMoves(withWork).length, "a card per room that moves");
      const i = dayMoves(withWork).findIndex(m => m.out);
      cards[i].click();
      await until(() => document.querySelector(".sheet.on .chkbox"), "the checks");
      eq(document.querySelector(".sheet.on .n").textContent,
        flats[dayMoves(withWork)[i].fi].id, "the card opened somebody else's room");
      /* the header names the movement without naming anybody, because it has
         no name to give */
      const m = document.querySelector(".sheet.on .m").textContent;
      ok(/someone/i.test(m), `the header says "${m}"`);
      /* and a cleaner cannot shorten the list they are being checked against */
      ok(!/Edit the .* checklist/.test(document.querySelector(".sheet.on").textContent),
        "a cleaner is offered the checklist editor");
      return `${cards.length} rooms, each its own door`;
    }));

  /* A room left dirty at six in the evening is still dirty at eight the next
     morning, and nobody looking at today would think to look at yesterday. */
  await test("yesterday's unfinished rooms come and find the cleaner",
    asStaff(async () => {
      const y = dayMoves(-1).filter(m => m.out);
      if (!y.length) return "no departure yesterday in this fixture — nothing to carry";
      staffDay = 0; paintStaff();
      await until(() => document.querySelector("#scr-staff"), "the screen");
      const carry = document.querySelector("#scr-staff .carry");
      ok(carry, "yesterday's unfinished work is not raised on today's screen");
      ok(carry.textContent.includes(flats[y[0].fi].id), "the carried room is not named");
      carry.click();
      await wait(80);
      eq(staffDay, -1, "the carry-over does not go to yesterday");
      /* and once every one of them is done it stops nagging */
      y.forEach(m => turnSet(m.fi, -1, { state: "ready", ready: new Date().toISOString() }));
      staffDay = 0; paintStaff();
      ok(!document.querySelector("#scr-staff .carry"),
        "finished rooms are still being carried forward");
      return `${y.length} carried, and gone once done`;
    }));

  /* ══ the small frictions, second round ═══════════════════════════════════ */

  /* "What is 'not started'? Remove it if not necessary." It was a bare number
     under three tiles that already counted the day and above three rows each
     carrying a pill that already said "to clean". */
  await test("the day view stops saying the same thing a fourth time", async () => {
    const keepTurns = JSON.stringify(turns), stored = localStorage.getItem(STORE);
    try {
      const d = [0, 1, 2].find(x => turnJobs(x).length >= 2);
      ok(d !== undefined, "no day with two cleans in the fixture");
      openDay(d);
      await until(() => document.querySelector(".sheet.on .dayrows .row"), "the day view");
      const txt = () => document.querySelector(".sheet.on").textContent;
      ok(!/not started/i.test(txt()), "the day view still says 'not started'");
      /* nothing done: the rows have it covered, so the line stays away */
      eq(document.querySelectorAll(".sheet.on .ratesay").length, 0,
        "a progress line is shown before there is any progress");
      /* one done: now it says something no row says */
      const j = turnJobs(d)[0];
      turnSet(j.fi, d, { state: "ready", ready: new Date().toISOString() });
      openDay(d);
      await until(() => document.querySelector(".sheet.on .ratesay"), "the progress line");
      const line = document.querySelector(".sheet.on .ratesay").textContent;
      ok(/ready/.test(line), `the line says "${line}"`);
      return `silent at none, "${line.trim()}" at one`;
    } finally {
      closeSheet();
      turns = JSON.parse(keepTurns); turnSave();
      if (stored != null) localStorage.setItem(STORE, stored);
    }
  });

  /* Three kinds of event that were three identical grey rows. The mark belongs
     where the kind is DECLARED — the tiles and the group heading — and not on
     every row, which is where it becomes the third wording of one fact. */
  await test("each kind of movement is marked once, where it is declared", async () => {
    const d = [0, 1, 2].find(x => { const o = dayOps(x);
      return o.departures.length && o.arrivals.length; });
    ok(d !== undefined, "no day with both an arrival and a departure");
    openDay(d);
    await until(() => document.querySelector(".sheet.on .dayrows .row"), "the day view");
    const sheet = document.querySelector(".sheet.on");
    eq(sheet.querySelectorAll(".dayrows .row .kindico").length, 0,
      "the kind is being repeated on every row");
    ok(sheet.querySelectorAll(".opp .kindico").length >= 2, "the tiles carry no mark");
    ok(sheet.querySelectorAll(".sheet-s .kindico").length >= 2, "the headings carry no mark");
    /* Each tile wears its own kind... */
    const marks = [...sheet.querySelectorAll(".opp .kindico")];
    const seen = marks.map(n => [...n.classList].find(c => c !== "kindico"));
    eq(new Set(seen).size, seen.length, `two tiles wear the same mark: ${seen}`);
    /* ...and the ONE with a clock on it is the one that is coloured
       differently. Leaving and arriving deliberately share a weight: they are
       equally ordinary, they are told apart by which way the arrow points, and
       dimming one of them made it read as disabled rather than as a different
       kind of event. */
    const colour = k => { const n = marks.find(m => m.classList.contains(k));
                          return n ? getComputedStyle(n).backgroundColor : null; };
    if (colour("out") && colour("in"))
      eq(colour("in"), colour("out"), "arriving is dimmer than leaving");
    if (colour("turn") && colour("out"))
      ok(colour("turn") !== colour("out"),
        "the turnaround is not marked out from the two ordinary movements");
    closeSheet();
    return `${seen.join(" / ")} — distinct glyph and distinct colour`;
  });

  /* THE FOREIGN KEY THAT WOULD HAVE EATEN EVERY FIRST TICK. turn_checks.item_id
     pointed at check_items, and the app deliberately falls back to a starter
     list that is computed rather than stored — so on a property where nobody
     has opened the checklist editor, which is every property on the day the
     feature ships, the first tick carried an item_id no row had and came back
     23503. The tick showed on the cleaner's phone and reached nobody. */
  await test("a tick syncs against a checklist the owner never wrote", async () => {
    const keepQ = queue.slice(), keepTurns = JSON.stringify(turns);
    const keepChecks = checklist, keepMode = MODE, keepAct = activity.slice();
    let gaveUid = null;
    try {
      checklist = null;                       // nobody has ever saved a list
      const fi = 0, type = flats[fi].type;
      /* On a live account every flat carries the server's uuid — cloudPull
         reads it, and a flat added from Inventory is given one on its first
         save — so a sample flat, which has none, has to borrow one here or
         the sync guard is what the test would be measuring. */
      if (!flats[fi].uid) { flats[fi].uid = uuid(); gaveUid = fi; }
      const items = checksFor(type);
      ok(items.length && items.every(i => i.starter), "the starter list is not being used");
      const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      items.forEach(i => ok(UUID.test(i.id),
        `a starter item's id is not a uuid Postgres will take: ${i.id}`));
      MODE = "live";
      queue.length = 0;
      turnTick(fi, 0, items[0]);
      const chk = queue.find(o => o.k === "chk+");
      ok(chk, "ticking enqueued no tick");
      ok(UUID.test(chk.body.item_id), `the op carries ${chk.body.item_id}`);
      eq(chk.body.label, items[0].label, "the tick did not snapshot the wording");
      return `${items.length} starter items, all uuid-shaped, tick carries its own label`;
    } finally {
      queue.length = 0; keepQ.forEach(o => queue.push(o)); jset(QUEUE_KEY, queue);
      turns = JSON.parse(keepTurns); turnSave();
      checklist = keepChecks; checkSave(); MODE = keepMode;
      if (gaveUid != null) delete flats[gaveUid].uid;
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* freeSpan(fi, a, b) clamps `a` to 0 — correct, since you cannot sell a night
     that has gone — so it answers nothing about the past. Every fixture below
     seeds departures, so it needs a flat whose past is genuinely empty as well.
     Getting this wrong does not fail loudly: the seeded rows land on a flat
     that already had three departures this fortnight, and the assertion that
     breaks is a count, several lines from the cause. */
  const pastClear = (fi, from) =>
    !resv.some(r => r.fi === fi && r.end > from && r.start < 1);
  const freeFlat = (from, to) => flats.map((f, i) => i)
    .find(i => freeSpan(i, 0, to) && pastClear(i, from));

  /* The two rare controls sat directly under Book, on every room, every time
     it was opened — when a flat goes out of service perhaps twice a month.
     A previous pass fixed their WEIGHT and left their POSITION. */
  await test("the room sheet is ordered by how often each thing is wanted", async () => {
    const fi = flats.map((f, i) => i).find(i => resv.some(r => r.fi === i && r.end > 0));
    ok(fi != null, "no flat with a booking for the fixture");
    openSheet(fi, 0);
    await until(() => document.querySelector(".sheet.on .roomRoutes"), "the room sheet");
    const b = document.getElementById("sheetB");
    const heads = [...b.querySelectorAll(".sheet-s .lbl:first-child")].map(n => n.textContent);
    const routes = b.querySelector(".roomRoutes:not(.stay)");
    ok(routes, "the fault and out-of-service routes are gone entirely");
    /* below everything: the last heading on the sheet, and after the primary */
    eq(heads[heads.length - 1], "If something is wrong", `headings ran ${heads.join(" / ")}`);
    const big = b.querySelector(".bigAct, .bookbtn");
    if (big) ok(routes.getBoundingClientRect().top > big.getBoundingClientRect().bottom,
      "the rare pair is still above the primary action");
    const cards = [...b.querySelectorAll(".card")];
    ok(cards.length && routes.getBoundingClientRect().top >
       cards[cards.length - 1].getBoundingClientRect().top,
      "the rare pair is above the last list on the sheet");
    /* quiet is not the same as hard to hit — both keep a real target and both
       still say which way they go, which is the one thing that can be got
       wrong here */
    const btns = [...routes.querySelectorAll("button")];
    eq(btns.length, 2, "both routes are present");
    btns.forEach(x => ok(x.getBoundingClientRect().height >= 44,
      `${x.textContent.slice(0, 12)} is ${Math.round(x.getBoundingClientRect().height)}px tall`));
    ok(/stays on sale/.test(routes.textContent) && /cannot be sold/.test(routes.textContent),
      "the qualifiers that say which one takes the room off sale are gone");
    closeSheet();
    return `${heads.join(" \u00b7 ")} \u2014 rare pair last`;
  });

  /* "9 Sep → 9 Sep" for a three-night stay, and "9 Sep → 1 Sep" for one who
     left last week: an end eight days before its own start. Math.max(start, 0)
     is right in Coming up and wrong in a list where everybody is in the past. */
  await test("a guest who has gone shows the dates they actually stayed", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-12, 2);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -11, end: -8, nights: 3, guest: "Gone Lastweek",
               src: "Direct", manual: true, pays: []});
    resv.push({fi, start: -3, end: 0, nights: 3, guest: "Gone Today",
               src: "Direct", manual: true, pays: []});
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .row.bk"), "the room sheet");
      const rowOf = n => [...document.querySelectorAll(".sheet.on .row.bk")]
        .find(x => x.textContent.includes(n));
      const older = rowOf("Gone Lastweek"), today = rowOf("Gone Today");
      ok(older && today, "the departed guests are not on the sheet");
      /* the arrow's two halves are the stay's own two ends, in order */
      eq(older.querySelector("em").textContent.split(" \u00b7 ")[0],
        `${fmt(-11)} \u2192 ${fmt(-8)}`, "the older stay's dates");
      eq(today.querySelector("em").textContent.split(" \u00b7 ")[0],
        `${fmt(-3)} \u2192 ${fmt(0)}`, "this morning's stay's dates");
      /* and the end date is not then printed a second time on the same line */
      const half = older.querySelector("em").textContent.split("\u2192")[1];
      eq((half.match(new RegExp(fmt(-8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length,
        1, "the end date is printed twice on one row");
      ok(/left this morning/.test(today.textContent), "the one who went today does not say so");
      ok(!/left this morning/.test(older.textContent), "a stay from last week says it left today");
      /* and the whole of it is readable — the row must not be clipped at
         "left this …", which loses the half that says how long ago */
      [older, today].forEach(row => {
        const em = row.querySelector("em");
        ok(em.scrollWidth <= em.clientWidth + 1,
          `"${em.textContent}" is clipped on the row`);
      });
      return `${fmt(-11)} \u2192 ${fmt(-8)}, once each, nothing clipped`;
    } finally {
      closeSheet();
      resv = keepR; recompute();
    }
  });

  /* "If someone is staying or checked in today it is still showing as coming
     up." They are not coming up; they are here. And the harder half of the
     same question — a room that turns over — has to show both guests without
     either pretending to be the other. */
  await test("a guest already in the flat is not listed as coming up", async () => {
    const keepR = resv.slice(), keepTurns = JSON.stringify(turns);
    const fi = freeFlat(-4, 8);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -3, end: 0, nights: 3, guest: "Went Today",
               src: "Direct", manual: true, pays: []});
    resv.push({fi, start: 0, end: 4, nights: 4, guest: "Here Tonight",
               src: "Direct", manual: true, pays: []});
    resv.push({fi, start: 5, end: 7, nights: 2, guest: "Later Guest",
               src: "Direct", manual: true, pays: []});
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .row.bk"), "the room sheet");
      const b = document.getElementById("sheetB");
      const sectionOf = name => {
        const row = [...b.querySelectorAll(".row.bk")].find(x => x.textContent.includes(name));
        if (!row) return null;
        let n = row.closest(".card").previousElementSibling;
        return n && n.querySelector(".lbl") ? n.querySelector(".lbl").textContent : null;
      };
      ok(/^In the flat now/.test(sectionOf("Here Tonight") || ""),
        `tonight's guest is under "${sectionOf("Here Tonight")}"`);
      ok(/^Coming up/.test(sectionOf("Later Guest") || ""),
        `a guest five days out is under "${sectionOf("Later Guest")}"`);
      ok(/^Just left/.test(sectionOf("Went Today") || ""),
        `the guest who went this morning is under "${sectionOf("Went Today")}"`);
      /* BOTH HALVES OF A TURNOVER DAY, on one screen, neither mislabelled */
      const txt = b.textContent;
      ok(txt.indexOf("Went Today") > 0 && txt.indexOf("Here Tonight") > 0,
        "one of the two halves of the turnover is missing");
      /* and the row says when they arrived, not the word "Now" */
      const inRow = [...b.querySelectorAll(".row.bk")].find(x => x.textContent.includes("Here Tonight"));
      ok(!/\bNow\b/.test(inRow.textContent), `the staying guest's row still says "${inRow.querySelector("em").textContent}"`);
      eq(inRow.querySelector("em").textContent.split(" · ")[0], `${fmt(0)} → ${fmt(4)}`,
        "the staying guest's own dates");
      /* the room's own state is stated once, as a route, not as a pill hanging
         off the person who left */
      const routes = [...b.querySelectorAll(".roomRoutes.stay button")];
      const clean = routes.find(x => /cleaned|being cleaned|ready for the next/.test(x.textContent));
      ok(clean, "a room somebody left this morning does not say whether it has been cleaned");
      eq(b.querySelectorAll(".justleft .pill.turn").length, 0,
        "the clean is also hanging off a guest's row");
      return `${sectionOf("Here Tonight")} / ${sectionOf("Later Guest")} / ${sectionOf("Went Today")}`;
    } finally {
      closeSheet();
      resv = keepR; recompute();
      turns = JSON.parse(keepTurns); turnSave();
    }
  });

  /* "Moving a coming up guest from one flat to another — the movement option
     used to show before. It is missing now." On 4 Sep the ⇄ was folded into the
     dates glyph, as a route at the foot of the editor, and the operator could
     not find it; a guest arriving today had lost it outright, because the
     route was tied to the editor's lock on their arrival rather than to the
     rule the move itself uses. */
  await test("the move is on a coming-up guest's row, and a guest arriving today keeps it", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-4, 10);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -3, end: 1, nights: 4, guest: "In Already",
               src: "Direct", manual: true, amount: 8000, pays: []});
    resv.push({fi, start: 1, end: 4, nights: 3, guest: "Due Later",
               src: "Direct", manual: true, amount: 9000, pays: []});
    recompute();
    const fi2 = freeFlat(-1, 6);
    ok(fi2 != null && fi2 !== fi, "no second flat for the guest arriving today");
    resv.push({fi: fi2, start: 0, end: 3, nights: 3, guest: "Arrives Today",
               src: "Direct", manual: true, pays: []});
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .rowdt"), "the room sheet");
      const rowOf = who => [...document.querySelectorAll(".sheet.on .row.bk")].find(x => x.textContent.includes(who));
      const later = rowOf("Due Later"), inRow = rowOf("In Already");
      ok(later && inRow, "the fixture rows are not on the sheet");
      const mv = later.querySelector(".rowsw");
      ok(mv, "the coming-up guest's row has no move glyph");
      eq(mv.getAttribute("aria-label"), "Move Due Later to another flat", "the move glyph's label");
      ok(later.querySelector(".rowdt"), "the dates glyph left the row when the move came back");
      /* THE RULE CHANGED ON 10 SEP. A guest already in used to have no move at
         all, because a move re-pointed the whole stay and would have rewritten
         where they had already slept. They move from tonight now, as a split
         — see splitMove — so the row carries the ⇄, and its label says which
         kind of move this is. */
      const inMv = inRow.querySelector(".rowsw");
      ok(inMv, "a guest already in has no move glyph — they move from tonight now");
      eq(inMv.getAttribute("aria-label"), "Move In Already to another flat from tonight", "the in-house move's label");
      /* four controls beside the name, and the line still reads */
      const em = later.querySelector("em");
      ok(em.scrollWidth <= em.clientWidth + 1, `"${em.textContent}" is clipped beside the controls`);
      ok(later.querySelector("b").getBoundingClientRect().width > 40, "the name has no room left");
      mv.click();
      await until(() => document.querySelector(".sheet.on .row.move, .sheet.on .movenote"), "the move picker");
      ok(/Move Due Later/.test(document.querySelector(".sheet .n").textContent),
        `the picker is not for the guest tapped: ${document.querySelector(".sheet .n").textContent}`);
      ok(document.querySelector(".sheet.on .row.move"), "nowhere offered for a three-night stay in a free book");
      /* the guest arriving today: arrival locked in the editor, and still movable */
      const today = resv.find(x => x.guest === "Arrives Today");
      openStayDates(today, () => {});
      await until(() => document.querySelector(".sheet.on .bkgo"), "the editor");
      ok(document.querySelector(".sheet.on .stepWide.locked"), "a guest arriving today can shift their arrival");
      const route = [...document.querySelectorAll(".sheet.on .roomRoutes.stay button")]
        .find(b => /Move Arrives Today/.test(b.textContent));
      ok(route, "a guest arriving today has no move route in the editor");
      /* and a guest already in has the route too, and it says the nights
         already slept stay where they were */
      const inAlready = resv.find(x => x.guest === "In Already");
      openStayDates(inAlready, () => {});
      await until(() => /In Already/.test(document.querySelector(".sheet .n").textContent), "the in-house editor");
      const inRoute = [...document.querySelectorAll(".sheet.on .roomRoutes.stay button")].find(b => /Move In Already/.test(b.textContent));
      ok(inRoute, "a guest already in has no move route in the editor");
      ok(/from tonight/.test(inRoute.textContent) && /already stayed/.test(inRoute.textContent),
        `the in-house route does not say what kind of move it is: "${inRoute.textContent}"`);
      return "⇄ on the row for Due Later and for In Already (from tonight); Arrives Today locked in place but movable";
    } finally {
      closeSheet();
      resv = keepR; recompute();
    }
  });

  /* A room nobody left today has no clean to report, and must not invent one. */
  await test("a room nobody left says nothing about cleaning", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-RECENT_OUT, 8);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: 2, end: 5, nights: 3, guest: "Future Only",
               src: "Direct", manual: true, pays: []});
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .row.bk"), "the room sheet");
      const t = document.getElementById("sheetB").textContent;
      ok(!/cleaned/.test(t), "a room with no departure is talking about cleaning");
      ok(!/In the flat now/.test(t), "an empty flat claims somebody is in it");
      return "no departure, no clean, no occupant";
    } finally { closeSheet(); resv = keepR; recompute(); }
  });

  /* "Just left — should be restricted to 2 records. What does 'just' mean
     here, 1 week, 10 days?" It is fourteen days, and a window nobody can see
     is one nobody can trust. */
  await test("just left shows two, says how long 'just' is, and hides no money", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-13, 2);
    ok(fi != null, "no flat free for the fixture");
    [[-12, -10, "Gone A", 4000], [-9, -7, "Gone B", 0], [-5, -3, "Gone C", 0],
     [-2, 0, "Gone D", 0]].forEach(([a, b, g, owed]) =>
      resv.push({fi, start: a, end: b, nights: b - a, guest: g, src: "Direct",
                 manual: true, amount: owed, pays: []}));
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .justleft"), "the room sheet");
      const b = document.getElementById("sheetB");
      const head = [...b.querySelectorAll(".sheet-s")]
        .find(n => /^Just left/.test(n.querySelector(".lbl").textContent));
      ok(head, "no Just left section");
      /* the count is all of them; the LIST is two */
      eq(head.querySelector(".lbl").textContent, "Just left · 4", "the heading counts every one");
      eq(head.querySelectorAll(".lbl")[1].textContent, `last ${RECENT_OUT} days`,
        "the window is not stated");
      const rows = [...b.querySelectorAll(".justleft .row.bk")];
      eq(rows.length, 2, `${rows.length} rows listed`);
      /* the two most recent, because that is what "just" means */
      ok(rows[0].textContent.includes("Gone D") && rows[1].textContent.includes("Gone C"),
        "the two shown are not the two most recent");
      /* and nothing with a rupee on it hides behind the fold */
      const more = b.querySelector(".justleft .rowMore");
      ok(more, "the ones not shown are not accounted for");
      ok(/2 more since/.test(more.textContent), `the line says "${more.textContent}"`);
      ok(/4,000/.test(more.textContent),
        `money owed by a hidden guest is not surfaced: "${more.textContent}"`);
      return `4 in ${RECENT_OUT} days, 2 shown, "${more.textContent}"`;
    } finally { closeSheet(); resv = keepR; recompute(); }
  });

  /* "Arriving symbol is wrong, should be opp." It was: both arrows pointed
     right and only the wall moved, so at 16px the two marks were the same
     mark. The wall is the flat and does not move; the arrow reverses. */
  await test("leaving and arriving point opposite ways from the same wall", () => {
    const read = kind => {
      const w = kindIcon(kind);
      w.style.cssText = "position:fixed;left:-999px;top:0";
      document.body.appendChild(w);
      const paths = [...w.querySelectorAll(".fly path")];
      const wall = w.querySelector(".room");
      const mid = p => { const b = p.getBBox(); return b.x + b.width / 2; };
      const out = { shaft: mid(paths[0]), head: mid(paths[1]),
                    wall: wall ? Math.round(wall.getBBox().x * 10) / 10 : null };
      w.remove();
      return out;
    };
    const o = read("out"), i = read("in");
    ok(o.head > o.shaft, `leaving's arrowhead is at ${o.head}, its shaft at ${o.shaft}`);
    ok(i.head < i.shaft, `arriving's arrowhead is at ${i.head}, its shaft at ${i.shaft}`);
    eq(i.wall, o.wall, "the wall moves between the two, so the arrow is not what differs");
    ok(o.wall != null, "neither mark has a wall to point away from or into");
    /* and the turnaround is neither of them */
    ok(KIND_SVG.turn !== KIND_SVG.out && KIND_SVG.turn !== KIND_SVG.in,
      "the turnaround is wearing one of the other two marks");
    return `wall at ${o.wall} in both · out →${o.head.toFixed(1)} · in ←${i.head.toFixed(1)}`;
  });

  /* What actually happens every morning is that somebody retypes this screen
     into a WhatsApp group, one group per building — which is where a flat gets
     left out and a check-in gets typed as a check-out. */
  await test("the day copies as a message a cleaning team can work from", async () => {
    const d = [0, 1, 2].find(x => { const o = dayOps(x);
      return o.turnovers.length && o.departures.length + o.arrivals.length > o.turnovers.length; });
    ok(d !== undefined, "no day with a turnover and something else in the fixture");
    const all = dayMessage(d, null);
    /* grouped by what the cleaner DOES, turnarounds first because those are
       the ones with somebody arriving behind them */
    ok(all.indexOf("Turnaround") < all.indexOf("Check-out")
       || all.indexOf("Check-out") === -1, "check-outs are listed above turnarounds");
    ok(/room[s]? to clean\.$/.test(all.trim()), `it does not end with the count: "${all.slice(-40)}"`);
    /* only rooms somebody LEFT need cleaning — an arrival into an empty room
       is not a clean, and the number has to be the one they can plan around */
    const ops = dayOps(d);
    const jobs = turnJobs(d).length;
    ok(all.includes(`${jobs} room${jobs === 1 ? "" : "s"} to clean.`),
      `the count says something other than ${jobs}: "${all.slice(-40)}"`);
    /* every flat that moves is named, none twice */
    const moved = new Set([...ops.departures, ...ops.arrivals].map(r => flats[r.fi].id));
    [...moved].forEach(id => ok(all.includes(id), `${id} moves today and is not in the message`));
    ops.turnovers.forEach(t => {
      const n = (all.match(new RegExp("• " + flats[t.fi].id + " ", "g")) || []).length;
      eq(n, 1, `${flats[t.fi].id} is listed ${n} times — a turnover is one job, not two`);
    });
    /* ONE BUILDING PER GROUP, which is the whole reason the chips are there */
    const code = flats[ops.departures[0].fi].code;
    const one = dayMessage(d, code);
    const others = [...new Set(flats.filter(f => f.code !== code).map(f => f.id))];
    eq(others.filter(id => new RegExp("• " + id + "\\b").test(one)).length, 0,
      "a building's message names flats from another building");
    ok(one.includes((buildingsOf().find(b => b.code === code) || {}).name),
      "the message does not name the building it is for");
    /* on All, each line says where it is — otherwise it is five codes from
       five places under one heading and no group can use it */
    ops.departures.forEach(r => ok(all.includes(flats[r.fi].bshort),
      `${flats[r.fi].id} is listed without saying which building it is in`));
    /* AND IT IS A PLACE, NOT A BANNER. Sending the day is occasional, so the
       control is a glyph in the header at the size of the close button beside
       it — it shipped once as a full-width two-line panel above the list and
       the owner circled it. */
    openDay(d);
    await until(() => document.querySelector(".sheet.on .daycopy"), "the copy button");
    const cp = document.querySelector(".sheet.on .daycopy");
    const shut = [...document.querySelectorAll(".sheet-h button")]
      .find(b => b.getAttribute("aria-label") === "Close");
    const cr = cp.getBoundingClientRect(), sr = shut.getBoundingClientRect();
    ok(cr.width <= sr.width + 2 && cr.height <= sr.height + 2,
      `the copy control is ${Math.round(cr.width)}\u00d7${Math.round(cr.height)} `
      + `against a close button of ${Math.round(sr.width)}\u00d7${Math.round(sr.height)}`);
    ok(cr.width >= 28 && cr.height >= 28,
      `${Math.round(cr.width)}\u00d7${Math.round(cr.height)} is too small to hit`);
    /* beside the chips that decide who the message is for, and not in the
       header — where a third control on the title row wrapped the date */
    ok(cp.parentElement.querySelector(".roomfilt"), "the copy control has left the chip row");
    const title = document.querySelector(".sheet-h .n");
    ok(title.getBoundingClientRect().height < parseFloat(getComputedStyle(title).fontSize) * 1.7,
      `the sheet title is wrapping: ${Math.round(title.getBoundingClientRect().height)}px`);
    ok(!cp.textContent.trim(), `the glyph carries the words "${cp.textContent.trim()}"`);
    ok((cp.getAttribute("aria-label") || "").length > 20,
      "an icon-only button with no label anybody can read");
    closeSheet();
    return one.split("\n")[0] + " · " + jobs + " to clean";
  });

  /* A day with nothing on it must not send an empty message that reads as a
     failure to load. */
  await test("a quiet day says so rather than sending an empty list", () => {
    const quiet = [];
    for (let x = 0; x < DAYS; x++) if (!dayOps(x).departures.length
        && !dayOps(x).arrivals.length) { quiet.push(x); break; }
    if (!quiet.length) return "no empty day in the fixture";
    const m = dayMessage(quiet[0], null);
    ok(/Nothing moves/.test(m), `an empty day copies as "${m}"`);
    ok(!/•/.test(m), "an empty day copies with bullets in it");
    return m.split("\n").pop();
  });

  /* "Same data twice — is this okay?" The card at the top of the room sheet
     reads "Sumit · night 2 of 7" and the row underneath read "8 Sep → 15 Sep ·
     7n · Airbnb" with a "7n" pill beside it: the number 7 three times on one
     screen, for one guest. */
  await test("a staying guest's night count is stated once, not three times", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-2, 12);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -1, end: 6, nights: 7, guest: "Counted Once",
               src: "Airbnb", manual: true, pays: []});
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .row.bk"), "the room sheet");
      const b = document.getElementById("sheetB");
      const row = [...b.querySelectorAll(".row.bk")].find(x => x.textContent.includes("Counted Once"));
      ok(row, "the staying guest is not on the sheet");
      /* THE CARD KEEPS IT, because how far through a stay somebody is, is the
         one thing only the card can say. */
      ok(/night 2 of 7/.test(nightStory(fi, 0)),
        `the card reads "${nightStory(fi, 0)}"`);
      /* the row keeps the dates and the source, and drops the count */
      const em = row.querySelector("em").textContent;
      ok(/Airbnb/.test(em), `the row lost the source: "${em}"`);
      ok(/→/.test(em), `the row lost its dates: "${em}"`);
      ok(!/7n/.test(em), `the row still repeats the count: "${em}"`);
      /* and the money slot says money or nothing — never the sentence again.
         NOT a digit count over textContent: the DOM concatenates without
         spaces, so "of 7" runs into "Today" and \b stops matching — which is
         how this assertion first failed against an app that was correct. */
      const pill = row.querySelector(".rowend .pill");
      ok(!pill, `the money slot fell back to a pill reading "${pill && pill.textContent}"`);
      return "card says how far through, row says when and from where";
    } finally { closeSheet(); resv = keepR; recompute(); }
  });

  /* A stay WITH money keeps its pill — that is the slot doing its actual job,
     and it is also the button for taking the payment. */
  await test("a stay that is owed money still says so on its row", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-2, 12);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: 2, end: 5, nights: 3, guest: "Owes Money",
               src: "Direct", manual: true, amount: 9000, pays: []});
    recompute();
    try {
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .row.bk"), "the room sheet");
      const row = [...document.querySelectorAll(".sheet.on .row.bk")]
        .find(x => x.textContent.includes("Owes Money"));
      const pill = row.querySelector(".rowend .paid, .rowend .pill");
      ok(pill, "a stay with money owed has no money pill");
      ok(/9,000|payout/.test(pill.textContent), `the pill says "${pill.textContent}"`);
      /* a guest not yet in still gets the night count, because no card is
         telling anybody how far through a stay that has not started is */
      ok(/3n/.test(row.querySelector("em").textContent),
        "a future stay lost its night count as well");
      return `${pill.textContent} kept, 3n kept on a future stay`;
    } finally { closeSheet(); resv = keepR; recompute(); }
  });

  /* ══ one phone, two seats ════════════════════════════════════════════════ */

  /* The owner signed in as staff and back as himself on the same phone and the
     app was left wrong. The shell could ENTER staff mode from three places and
     leave it from exactly one, and a staff session replaces `flats` with one
     building and empties `resv` — so anything that ended the session without
     going through the full sign-out handed the next person a cleaner's app
     with nobody's data in it. */
  const stubStaff = () => async (path) => {
    if (/token\?grant_type=password/.test(path))
      return {access_token: "t", refresh_token: "r", expires_in: 3600, user: {id: "u1"}};
    if (/memberships/.test(path))
      return [{host_id: "h1", role: "staff", building_ids: ["b1"], hosts: {name: "Crescent Stays"}}];
    if (/rpc\/staff_flats/.test(path))
      return [{id: "f1", code: "ZZ-1", unit_type: "1 BHK", building_id: "b1", building: "Zed"}];
    if (/rpc\/staff_day/.test(path))
      return [{flat_id: "f1", flat_code: "ZZ-1", unit_type: "1 BHK", building_id: "b1",
               building: "Zed", checking_out: true, checking_in: false}];
    return [];
  };
  const seatSnap = () => ({
    role: myRole(),
    staffmode: document.documentElement.classList.contains("staffmode"),
    tabbar: !document.getElementById("tabbar").hidden,
    on: [...document.querySelectorAll(".screen.on")].map(s => s.id).join(","),
    NF, stays: resv.length,
  });
  const restoreSeat = (k) => {
    resv = k.resv; flats = k.flats; NF = flats.length; issues = k.issues;
    queue = k.queue; MODE = k.MODE; hostId = k.hostId; session = k.session;
    me = k.me; usingDemo = k.usingDemo; staffBook = null;
    flatIndex = Object.fromEntries(flats.map((f, i) => [f.id, i]));
    turns = JSON.parse(k.turns); turnSave();
    if (k.store != null) localStorage.setItem(STORE, k.store); else jdel(STORE);
    if (k.cloud != null) localStorage.setItem(CLOUD_KEY, k.cloud); else jdel(CLOUD_KEY);
    jset(QUEUE_KEY, queue);
    applySeat(); recompute();
  };
  const holdSeat = () => ({
    resv: resv.slice(), flats: flats.slice(), issues: issues.slice(),
    queue: queue.slice(), MODE, hostId, session, me, usingDemo,
    turns: JSON.stringify(turns),
    store: localStorage.getItem(STORE), cloud: localStorage.getItem(CLOUD_KEY),
  });

  /* THE ONE THE OWNER HIT. A silent sign-out is what an expired token fires,
     and a token expires the moment the server cannot be reached — so a
     cleaner's phone losing its connection used to hand back an app showing one
     building, no bookings, and the word "Demo data", with the real book in
     storage one call away. */
  await test("a silent sign-out puts the book back, not just a quiet one", async () => {
    const keep = holdSeat();
    const realApi = window.api;
    try {
      const wasNF = NF, wasStays = bookings().length;
      ok(wasStays > 10, "the fixture book is too small to prove anything");
      window.api = stubStaff();
      await signIn("tt@x.z", "pw");
      const asStaff = seatSnap();
      eq(asStaff.NF, 1, "the cleaner should be holding one building's flats");
      eq(asStaff.stays, 0, "a cleaner's phone is holding stays");
      /* the token dies — no toast, no tap, exactly what a dead network does */
      signOut(true);
      const after = seatSnap();
      eq(after.NF, wasNF, `${after.NF} flats after a silent sign-out, was ${wasNF}`);
      eq(bookings().length, wasStays, `${bookings().length} bookings after, was ${wasStays}`);
      ok(!after.staffmode, "the cleaner's shell survived the sign-out");
      ok(after.tabbar, "the four tabs are still hidden");
      return `${wasNF} flats and ${wasStays} bookings restored without a word`;
    } finally { window.api = realApi; restoreSeat(keep); }
  });

  /* The shell had one way in and one way out, and they were not the same set
     of doors. This is the invariant that makes them one. */
  await test("the seat decides the shell, whichever way the seat changed", async () => {
    const keep = holdSeat();
    try {
      me = {role: "staff", buildings: ["b1"]}; MODE = "live";
      applySeat();
      ok(document.documentElement.classList.contains("staffmode"), "staff did not get the staff shell");
      eq(document.getElementById("tabbar").hidden, true, "staff can still see the four tabs");
      /* the seat changes without a sign-out — a re-read of the membership, a
         cache restored from another session, anything */
      me = {role: "owner", buildings: null};
      applySeat();
      ok(!document.documentElement.classList.contains("staffmode"),
        "the owner is still in the cleaner's shell");
      eq(document.getElementById("tabbar").hidden, false, "the owner's tabs did not come back");
      ok(document.getElementById("scr-" + SCREENS[curScreen].id).classList.contains("on"),
        "no screen is showing");
      ok(!document.getElementById("scr-staff").classList.contains("on"),
        "the cleaner's screen is still on show");
      eq(staffBook, null, "the cleaner's day is still on the owner's phone");
      /* and it is idempotent, because it is called from every refresh */
      applySeat(); applySeat();
      ok(!document.documentElement.classList.contains("staffmode"), "applySeat is not idempotent");
      return "staff → shell, owner → tabs, both ways, repeatable";
    } finally { restoreSeat(keep); }
  });

  /* Turnaround records are the cleaners' work, not a property of the session
     that happened to be open. `turns = {}` on every sign-out wiped the owner's
     own cleaning record for a session that had nothing to do with it. */
  await test("signing out does not erase the cleaning record", async () => {
    const keep = holdSeat();
    const realApi = window.api;
    try {
      const fi = flats.map((f, i) => i).find(i => freeSpan(i, 0, 2));
      turnSet(fi, 0, {state: "ready", ready: new Date().toISOString()});
      const had = Object.keys(turns).length;
      ok(had > 0, "the fixture job was not recorded");
      window.api = stubStaff();
      await signIn("tt@x.z", "pw");
      signOut(false);
      ok(Object.keys(turns).length >= 1 || jget(TURN_STORE),
        "signing out wiped every turnaround this phone knew about");
      return `${had} job${had === 1 ? "" : "s"} kept across a sign-out`;
    } finally { window.api = realApi; restoreSeat(keep); }
  });

  /* The cleaning went UP from the day it shipped and was never fetched back,
     so a manager watched "to clean" while the cleaner's phone showed done. */
  await test("the manager's pull brings the cleaning down as well as up", () => {
    const src = cloudPull.toString();
    ok(/\/turnarounds\?/.test(src), "cloudPull does not read turnarounds");
    ok(/\/turn_checks\?/.test(src), "cloudPull does not read the ticks");
    ok(/\/check_items\?/.test(src), "cloudPull does not read the checklist");
    /* and it maps them into the same shape a cleaner's phone builds, or a tick
       made on one is unreadable on the other */
    ok(/turns\[flats\[fi2\]\.id \+ "\|" \+ t\.day\]/.test(src),
      "cloudPull keys turnarounds differently from staffPull");
    return "turnarounds, ticks and the list all come down";
  });


  /* The owner could not sign in, and the app said "check your signal" to a
     phone whose signal was fine — its router was answering the project's own
     hostname with the wrong address, so every other site worked and this one
     alone did not. The next guess after "check your signal" is "my password is
     wrong", which sends somebody resetting a password that was never the
     problem. */
  await test("a sign-in that cannot reach the server does not blame the password", async () => {
    const gate = document.getElementById("gate"), errB = document.getElementById("gateErr");
    const form = document.getElementById("gateForm");
    const em = document.getElementById("gateEmail"), pw = document.getElementById("gatePass");
    const keepMode = MODE, keepSess = session, keepOnline = online;
    const realApi = window.api;
    const wasE = em.value, wasP = pw.value;
    const onlineDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    const setOnline = v => Object.defineProperty(navigator, "onLine",
      {configurable: true, get: () => v});
    const submit = async () => {
      errB.textContent = "";
      form.dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));
      await until(() => errB.textContent.trim(), "an error on the gate", 4000);
      return errB.textContent.trim();
    };
    try {
      em.value = "someone@example.com"; pw.value = "whatever";

      /* 1. the request never gets an answer, and the phone believes it is
            online — a blocked or misdirected host, not a dead signal */
      setOnline(true);
      window.api = async () => { throw new TypeError("Failed to fetch"); };
      const unreachable = await submit();
      ok(!/signal/i.test(unreachable), `it still blames the signal: "${unreachable}"`);
      ok(!/password did not match/i.test(unreachable),
        `it blamed the password for a network failure: "${unreachable}"`);
      ok(/not your password/i.test(unreachable) && /mobile data|wifi/i.test(unreachable),
        `it does not say what to try: "${unreachable}"`);

      /* 2. genuinely offline — then "check your signal" is the right advice */
      setOnline(false);
      const offline = await submit();
      ok(/signal/i.test(offline), `a phone with no connection is told: "${offline}"`);

      /* 3. and a real refusal is still a real refusal */
      setOnline(true);
      window.api = async () => { const e = new Error("Invalid login credentials"); e.status = 400; throw e; };
      const wrong = await submit();
      ok(/did not match/i.test(wrong), `a wrong password is reported as: "${wrong}"`);
      return "unreachable, offline and refused all say different things";
    } finally {
      window.api = realApi;
      if (onlineDesc) Object.defineProperty(Navigator.prototype, "onLine", onlineDesc);
      try { delete navigator.onLine; } catch (e) { }
      em.value = wasE; pw.value = wasP; errB.textContent = "";
      MODE = keepMode; session = keepSess; online = keepOnline;
      gate.classList.remove("on");
      document.querySelectorAll(".toast").forEach(t => t.remove());
    }
  });

  /* 23,717 rows of "Priya Fixture" and "filler 317" reached the operator's
     telemetry table against 72 real ones, because every test that books or
     pays calls logAct, logAct calls track, and nothing ever turned it off. */
  await test("the suite does not post its own fixtures to the server", () => {
    ok(telOff, "telemetry is live while the tests are running");
    ok(!telOn(), "telOn() still says yes with the suite's switch thrown");
    /* and the app itself refuses an activity event nobody could ever read —
       pullActivity asks for host_id=eq.<host>, so a row without one is
       invisible to every phone including the one that wrote it */
    const wasOff = telOff, wasHost = hostId, wasQ = telQueue.length;
    try {
      telOff = false; hostId = null;
      track("act", {k: "book", s: "unreadable row"});
      eq(telQueue.length, wasQ, "an activity event with no host was queued to go up");
      hostId = "h-test";
      track("act", {k: "book", s: "readable row"});
      eq(telQueue.length, wasQ + 1, "an activity event WITH a host was dropped");
      telQueue.length = wasQ;
      /* a crash still goes up without a host — nobody reads those in the app,
         the whole point of them is that they arrive at all */
      hostId = null;
      track("error", {m: "boom"});
      eq(telQueue.length, wasQ + 1, "a crash report was dropped for having no host");
      telQueue.length = wasQ;
    } finally { telOff = wasOff; hostId = wasHost; }
    return "off during the run, and act needs a host even when on";
  });

  /* "Turnaround should be gone after 2 PM, and see only who checked in today."
     chg marks the night that is both a check-out and a first night, and the
     tile said "Turnaround" for the whole of it — at nine in the evening, with
     the new guest asleep inside, the grid still read as a room between guests. */
  await test("a turnaround is a morning: the tile reads as the new guest after check-in time", async () => {
    const keepR = resv.slice(), realClock = pastCheckin;
    const fi = freeFlat(-3, 6);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -2, end: 0, nights: 2, guest: "Leaving Today", src: "Direct", manual: true, pays: []});
    resv.push({fi, start: 0, end: 3, nights: 3, guest: "Arriving Today", src: "Airbnb", manual: true, pays: []});
    resv.push({fi, start: 3, end: 4, nights: 1, guest: "Turn Tomorrow", src: "Direct", manual: true, pays: []});
    recompute();
    try {
      ok(chg[fi][0] === 1, "the fixture is not a same-day turnaround");
      const note = t => t.querySelector("s").textContent;
      /* ten in the morning: the room is between guests and the tile says so */
      pastCheckin = () => false;
      let t = roomTile(fi, 0, 1);
      eq(note(t), "Turnaround", "before check-in the tile should still say Turnaround");
      ok(t.classList.contains("turn"), "before check-in the tile lost the turnaround fill");
      ok(!t.querySelector(".fresh"), "a room still turning over is marked as a new arrival");
      /* four in the afternoon: the new guest is in, and is marked as new */
      pastCheckin = () => true;
      t = roomTile(fi, 0, 1);
      eq(note(t), "Arriving Today", `after check-in the tile reads "${note(t)}"`);
      ok(!t.classList.contains("turn"), "after check-in the tile still wears the turnaround fill");
      ok(t.querySelector(".fresh"), "the guest who arrived today carries no mark");
      ok(/checked in today/.test(t.getAttribute("aria-label")), `aria: ${t.getAttribute("aria-label")}`);
      /* a same-day changeover on a FUTURE day is a plan, not a state — the
         clock has nothing to say about it */
      const f = roomTile(fi, 3, 1);
      eq(note(f), "Turnaround", `a future turnaround reads "${note(f)}" after check-in time`);
      ok(!f.querySelector(".fresh"), "a future day is marked as a fresh arrival");
      return "Turnaround until 14:00, then the new guest with a dot; tomorrow untouched";
    } finally {
      pastCheckin = realClock;
      resv = keepR; recompute();
    }
  });

  /* The dot is for the guest whose first night is tonight — not for anybody
     who happens to be in. */
  await test("only the guest who arrived today is marked as new", async () => {
    const keepR = resv.slice(), realClock = pastCheckin;
    const fi = freeFlat(-9, 6);
    ok(fi != null, "no flat free for the fixture");
    resv.push({fi, start: -8, end: 2, nights: 10, guest: "Night Nine", src: "Direct", manual: true, pays: []});
    recompute();
    try {
      pastCheckin = () => true;
      const t = roomTile(fi, 0, 1);
      eq(t.querySelector("s").textContent, "Night Nine", "a guest on night nine lost their name");
      ok(!t.querySelector(".fresh"), "a guest on night nine is marked as having arrived today");
      ok(!/checked in today/.test(t.getAttribute("aria-label")), "aria claims a night-nine guest checked in today");
      /* and the dot never shares a tile with the orphan flag: one lives on
         free rooms, the other on booked ones */
      const bothDots = [...document.querySelectorAll(".tile")]
        .filter(x => x.querySelector(".flag") && x.querySelector(".fresh")).length;
      eq(bothDots, 0, "a tile carries both the orphan flag and the new-arrival dot");
      return "night nine: name, no dot";
    } finally { pastCheckin = realClock; resv = keepR; recompute(); }
  });

  /* ══ money at the door, and a guest who moves mid-stay ═══════════════════ */

  /* The arriving rows said "₹8,400 on arrival" in grey italics: a fact to
     read, three taps from the form that records it. */
  await test("the day view collects at the door: the amount is the pill, and it opens the payment", async () => {
    const keepR = resv.slice();
    const fi = freeFlat(-1, 6), fj = flats.map((f, i) => i).find(i => i !== fi && freeSpan(i, -3, 6) && pastClear(i, -3));
    ok(fi != null && fj != null, "no two flats free for the fixture");
    resv.push({fi, start: 0, end: 3, nights: 3, guest: "Owes At Door", src: "Direct", manual: true, amount: 9000, pays: []});
    resv.push({fi: fj, start: -2, end: 0, nights: 2, guest: "Out First", src: "Direct", manual: true, pays: []});
    resv.push({fi: fj, start: 0, end: 2, nights: 2, guest: "In Behind", src: "Direct", manual: true, amount: 6000, pays: []});
    recompute();
    try {
      openDay(0);
      await until(() => document.querySelector(".sheet.on .dayrows .row"), "the day view");
      const rowOf = n => [...document.querySelectorAll(".sheet.on .dayrows .row")].find(x => x.textContent.includes(n));
      const arr = rowOf("Owes At Door"), turn = rowOf("In Behind");
      ok(arr && turn, "the fixture rows are not on the day view");
      /* the amount is a control, said once */
      const pill = arr.querySelector(".paid.due");
      ok(pill, "an arriving guest who owes has no amber pill");
      eq(pill.textContent, money(9000), "the pill does not say the amount");
      ok(!/on arrival/.test(arr.querySelector("em").textContent), "the sentence still repeats the amount");
      /* a turnover row carries both the money and the clean */
      ok(turn.querySelector(".paid.due"), "the arriving half of a turnover has no collect pill");
      ok(turn.querySelector(".pill.turn"), "the turnover lost its clean pill");
      /* and the pill is the door to the payment, for that guest, back to here */
      pill.click();
      await until(() => /due$/.test((document.querySelector(".sheet.on .n") || {}).textContent || ""), "the payment form");
      ok(document.querySelector(".sheet.on .m").textContent.includes("Owes At Door"), "the form opened for somebody else");
      document.querySelector(".sheet-h button[aria-label='Back']").click();
      await until(() => document.querySelector(".sheet.on .dayrows"), "back to the day view");
      return "amount is the pill · opens payment · returns to the day";
    } finally { closeSheet(); resv = keepR; recompute(); }
  });

  /* A guest who has just paid is standing there, and what they get is a
     WhatsApp message typed from memory. */
  await test("a payment can be copied as a receipt for the guest", async () => {
    const keepR = resv.slice(), keepAct = activity.slice(), realCopy = window.copyText;
    const fi = freeFlat(-4, 4);
    ok(fi != null, "no flat free for the fixture");
    const r = {fi, start: -2, end: 2, nights: 4, guest: "Receipt Guest", src: "Direct", manual: true, amount: 12000, pays: []};
    resv.push(r); recompute();
    let copied = null;
    try {
      window.copyText = async t => { copied = t; return true; };
      openPayment(r, fi, 0, () => closeSheet());
      await until(() => document.querySelector(".sheet.on .bkgo"), "the payment form");
      const amt = document.querySelector(".sheet.on input");
      amt.value = "5000"; amt.dispatchEvent(new Event("input"));
      document.querySelector(".sheet.on .bkgo").click();
      await until(() => [...document.querySelectorAll(".toast button")].some(b => /receipt/i.test(b.textContent)), "the receipt button on the toast");
      const t = [...document.querySelectorAll(".toast")].find(x => /recorded/.test(x.textContent));
      ok(/5,000 recorded/.test(t.textContent), `the toast says "${t.textContent.slice(0, 60)}"`);
      ok(/7,000 still due/.test(t.textContent), "the toast does not say what is left");
      [...t.querySelectorAll("button")].find(b => /receipt/i.test(b.textContent)).click();
      await until(() => copied != null, "the receipt to be copied");
      ok(/Receipt Guest/.test(copied), "the receipt does not name the guest");
      ok(new RegExp(flats[fi].id).test(copied), "the receipt does not name the flat");
      ok(/Received: ₹5,000 · UPI|Received: ₹5,000 · Cash|Received: ₹5,000/.test(copied), `received line: ${copied}`);
      ok(/Balance: ₹7,000/.test(copied), "the receipt does not say the balance");
      ok(!/\d{10}/.test(copied), "a phone number is in a message that goes to the guest");
      return copied.split("\n")[0] + " … " + copied.split("\n").find(l => /Balance/.test(l));
    } finally {
      window.copyText = realCopy;
      closeSheet(); document.querySelectorAll(".toast").forEach(x => x.remove());
      resv = keepR; recompute();
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* The day somebody arrives is the day the balance is collected, and the
     tile is what the operator is looking at when they walk in. */
  await test("a guest arriving today with money owed says so on their tile", async () => {
    const keepR = resv.slice(), realClock = pastCheckin;
    const fi = freeFlat(-1, 6), fj = flats.map((f, i) => i).find(i => i !== fi && freeSpan(i, 0, 6) && pastClear(i, -1));
    ok(fi != null && fj != null, "no two flats free for the fixture");
    resv.push({fi, start: 0, end: 3, nights: 3, guest: "Owes Tile", src: "Direct", manual: true, amount: 16800, pays: []});
    resv.push({fi: fj, start: 0, end: 3, nights: 3, guest: "Settled Tile", src: "Direct", manual: true, amount: 9000,
               pays: [{id: "p1", amount: 9000, method: "UPI", on: 0}]});
    recompute();
    try {
      pastCheckin = () => true;
      const a = roomTile(fi, 0, 1), b = roomTile(fj, 0, 1);
      const owed = a.querySelector("em.owed");
      ok(owed, "the owing arrival's tile carries no amount");
      eq(owed.textContent, moneyShort(16800), `the corner says "${owed.textContent}"`);
      ok(!a.querySelector(".fresh"), "the owing tile carries the dot as well as the amount");
      ok(/16,800 due/.test(a.getAttribute("aria-label")), `aria: ${a.getAttribute("aria-label")}`);
      ok(b.querySelector(".fresh") && !b.querySelector("em.owed"), "a settled arrival should carry the dot and no amount");
      /* and the amount does not run into the room number. Measured against
         the TEXT of the room number, not its box: the <b> is a block the width
         of the tile, so its right edge is always past the amount and says
         nothing about whether the glyphs collide. */
      document.body.appendChild(a); a.style.cssText = "position:fixed;left:-9999px;width:105px";
      const rng = document.createRange(); rng.selectNodeContents(a.querySelector("b"));
      const nb = rng.getBoundingClientRect(), no = owed.getBoundingClientRect();
      ok(no.left >= nb.right + 4, `the amount (${Math.round(no.left)}) runs into the room number's text (ends ${Math.round(nb.right)})`);
      a.remove();
      return `${owed.textContent} in the corner, dot on the settled one`;
    } finally { pastCheckin = realClock; resv = keepR; recompute(); }
  });

  /* "Why does G02's guest have no room swap and TT-302's does?" Because a
     move re-pointed the whole stay. A guest already in gets a split now:
     the nights slept stay where they were slept, the stay moves from tonight
     with its id, its total and every payment. */
  await test("a guest already in the flat moves from tonight, and the nights already slept stay put", async () => {
    const keepR = resv.slice(), keepAct = activity.slice(), keepQ = queue.slice(), keepMode = MODE;
    const fi = freeFlat(-4, 6);
    const to = flats.map((f, i) => i).find(i => i !== fi && flats[i].type === flats[fi].type && freeSpan(i, 0, 6));
    ok(fi != null && to != null, "no two flats free for the fixture");
    const r = {fi, start: -3, end: 4, nights: 7, guest: "Mid Stay", src: "Direct", manual: true, amount: 21000,
               pays: [{id: "pm1", amount: 9000, method: "UPI", on: -3}], sid: "sid-mid-stay", phone: "9000000000"};
    resv.push(r); recompute();
    try {
      /* the picker no longer turns them away, and the room's row offers the ⇄ */
      ok(whereCouldGo(r).same.length + whereCouldGo(r).smaller.length > 0, "an in-house guest is still refused a room to move to");
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .row.bk"), "the room sheet");
      const row = [...document.querySelectorAll(".sheet.on .row.bk")].find(x => x.textContent.includes("Mid Stay"));
      const sw = row.querySelector(".rowsw");
      ok(sw, "a guest already in has no ⇄ on their row");
      ok(/from tonight/.test(sw.getAttribute("aria-label")), `the ⇄ does not say from tonight: ${sw.getAttribute("aria-label")}`);
      closeSheet();

      MODE = "live"; queue.length = 0;
      const res = moveBooking(r, to);
      ok(res && res.split, "the move did not happen as a split");
      /* the stay: new flat, from tonight, everything that matters intact */
      eq(r.fi, to, "the stay did not move");
      eq(r.start, 0, "the stay does not start tonight");
      eq(r.nights, 4, "the nights ahead");
      eq(r.end, 4, "the end moved");
      eq(r.amount, 21000, "the total did not follow the guest");
      eq(r.pays.length, 1, "the payment did not follow the guest");
      eq(dueFrom(r), 12000, "what is owed changed");
      eq(r.sid, "sid-mid-stay", "the stay lost its id");
      /* the history: the nights slept, where they were slept, and no money */
      const hist = resv.find(x => x.fi === fi && x.guest === "Mid Stay" && x.movedTo);
      ok(hist, "no segment was left on the old flat");
      eq(hist.start, -3, "the segment's start"); eq(hist.end, 0, "the segment ends this morning");
      eq(hist.nights, 3, "the nights already slept");
      eq((hist.pays || []).length, 0, "money was left on the history segment");
      ok(!hist.amount, "a total was left on the history segment");
      eq(hist.movedTo, flats[to].id, "the segment does not say where they went");
      /* the book: old flat free tonight, new flat taken */
      eq(occ[fi][0], 0, "the old flat is still held tonight");
      eq(occ[to][0], 1, "the new flat is not held tonight");
      eq(occ[fi][-1 + 0] === undefined ? 1 : 1, 1);
      /* on the wire: the stay moves first, then the segment is inserted */
      const ops = queue.map(o => o.k);
      eq(ops.indexOf("stay~") >= 0 && ops.indexOf("stay+") > ops.indexOf("stay~"), true, `queued as ${ops.join(",")}`);
      const patch = queue.find(o => o.k === "stay~");
      eq(patch.body.flat_id, flats[to].uid, "the PATCH points at the wrong flat");
      eq(patch.body.starts_on, dayISO(0), "the PATCH does not move the start to tonight");
      const ins = queue.find(o => o.k === "stay+");
      eq(ins.body.starts_on, dayISO(-3), "the segment's start on the wire"); eq(ins.body.ends_on, dayISO(0), "the segment's end on the wire");
      eq(ins.body.amount, null, "the segment carries a total on the wire");
      ok(/^Moved to /.test(ins.body.note), "the segment's note does not carry where they went, which is how a pull reads it back");
      ok(/from tonight/.test(activity[0].s), `not logged: ${activity[0].s}`);

      /* the old flat's Just left names them, says where they went, and does
         not offer to keep them on */
      openSheet(fi, 0);
      await until(() => document.querySelector(".sheet.on .justleft"), "the old flat's sheet");
      const jl = [...document.querySelectorAll(".sheet.on .justleft .row.bk")].find(x => x.textContent.includes("Mid Stay"));
      ok(jl, "the segment is not in the old flat's Just left");
      ok(new RegExp("moved to " + flats[to].id).test(jl.textContent), `the row says "${jl.querySelector("em").textContent}"`);
      ok(!jl.querySelector(".rowdt"), "a history segment is offered a dates editor");
      ok(!/Extend Mid Stay/.test(document.getElementById("sheetB").textContent), "the band offers to extend a guest who is in another flat");
      closeSheet();
      return `${flats[fi].id} keeps 3 nights, ${flats[to].id} takes 4 with ₹12,000 still due`;
    } finally {
      closeSheet(); MODE = keepMode; queue.length = 0; keepQ.forEach(o => queue.push(o)); jset(QUEUE_KEY, queue);
      resv = keepR; recompute();
      activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity);
    }
  });

  /* A refused split changes nothing at all. */
  await test("a mid-stay move to a flat that is not free is refused whole", () => {
    const keepR = resv.slice(), keepAct = activity.slice();
    const fi = freeFlat(-4, 6);
    const busy = flats.map((f, i) => i).find(i => i !== fi && resv.some(x => x.fi === i && x.start <= 1 && x.end > 1));
    ok(fi != null && busy != null, "no busy flat to be refused by");
    const r = {fi, start: -3, end: 4, nights: 7, guest: "Refused Mover", src: "Direct", manual: true, amount: 7000, pays: []};
    resv.push(r); recompute();
    try {
      const n = resv.length;
      eq(moveBooking(r, busy), false, "a move into a held flat was accepted");
      eq(r.fi, fi, "the stay moved anyway"); eq(r.start, -3, "the start changed anyway");
      eq(resv.length, n, "a segment was left behind by a refused move");
      ok(/Could not move/.test(activity[0].s), "the refusal is not logged");
      return "refused, and nothing moved";
    } finally { resv = keepR; recompute(); activity.length = 0; keepAct.forEach(a => activity.push(a)); jset(LOG_STORE, activity); }
  });

  /* The two markers have to outlive a reload, or the old flat offers to
     extend a guest who is in another room the next morning. */
  await test("a move's history segment is still marked after a reload", () => {
    const keepR = resv.slice(), stored = localStorage.getItem(STORE), keepDemo = usingDemo;
    const fi = freeFlat(-4, 6);
    resv.push({fi, start: -3, end: 0, nights: 3, guest: "Segment Guest", src: "Direct", manual: true, pays: [], movedTo: "ZZ-9"});
    recompute();
    try {
      usingDemo = false; save();
      const raw = JSON.parse(localStorage.getItem(STORE));
      const row = raw.rows.find(x => x.guest === "Segment Guest");
      eq(row && row.movedTo, "ZZ-9", "movedTo is not written to the store");
      resv = []; recompute();
      ok(load(), "the store did not load back");
      const back = resv.find(x => x.guest === "Segment Guest");
      eq(back && back.movedTo, "ZZ-9", "movedTo did not survive the reload");
      return "movedTo written and read back";
    } finally {
      resv = keepR; recompute(); usingDemo = keepDemo;
      if (stored != null) localStorage.setItem(STORE, stored); else jdel(STORE);
    }
  });

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
  } finally { telOff = telWas; }
}
