/**
 * Tests for the in-page half of inspect_element.
 *
 * These need a real layout engine — the whole point of the tool is that computed
 * styles and box geometry cannot be derived by reading HTML and CSS, so a fake
 * DOM would prove nothing. They run in headless Edge against fixture pages built
 * in the document, with no Cloudflare, no Worker and no network. Run with:
 *
 *   powershell -ExecutionPolicy Bypass -File test\run-dom.ps1
 */

import { inspectInPage, verdictFor } from "../src/inspect-page.js";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

// Fixtures go in their own container rather than into document.body, so that
// replacing them cannot destroy the harness's own output element.
const fixture = document.createElement("div");
document.body.appendChild(fixture);

/** Build a fixture page and inspect one selector in it. */
function inspect(html, selector, limit = 3) {
  fixture.innerHTML = html;
  return inspectInPage(selector, limit);
}

/** The first match's verdict sentence — what an agent actually reads. */
function verdict(html, selector) {
  const r = inspect(html, selector);
  if (r.badSelector) return "BAD_SELECTOR";
  if (r.total === 0) return "NO_MATCH";
  return verdictFor(r.report[0]);
}

section("1. A plainly visible element");
const vis = inspect('<div id="a" style="width:200px;height:50px;background:#0a0">hello</div>', "#a");
check("finds exactly one", vis.total, 1);
check("reports the real box width", vis.report[0].box.w, 200);
check("reports the real box height", vis.report[0].box.h, 50);
check("resolves the background to rgb", vis.report[0].background, "rgb(0, 170, 0)");
check("is in the viewport", vis.report[0].inViewport, true);
check("nothing is hiding it", [vis.report[0].hiddenBy, vis.report[0].coveredBy], [null, null]);
check("verdict is visible", verdict('<div id="a" style="width:200px;height:50px">x</div>', "#a"),
  "VISIBLE — rendered inside the viewport and not covered.");

section("2. The element itself is hidden");
check("display:none", verdict('<div id="a" style="display:none">x</div>', "#a"),
  "NOT RENDERED — this element has display:none.");
check("visibility:hidden", verdict('<div id="a" style="visibility:hidden;width:10px;height:10px">x</div>', "#a"),
  "INVISIBLE — visibility:hidden. It still occupies its space.");
check("opacity:0", verdict('<div id="a" style="opacity:0;width:10px;height:10px">x</div>', "#a"),
  "INVISIBLE — opacity:0. It still occupies its space and stays clickable.");
check("zero size", verdict('<div id="a" style="width:0;height:0"></div>', "#a"),
  "ZERO SIZE — the box is 0x0, so nothing can paint.");

section("3. An ancestor is hiding it — the case reading the CSS cannot answer");
// The element's own computed display is "block" in every one of these. Only a
// walk up the tree, in a browser that has resolved the cascade, finds the cause.
const anc = inspect(
  '<div class="modal panel" style="display:none"><div><button id="buy">Buy</button></div></div>', "#buy");
check("the element's own display is untouched", anc.report[0].display, "inline-block");
check("names the ancestor", anc.report[0].hiddenBy.el, "div.modal.panel");
check("names the reason", anc.report[0].hiddenBy.why, "display:none");
check("verdict blames the ancestor, and says the element is fine",
  verdictFor(anc.report[0]),
  "HIDDEN BY AN ANCESTOR — div.modal.panel has display:none. The element itself is fine.");

check("ancestor opacity:0 is caught",
  verdict('<div id="w" style="opacity:0"><span id="t">x</span></div>', "#t"),
  "HIDDEN BY AN ANCESTOR — div#w has opacity:0. The element itself is fine.");

// visibility is inherited but a descendant can override it back to visible.
// Blaming the ancestor there would be wrong, so the check requires both.
check("an ancestor's visibility:hidden that the child overrides is NOT blamed",
  verdict('<div style="visibility:hidden"><span id="t" style="visibility:visible;display:inline-block;width:5px;height:5px">x</span></div>', "#t"),
  "VISIBLE — rendered inside the viewport and not covered.");
