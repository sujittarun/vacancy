/* Regression suite — every bug that has been fixed, encoded as the repro that
 * found it.
 *
 *   await import('/selftest.js').then(m => m.run())
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
  } catch (e) {
    results.push({ name, pass: false, detail: String(e && e.message || e) });
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
    const KEY = "vacancy.bookings.v1";
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
    const { fi, guest } = past, n0 = resv.length;
    cancelWithUndo(past, fi);
    const btn = document.querySelector(".toast button");
    ok(btn, "no Undo button on the cancellation toast");
    btn.click();
    await wait(60);
    eq(resv.length, n0, "row count after undo");
    ok(resv.some(r => r.fi === fi && r.guest === guest && r.end > DAYS), "the stay did not come back");
    return `${flats[fi].id} · ${guest} · end ${past.end} > DAYS ${DAYS}`;
  });

  /* This test used to assert memory only, and passed while the bug was still
     live: the invented payment sat in localStorage and came back on the next
     reload. A money assertion has to survive a round trip through storage,
     because storage is what the operator's next launch reads. */
  await test("undo does not invent a platform payment — and it stays gone after a reload", async () => {
    const KEY = "vacancy.bookings.v1";
    const backup = localStorage.getItem(KEY);
    const plat = resv.find(r => !isBlock(r) && PLATFORMS.indexOf(r.src) >= 0
      && r.amount > 0 && (!r.pays || !r.pays.length) && r.start >= 0);
    ok(plat, "seed has no unpaid platform booking");
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
    return `${guest} · ${money(amount)} still due through a full reload`;
  });

  await test("undo persists a stay that began before today", async () => {
    const KEY = "vacancy.bookings.v1";
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
    const m = await import("/audit.js?t=" + Date.now());
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
    const fi = flats.findIndex((f, i) => !occ[i][0] && runFrom(i, 0) >= 1 && runFrom(i, 0) < 3);
    ok(fi >= 0, "no flat is free tonight but booked within 3 nights");
    const note = roomTile(fi, 0, 3).querySelector("s").textContent;
    ok(!/^Booked$/.test(note), `tile says "${note}" for a night it is free`);
    ok(/of 3/.test(note), `tile says "${note}", expected "Free n of 3"`);
    const aria = roomTile(fi, 0, 3).getAttribute("aria-label");
    ok(!/not available/.test(aria), `aria says "${aria}"`);
    return `${flats[fi].id} → "${note}"`;
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

  await test("the owed rows are a partition of the headline", () => {
    const O = owedStats();
    eq(O.gone + O.soon + O.later, O.total, "rows do not sum to the headline");
    const platformInside = bookings().filter(r => r.amount && dueFrom(r) > 0)
      .reduce((s, r) => s + withPlatform(r), 0);
    eq(platformInside, 0, "platform money is inside the headline, so it must not be shown beside it");
    return `${money(O.total)} = ${money(O.gone)} + ${money(O.soon)} + ${money(O.later)}`;
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
    /* Late in a month there are only a few days left to render, and this test
       needs a cell with rows above and below it. Step forward until the grid is
       big enough rather than assuming today is early in the month — which is
       what it did assume, and which stopped being true a week later. */
    for (let i = 0; i < 3 && document.querySelectorAll(".day[data-d]").length <= 12; i++) {
      monthOffset++; renderMonth();
      await until(() => document.querySelector(".cal .day[data-d]"), "the next month");
    }
    ok(document.querySelectorAll(".day[data-d]").length > 12, "no month with enough days to test");
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

    const note = roomTile(fi, DAYS - 2, 3).querySelector("s").textContent;
    ok(/\+n$/.test(note), `tile says "${note}" — expected the "n+" edge idiom`);
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
    const m = await import("/audit.js?t=" + Date.now());
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
      /* a cell mid-week and mid-range must bleed both ways, or the band shows a
         seam at every cell and the point of it is lost */
      if (col > 0 && col < 6 && !isEnd) {
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
    await until(() => document.querySelector(".pick .pn"), "the nights badge");
    const [fIn, fOut] = [...document.querySelectorAll(".pick .pf")];
    eq(fIn.querySelector("b").textContent, fmtL(2), "check-in");
    eq(fOut.querySelector("b").textContent, fmtL(6), "check-out");
    eq(document.querySelector(".pick .pn").textContent, "4 nights", "the nights badge");
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

  /* The most ordinary request in this business — "the 28th to the 3rd" — was
     impossible to enter: both month arrows cleared pendingStart AND reset sel,
     so tapping an arrival and stepping to the next month lost the arrival. The
     first fix preserved the half-made selection and still wiped a FINISHED one,
     so stepping back to check the arrival month erased the stay just quoted. */
  await test("a stay can cross a month boundary, and survives stepping either way", async () => {
    document.querySelectorAll(".tabbar button")[1].click();
    await until(() => document.querySelector(".cal .day[data-d]"), "the month grid");
    monthOffset = 0; pendingStart = null; sel = { a: 0, n: 1 };
    renderMonth();
    await until(() => document.querySelector(".cal .day[data-d]"), "the grid to repaint");

    let cells = [...document.querySelectorAll(".day[data-d]")];
    const arrive = +cells[cells.length - 1].dataset.d;      // last day rendered
    cells[cells.length - 1].click();
    await until(() => pendingStart === arrive, "the arrival to arm");

    document.querySelectorAll(".mnav button")[1].click();   // ›
    await until(() => document.querySelector(".cal .day[data-d]"), "the next month");
    eq(pendingStart, arrive, "the arrival did not survive stepping a month");

    cells = [...document.querySelectorAll(".day[data-d]")];
    const leave = +cells[3].dataset.d;
    cells[3].click();
    await until(() => pendingStart === null, "the range to complete");
    eq(sel.a, arrive, "arrival after completing across the boundary");
    eq(sel.n, leave - arrive, "nights across the boundary");
    ok(document.querySelector(".day.rngB"), "the departure month shows no closing endpoint");

    document.querySelectorAll(".mnav button")[0].click();   // ‹ back
    await until(() => document.querySelector(".cal .day[data-d]"), "the arrival month");
    eq(sel.a, arrive, "stepping back erased the finished range");
    eq(sel.n, leave - arrive, "stepping back changed the nights");
    ok(document.querySelector(".day.rngA"), "the arrival month shows no opening endpoint");

    /* but an idle single-night cursor should still follow the view */
    pendingStart = null; sel = { a: 0, n: 1 }; renderMonth();
    await until(() => document.querySelector(".cal .day[data-d]"), "the grid");
    document.querySelectorAll(".mnav button")[1].click();
    await until(() => sel.a !== 0, "the idle cursor to follow the month");
    eq(sel.n, 1, "the idle cursor grew a range");
    return `${fmtL(arrive)} → ${fmtL(leave)} holds in both months`;
  });

  /* ══ the whole surface ══════════════════════════════════════════════════ */

  await test("no text falls below AA in either theme", async () => {
    const m = await import("/audit.js?t=" + Date.now());
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
