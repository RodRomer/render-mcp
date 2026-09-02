/**
 * Tests for the human-readable landing page.
 *
 * The page exists because this domain used to serve `application/json` to
 * everyone, including a person following the link from a registry. Since the
 * installer of an MCP server is a human editing a config file, having no human
 * surface was a distribution defect.
 *
 * Two of the checks below guard a *positioning* decision rather than markup, and
 * they are the reason this file is worth keeping. The "free screenshot API with
 * no signup" market is saturated — Microlink, Site-Shot, Thum.io, HookRay — and
 * against those this server is the worse product. Pitching it that way would
 * lose the comparison and attract exactly the wrong visitor. The page must lead
 * with the tools that need a real layout engine, and must stay honest that a
 * plain screenshot is better served elsewhere.
 */

import { landingPage } from "../src/landing.js";
import { TOOLS } from "../src/protocol.js";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

const html = landingPage(TOOLS);

section("1. It is a real page a crawler can read");
check("has a substantial title", /<title>[^<]{10,}<\/title>/.test(html), true);
check("has a meta description", /name="description" content="[^"]{50,}"/.test(html), true);
check("declares a canonical url", /rel="canonical" href="https:\/\/render\.makermargins\.com\/"/.test(html), true);
check("has open graph tags", /property="og:title"/.test(html) && /property="og:url"/.test(html), true);
check("carries JSON-LD", /application\/ld\+json/.test(html), true);
check("the JSON-LD parses", (() => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  try { JSON.parse(m[1]); return true; } catch { return false; }
})(), true);
check("has one <main>", (html.match(/<main>/g) || []).length, 1);
check("declares a language", /<html lang="en">/.test(html), true);
check("div tags balance", (html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);

section("2. It stays in step with the server");
// The page is generated from TOOLS, so it cannot advertise a tool that does not
// exist or silently omit a new one.
check("one block per tool", (html.match(/class="tool"/g) || []).length, TOOLS.length);
for (const t of TOOLS) {
  check(`names ${t.name}`, html.includes(t.name), true);
}
check("shows a copy-pasteable install command", html.includes("claude mcp add"), true);
check("shows the endpoint", html.includes("https://render.makermargins.com/mcp"), true);

section("3. Positioning — do not compete as a screenshot API");
// Saturated market, and we are the weaker product in it. These assertions exist
// so a later edit cannot quietly reposition the page into a losing comparison.
check("does not call itself a free screenshot API", /free screenshot api/i.test(html), false);
check("says plainly that a screenshot API may be the better choice",
  html.includes("they will beat this"), true);
check("leads on the browser-only capabilities",
  html.includes("real layout engine"), true);
check("acknowledges other MCP browsers exist and are good",
  html.includes("they are good"), true);

section("4. It keeps the promises made elsewhere");
check("states the no-key, no-signup position", /no API key/i.test(html) && /no signup/i.test(html), true);
check("declares the private-network refusal", html.includes("RFC1918"), true);
check("declares the no-login limitation", html.includes("No logins"), true);
check("repeats the privacy position", html.includes("never stored or logged"), true);
check("links the public usage counter", html.includes('href="/stats"'), true);

section("5. Themeable and readable");
check("defines the light palette on bare :root", /:root\{[^}]*--paper:#F2F4F1/.test(html.replace(/\s*\n\s*/g, "")), true);
check("defines a dark palette", html.includes("prefers-color-scheme: dark"), true);
check("guards dark against an explicit light choice", html.includes(':root:not([data-theme="light"])'), true);
check("body paints its own background", /body\{[^}]*background:var\(--paper\)/.test(html.replace(/\s*\n\s*/g, "")), true);

console.log(`\n========================================`);
console.log(`  PASSED: ${pass}    FAILED: ${fail}`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
