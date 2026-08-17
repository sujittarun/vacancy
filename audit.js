/* Contrast + surface-density audit, run against the RENDERED page.
 *
 *   await import('/audit.js').then(m => m.contrast())   every text node, both themes
 *   await import('/audit.js').then(m => m.density())    one painted fill per element kind
 *
 * It lives in a file because it kept being retyped into the console, and a
 * retyped ruler is a ruler with a fresh bug in it every time. It had exactly
 * that: `color(srgb r g b / a)` carries no leading number, so an index written
 * for `rgba(r,g,b,a)` read green as red and alpha as blue, and reported 67
 * failures that were not there. A measuring tool that is wrong is worse than no
 * measuring tool, because it is believed.
 */

/* ── colour ──────────────────────────────────────────────────────────────── */

/** Parse any computed colour into [r,g,b,a] with r,g,b in 0–255. */
export function parse(css) {
  if (!css || css === "transparent") return [0, 0, 0, 0];
  css = css.trim();
  /* Hex, because token VALUES are hex even though computed colours never are —
     and sanity() reads a token. Without this the digit regex below picked "0"
     and "1017" out of #0D1017, compared them to a real colour, and reported the
     theme settled on the strength of it. */
  const hex = css.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const w = hex.length <= 4 ? 1 : 2;                 // #rgb / #rgba vs #rrggbb / #rrggbbaa
    const at = i => parseInt(hex.slice(i * w, i * w + w).repeat(3 - w), 16);
    return [at(0), at(1), at(2), hex.length === 4 || hex.length === 8 ? at(3) / 255 : 1];
  }
  const n = css.match(/[\d.]+(?:e[-+]?\d+)?/gi)?.map(Number);
  if (!n) return null;
  // color(srgb r g b [/ a]) — components are 0–1 and there is no leading number
  if (/^color\(/i.test(css)) {
    const [r, g, b, a = 1] = n;
    return [r * 255, g * 255, b * 255, a];
  }
  // rgb()/rgba()
  const [r, g, b, a = 1] = n;
  return [r, g, b, a];
}

/** Composite src over dst (both [r,g,b,a]); returns an opaque colour. */
export const over = (src, dst) => {
  const a = src[3];
  return [0, 1, 2].map(i => src[i] * a + dst[i] * (1 - a)).concat(1);
};

const lin = v => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

/** WCAG contrast ratio between two opaque colours. */
export const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* ── walking the app ─────────────────────────────────────────────────────── */

const wait = ms => new Promise(r => setTimeout(r, ms));

/* The theme transition is 420ms, and measuring inside it is measuring a colour
   that exists for a fifth of a second and belongs to neither theme. Flipping
   `data-theme` by hand is worse still: it swaps the tokens but leaves anything
   the app coloured through its own path stale, which invented 24 tab-bar
   failures at 1.29:1 that were 16.39:1 the moment the theme was set properly.
   So there is one way to change theme for a measurement, and this is it. */
export async function setThemeAndSettle(t) {
  if (document.documentElement.dataset.theme !== t) {
    window.setTheme(t);
    await wait(520);                       // longer than the transition
  }
  await frames();
}

/* Two frames, but never a hang: requestAnimationFrame does not fire at all in a
   backgrounded tab, so an audit that awaits it simply never returns — which
   looks exactly like a stuck page and wasted three round-trips proving it was
   not. Whichever lands first wins. */
const frames = () => Promise.race([
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  wait(120),
]);

/* A run that cannot prove which theme it measured is a run to throw away. This
   compares a live element's ink against the theme's own token; if they disagree
   the page is mid-transition or half-flipped, and every number after it is
   fiction. */
export function sanity() {
  const cs = getComputedStyle(document.documentElement);
  const theme = document.documentElement.dataset.theme;
  const token = parse(cs.getPropertyValue("--txt").trim());
  const probe = document.querySelector(".topbar h1, h1, .id");
  const ink = probe ? parse(getComputedStyle(probe).color) : null;
  const drift = ink ? Math.max(...[0, 1, 2].map(i => Math.abs(ink[i] - token[i]))) : 999;
  return { theme, settled: drift <= 24, tokenInk: token.slice(0, 3).map(Math.round),
           renderedInk: ink?.slice(0, 3).map(Math.round) };
}

/* Transitions and animations DO NOT ADVANCE in a backgrounded tab, and
   getComputedStyle then reports the value the property started from — not the
   one it is heading to. That read as two shipped fixes having failed: the mic
   was measured still grey 80ms into a 200ms background transition, and the
   verdict "the recording state never applies" was written on the strength of
   it. The state was correct; the clock was stopped.

   So measure a state change through here. It kills every transition and
   animation for the duration, reads, and puts them back.

     freeze(() => { el.classList.add('hear'); return getComputedStyle(el).backgroundColor })

   The alternative — front the tab and wait out every duration — is slower and
   still races. */
