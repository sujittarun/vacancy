#!/usr/bin/env node
/* Style guard for index.html.
 *
 * Every rule here exists because the thing it checks has actually shipped
 * broken at least once. None of it is taste; all of it is a defect that reached
 * the phone and was found by eye instead of by a machine.
 *
 *   node check-css.mjs           report
 *   node check-css.mjs --quiet   exit 1 on any FAIL, print nothing on success
 */
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = src.match(/<style>([\s\S]*?)<\/style>/)[1];
const quiet = process.argv.includes("--quiet");

const fails = [];
const notes = [];
const lineAt = i => css.slice(0, i).split("\n").length;

/* 1 ── comment balance ──────────────────────────────────────────────────────
   Twice now a comment has been written whose opening `/*` was missing, because
   prose was appended after an existing block had already closed. The parser
   does not complain: it swallows everything up to the NEXT `*​/`, which is the
   end of the following comment, and the entire rule between them disappears.
   The calendar silently reverted to a stale fill for exactly this reason and
   nothing but a live measurement caught it. */
{
  let i = 0, depth = 0;
  while (i < css.length) {
    if (css.startsWith("/*", i)) {
      if (depth) fails.push(`nested /* at line ${lineAt(i)} — a comment inside a comment swallows the rule after it`);
      depth++; i += 2; continue;
    }
    if (css.startsWith("*/", i)) {
      if (!depth) fails.push(`stray */ at line ${lineAt(i)} — prose above it is being parsed as CSS`);
      else depth--;
      i += 2; continue;
    }
    i++;
  }
  if (depth) fails.push("a comment is never closed — everything after it is gone");
}

/* 2 ── the ladder is the only source of surface density ─────────────────────
   The bug the ladder was built to end: three different whites doing the single
   job of "a raised pane", because each was written in a different week. Any new
   literal white or ink fill is that bug starting again, so it has to be either
   a ladder step or a deliberate, named exception below. */
const TOKEN_BLOCK = /--s-(flat|raise|cell|float|sunk)\s*:/;
const EXEMPT = [
  /* shadows and rims are light, not density — they legitimately carry literals */
  /box-shadow/, /inset /, /text-shadow/, /--lg-rim/, /--g-sunk-inner/, /--sheen/, /--lg-sheen/,
  /* a colour that MEANS something (vacancy, alert, the ink answers) is not a surface step */
  /--free/, /--held/, /--hot/, /--now/, /--warn/, /color-mix/,
];
for (const [i, raw] of css.split("\n").entries()) {
  const line = raw.trim();
  if (!line.startsWith("background") && !line.startsWith("border-color")) continue;
  if (TOKEN_BLOCK.test(line) || EXEMPT.some(r => r.test(line))) continue;
  const lit = line.match(/rgba\((?:255,\s*255,\s*255|13,\s*16,\s*23)\s*,\s*\.\d+\)/);
  if (lit) notes.push(`line ${i + 1}: literal surface fill ${lit[0]} — should be a ladder step`);
}

/* 3 ── radii come off the scale ─────────────────────────────────────────────
   22 distinct container radii were in this file. Ten of them differed by one
   pixel from another, which is not a decision anyone made or can see. Hairlines
   and bars (under 8px) and pills (50%) are genuinely not containers and stay. */
for (const m of css.matchAll(/border-radius:\s*([^;}]+)/g)) {
  for (const part of m[1].trim().split(/\s+/)) {
    const px = parseFloat(part);
    if (part.endsWith("px") && px >= 8)
      notes.push(`line ${lineAt(m.index)}: literal radius ${part} — should be --r-xs|sm|md|lg|xl`);
  }
}

/* 4 ── a light rule may not ship a literal into dark ────────────────────────
   The 1.14:1 regression: a rule was un-guarded so both themes could share it,
   and it carried light's white pane straight onto the dark ground. Anything
   outside a [data-theme] guard must speak in tokens only. */
for (const m of css.matchAll(/^([^@{}\n][^{}]*)\{([^}]*)\}/gm)) {
  const [, sel, body] = m;
  if (/data-theme/.test(sel) || /^\s*(from|to|\d+%)/.test(sel)) continue;
  const lit = body.match(/(?:^|[;\s])(?:background(?:-color)?|color)\s*:\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i);
  if (lit && !/transparent|rgba\([^)]*,\s*0\)/.test(lit[1]))
    notes.push(`line ${lineAt(m.index)}: unguarded literal ${lit[1]} in "${sel.trim().slice(0, 48)}" — one theme will wear the other's paint`);
}

if (!quiet || fails.length) {
  console.log(`${fails.length ? "FAIL" : "PASS"}  ${fails.length} blocking, ${notes.length} drift`);
  for (const f of fails) console.log("  FAIL  " + f);
  for (const n of notes.slice(0, 40)) console.log("  drift " + n);
  if (notes.length > 40) console.log(`  … and ${notes.length - 40} more`);
}
process.exit(fails.length ? 1 : 0);
