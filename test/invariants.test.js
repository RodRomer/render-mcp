/**
 * Invariants across the whole tool set, checked against the source.
 *
 * Why this file exists. Three of the last five real defects in this project had
 * the same shape: a rule applied everywhere except one place. Colour contrast
 * correct on one of four theme combinations. A `<main>` landmark on none of six
 * pages. Structured data on five of six. Each survived review because *checking
 * one example passes* — the defect is precisely the gap between the sample and
 * the set.
 *
 * `wrapUntrusted` was added in v0.6.0 and applied to two of the four tools that
 * return page-derived text. The other two shipped unmarked for a version. A test
 * over the set would have caught it the same day, so here is that test.
 *
 * It reads the source rather than calling the tools, because the alternative
 * needs a Worker and a live browser. That makes it a coarse check — it proves the
 * call is present, not that it wraps the right string — but coarse and present
 * beats precise and absent.
 *
 * Runs under node only (it needs `fs`), so it is separate from model.test.js,
 * which must also run in the browser harness on a machine with no node.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "index.js"), "utf8");

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

/** Split index.js into one chunk per tool implementation. */
function toolBlocks(source) {
  const marks = [...source.matchAll(/if \(name === "([a-z_]+)"\)/g)];
  const out = {};
  marks.forEach((m, i) => {
    const start = m.index;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    out[m[1]] = source.slice(start, end);
  });
  return out;
}

const blocks = toolBlocks(src);

section("1. Every tool is accounted for");
// If a tool is added and not classified below, this fails — which is the point.
const KNOWN = [
  "screenshot_url", "rendered_html", "page_diagnostics",
  "accessibility_audit", "inspect_element", "url_to_pdf"
];
check("the source implements exactly the tools we expect",
  Object.keys(blocks).sort(), [...KNOWN].sort());

section("2. Tools returning page-derived text mark it untrusted");
// These hand the agent strings the page's author controls: its HTML, its console
// output, its element ids and classes. All must be labelled.
const RETURNS_PAGE_TEXT = [
  "rendered_html",        // the page verbatim
  "page_diagnostics",     // console messages written by the page
  "accessibility_audit",  // violation samples are verbatim page HTML
  "inspect_element"       // descriptors built from page id and class attributes
];
for (const tool of RETURNS_PAGE_TEXT) {
  check(`${tool} wraps its output`, /wrapUntrusted\(/.test(blocks[tool]), true);
}

section("3. Tools returning no page text are left alone");
// Marking output that contains none would be noise, and noise trains an agent to
// ignore the marker on the calls where it matters.
const NO_PAGE_TEXT = ["screenshot_url", "url_to_pdf"];
for (const tool of NO_PAGE_TEXT) {
  check(`${tool} does not wrap`, /wrapUntrusted\(/.test(blocks[tool]), false);
}

section("4. The classification above covers every tool");
check("no tool is missing from both lists",
  KNOWN.filter((t) => !RETURNS_PAGE_TEXT.includes(t) && !NO_PAGE_TEXT.includes(t)), []);
check("no tool appears in both lists",
  RETURNS_PAGE_TEXT.filter((t) => NO_PAGE_TEXT.includes(t)), []);

section("5. Every tool closes the browser it opened");
// A leaked browser burns the daily quota and the failure looks like rate limiting,
// which the capacity message would then report as our fault. Also a set-check.
for (const tool of KNOWN) {
  check(`${tool} closes the browser in a finally block`,
    /finally\s*\{\s*await browser\.close\(\);/.test(blocks[tool]), true);
}

section("6. Every tool call is counted");
// Counting lives in the request loop rather than per tool, so assert it there.
check("the deferred path records an outcome", /count\(env, ctx, out\.defer,/.test(src), true);
check("validation rejections are counted too", /"bad_request"/.test(src), true);

console.log(`\n========================================`);
console.log(`  PASSED: ${pass}    FAILED: ${fail}`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