export function freeze(fn) {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important;animation:none!important}";
  document.head.appendChild(style);
  try { return fn(); } finally { style.remove(); }
}

/** Flatten an element's whole ancestor background stack onto the page ground. */
export function groundUnder(el) {
  const stack = [];
  for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
    const c = parse(getComputedStyle(p).backgroundColor);
    if (c && c[3] > 0) stack.push(c);
  }
  let bg = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
  return bg;
}

/** Visit every screen and a few sheets, calling fn(surfaceName) on each. */
export async function walk(fn, { sheets: withSheets = true } = {}) {
  const tabs = [...document.querySelectorAll(".tabbar button")];
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].click(); await wait(220);
    await fn(tabs[i].textContent.trim());
  }
  tabs[0].click(); await wait(150);
  if (!withSheets) return;
  const sheets = [
    ["inventory", () => openInventory()],
    ["account",   () => openAccount()],
    ["a room",    () => openSheet(0, 0)],
    ["a booking", () => openBooking(0, 0, 2)],
  ];
  for (const [name, open] of sheets) {
    try { open(); await wait(240); await fn(name); }
    catch { /* a sheet that needs state this seed does not have */ }
    finally { await dismiss(); }
  }
  await dismiss();
}

/* Leave the app where we found it. A sheet or a gate left open does not just
   dirty the next surface — a gate is modal, so every later open() lands behind
   it and the sweep spends its time re-measuring the same screen. */
async function dismiss() {
  try { window.closeGate?.(); } catch {}
  try { window.closeSheet?.(); } catch {}
  await wait(200);
}

/* ── the two audits ──────────────────────────────────────────────────────── */

/** Every rendered text node, measured against what is actually behind it. */
export async function contrast(opts = {}) {
  const fails = [];
  let checked = 0;
  await frames();
  const check = sanity();
  await walk(where => {
    for (const el of document.querySelectorAll("*")) {
      if (!el.getClientRects().length) continue;
      const text = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
      if (!text.length) continue;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || +s.opacity < 0.35) continue;

      const bg = groundUnder(el);
      const fg = over(parse(s.color), bg);
      const px = parseFloat(s.fontSize), weight = +s.fontWeight || 400;
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const r = ratio(fg, bg);
      checked++;
      if (r < need) fails.push({
        where, need, r: +r.toFixed(2), px,
        text: text.map(n => n.textContent.trim()).join(" ").slice(0, 40),
        el: (el.className || el.tagName).toString().slice(0, 30),
      });
    }
  }, opts);
  return {
    ...check,                       // theme + whether it was settled enough to believe
    checked, failures: fails.length,
    worst: fails.sort((a, b) => a.r - b.r).slice(0, 20),
    ...(check.settled ? {} : { WARNING: "mid-transition or half-flipped — rerun after setThemeAndSettle()" }),
  };
}

/* Which ladder step each kind of thing is supposed to take. If a kind reports
   more than one fill, that is the drift the ladder exists to prevent. */
const KIND = el => {
  const has = c => el.classList.contains(c);
  if (has("pad")) return null;
  if (has("card") && has("bare")) return null;
  if (has("day") || has("night")) return "cell";
  if (has("card") || has("tcard") || has("ops-row")) return "raise";
  if (el.parentElement?.classList.contains("roomRoutes")) return "raise";
  if (has("sheet") || has("topbar") || has("tabbar") || has("toast") || has("peek") || has("strip-call"))
    return "float";
  if (["seg","field","step","stepWide","rowx","copybtn","actWhy","line","wallmove","dcell","ffind","mate","ftile","fixer","ghost"].some(has))
    return "sunk";
  if (has("bigAct") || (has("nudgeBtn") && has("yes")) || (has("pill") && has("good"))) return "ink";
  return null;
};

/** One painted fill per kind, or the audit tells you which kinds drifted. */
export async function density(opts = {}) {
  const seen = {};
  await walk(() => {
    for (const el of document.querySelectorAll("*")) {
      const kind = KIND(el);
      if (!kind || !el.getClientRects().length) continue;
      const s = getComputedStyle(el);
      if (s.display === "none") continue;
      const sig = `${s.backgroundColor}  ·  r${s.borderTopLeftRadius}  ·  ${s.borderTopColor}`;
      ((seen[kind] ||= {})[sig] ||= 0);
      seen[kind][sig]++;
    }
  }, opts);
  const out = {};
  for (const [kind, sigs] of Object.entries(seen)) {
    const rows = Object.entries(sigs).sort((a, b) => b[1] - a[1]);
    out[kind] = { fills: rows.length, rows: rows.map(([s, n]) => `${String(n).padStart(4)}×  ${s}`) };
  }
  return out;
}