check("an ancestor's visibility:hidden the child inherits IS blamed",
  verdict('<div id="w" style="visibility:hidden"><span id="t">x</span></div>', "#t"),
  "HIDDEN BY AN ANCESTOR — div#w has visibility:hidden. The element itself is fine.");

check("the nearest hiding ancestor is the one named, not the outermost",
  inspect('<div id="outer" style="display:none"><div id="inner" style="display:none"><b id="t">x</b></div></div>', "#t")
    .report[0].hiddenBy.el, "div#inner");

section("4. Containers that hide without display:none");
check("a closed <details> is explained, not reported as a mystery zero box",
  verdict('<details><summary>More</summary><p id="t">body</p></details>', "#t"),
  "NOT RENDERED — it sits inside details, which is not displaying its contents because of a closed <details>.");
check("an open <details> shows its contents normally",
  verdict('<details open><summary>More</summary><p id="t">body</p></details>', "#t"),
  "VISIBLE — rendered inside the viewport and not covered.");
check("a [hidden] ancestor is named",
  verdict('<section id="s" hidden><p id="t">body</p></section>', "#t"),
  "HIDDEN BY AN ANCESTOR — section#s has display:none. The element itself is fine.");

section("5. Rendered, but not where you are looking");
const off = inspect('<div id="a" style="position:absolute;left:-500px;top:0;width:100px;height:20px">x</div>', "#a");
check("an off-screen element is not counted as in-viewport", off.report[0].inViewport, false);
check("the direction and distance are reported", off.report[0].offscreen.includes("left of the viewport"), true);
check("verdict says off-screen", verdictFor(off.report[0]).startsWith("OFF-SCREEN"), true);

section("6. Painted, but something is on top of it");
const cov = inspect(
  '<div style="position:relative">' +
  '<button id="buy" style="position:absolute;left:0;top:0;width:120px;height:40px">Buy</button>' +
  '<div class="overlay" style="position:absolute;left:0;top:0;width:300px;height:300px;background:#fff"></div>' +
  '</div>', "#buy");
// display is "block", not the button's usual "inline-block": absolute positioning
// blockifies it. That is exactly the kind of value only a browser can tell you.
check("the button itself is perfectly fine", [cov.report[0].display, cov.report[0].hiddenBy], ["block", null]);
check("but something covers it", cov.report[0].coveredBy, "div.overlay");
check("verdict explains clicks will miss",
  verdictFor(cov.report[0]).includes("clicks land on that instead"), true);
check("a child painting over its own parent is not a cover",
  inspect('<div id="p" style="width:100px;height:100px"><span style="display:block;width:100%;height:100%"></span></div>', "#p")
    .report[0].coveredBy, null);

section("7. Matching and limits");
check("counts every match", inspect('<p class="x">1</p><p class="x">2</p><p class="x">3</p>', ".x").total, 3);
check("but reports only up to the limit",
  inspect('<p class="x">1</p><p class="x">2</p><p class="x">3</p>', ".x", 2).report.length, 2);
check("no match reports zero", inspect("<p>hi</p>", ".nope").total, 0);
check("no match returns an empty report", inspect("<p>hi</p>", ".nope").report.length, 0);
check("an invalid selector is flagged, not thrown", inspect("<p>hi</p>", "div[").badSelector, true);
check("a valid but exotic selector works", inspect('<p data-x="1">hi</p>', 'p[data-x="1"]').total, 1);

section("8. The descriptor an agent reads back");
check("tag only", inspect("<p>x</p>", "p").report[0].tag, "p");
check("tag and id", inspect('<p id="a">x</p>', "p").report[0].tag, "p#a");
check("tag, id and classes", inspect('<p id="a" class="b c">x</p>', "p").report[0].tag, "p#a.b.c");
check("classes are capped at three", inspect('<p class="a b c d e">x</p>', "p").report[0].tag, "p.a.b.c");

console.log(`\n========================================`);
console.log(`  PASSED: ${pass}    FAILED: ${fail}`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
