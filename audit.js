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
export async function walk(fn) {
  const tabs = [...document.querySelectorAll(".tabbar button")];
  for (let i = 0; i < tabs.length; i++) {
    tabs[i].click(); await wait(220);
    await fn(tabs[i].textContent.trim());
  }
  tabs[0].click(); await wait(150);
  const sheets = [
    ["inventory", () => openInventory()],
    ["account",   () => openAccount()],
    ["a room",    () => openSheet(0, 0)],
    ["a booking", () => openBooking(0, 0, 2)],
  ];
  for (const [name, open] of sheets) {
    try { open(); await wait(240); await fn(name); closeSheet(); await wait(200); }
    catch { /* a sheet that needs state this seed does not have */ }
  }
}

/* ── the two audits ──────────────────────────────────────────────────────── */

/** Every rendered text node, measured against what is actually behind it. */
export async function contrast() {
  const fails = [];
  let checked = 0;
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
  });
  return {
    theme: document.documentElement.dataset.theme,
    checked, failures: fails.length,
    worst: fails.sort((a, b) => a.r - b.r).slice(0, 20),
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
export async function density() {
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
  });
  const out = {};
  for (const [kind, sigs] of Object.entries(seen)) {
    const rows = Object.entries(sigs).sort((a, b) => b[1] - a[1]);
    out[kind] = { fills: rows.length, rows: rows.map(([s, n]) => `${String(n).padStart(4)}×  ${s}`) };
  }
  return out;
}
