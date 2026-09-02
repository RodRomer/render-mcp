/**
 * Tests for HTTP routing.
 *
 * The defect these were written after: **every unknown path returned 200 with
 * the server's JSON blob.** `/robots.txt`, `/sitemap.xml`, `/favicon.ico` and
 * any typo all answered "200 OK, here is some JSON". There was no 404 anywhere
 * on the host.
 *
 * The same soft-404 was found and fixed on the Pages site in iteration 23 and
 * left in place here — a rule applied to one asset and not its sibling. That is
 * the shape this project keeps shipping, and the fix that sticks is a test over
 * the whole table rather than a check of one path.
 */

import { resolveRoute, robotsTxt, sitemapXml, notFoundHtml, INDEXNOW_KEY } from "../src/routes.js";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

const HTML = "text/html,application/xhtml+xml";

section("1. The bug: unknown paths must not be 200");
for (const p of ["/favicon.ico", "/wp-admin", "/.env", "/typo", "/a/b/c", "/index.php"]) {
  check(`${p} is not found`, resolveRoute("GET", p, "").kind, "not-found");
}
check("a 404 to a browser is marked for html", resolveRoute("GET", "/typo", HTML).html, true);
check("a 404 to a machine is not", resolveRoute("GET", "/typo", "").html, false);

section("2. Content negotiation on the root, without breaking the JSON contract");
check("a browser gets the landing page", resolveRoute("GET", "/", HTML).kind, "landing");
check("a machine gets json", resolveRoute("GET", "/", "").kind, "json");
check("an explicit application/json request gets json",
  resolveRoute("GET", "/", "application/json").kind, "json");
check("/index.html behaves like /", resolveRoute("GET", "/index.html", HTML).kind, "landing");

section("3. Crawler-facing files exist and are their own thing");
check("robots.txt routes to robots", resolveRoute("GET", "/robots.txt", "").kind, "robots");
check("sitemap.xml routes to sitemap", resolveRoute("GET", "/sitemap.xml", "").kind, "sitemap");
// A crawler sends no Accept: text/html for robots. It must still not get the page.
check("robots is unaffected by an html Accept", resolveRoute("GET", "/robots.txt", HTML).kind, "robots");
check("the IndexNow key file is served", resolveRoute("GET", `/${INDEXNOW_KEY}.txt`, "").kind, "indexnow-key");
check("a wrong key is not served", resolveRoute("GET", "/deadbeef.txt", "").kind, "not-found");

section("4. The MCP endpoint and methods");
check("POST is JSON-RPC", resolveRoute("POST", "/mcp", "").kind, "mcp");
// Unchanged deliberately: clients were never told the path was checked.
check("POST on any path is still JSON-RPC", resolveRoute("POST", "/anything", "").kind, "mcp");
check("GET /mcp is a named mistake, not a 404", resolveRoute("GET", "/mcp", "").kind, "method-not-allowed");
check("OPTIONS is cors", resolveRoute("OPTIONS", "/mcp", "").kind, "cors");
check("DELETE is refused", resolveRoute("DELETE", "/", "").kind, "method-not-allowed");
check("stats is plain text", resolveRoute("GET", "/stats", "").kind, "stats");

section("5. robots.txt");
const r = robotsTxt();
check("allows crawling", r.includes("Allow: /"), true);
// /mcp answers 405 to GET; letting crawlers hammer it wastes everyone's budget.
check("keeps crawlers off the RPC endpoint", r.includes("Disallow: /mcp"), true);
check("points at the sitemap", r.includes("Sitemap: https://render.makermargins.com/sitemap.xml"), true);
check("ends with a newline", r.endsWith("\n"), true);

section("6. sitemap.xml");
const s = sitemapXml();
check("declares the xml prolog", s.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), true);
check("lists both real pages", (s.match(/<loc>/g) || []).length, 2);
check("includes the landing page", s.includes("<loc>https://render.makermargins.com/</loc>"), true);
check("includes the stats page", s.includes("<loc>https://render.makermargins.com/stats</loc>"), true);
// The MCP endpoint is not a page; listing it would send crawlers at a 405.
check("does not list the rpc endpoint", s.includes("/mcp<"), false);
check("every url is absolute", (s.match(/<loc>(?!https:\/\/)/g) || []).length, 0);

section("7. The 404 page");
const nf = notFoundHtml();
check("is noindex", nf.includes('name="robots" content="noindex"'), true);
check("has a title", /<title>[^<]{5,}<\/title>/.test(nf), true);
check("explains this host is not a website", nf.includes("not a website"), true);
check("points at the two real pages", nf.includes("/stats") && nf.includes("overview"), true);
check("explains why /mcp cannot be opened in a browser", nf.includes("JSON-RPC over POST"), true);
check("defines a dark palette", nf.includes("prefers-color-scheme:dark"), true);

section("8. The key is well-formed for IndexNow");
check("is hexadecimal", /^[0-9a-f]+$/.test(INDEXNOW_KEY), true);
check("length is within the 8-128 the spec allows",
  INDEXNOW_KEY.length >= 8 && INDEXNOW_KEY.length <= 128, true);

console.log(`\n========================================`);
console.log(`  PASSED: ${pass}    FAILED: ${fail}`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
