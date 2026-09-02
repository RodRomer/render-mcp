/**
 * HTTP routing as a pure function.
 *
 * Pulled out of the request handler for the usual reason in this project: the
 * bug it fixes was invisible while the logic lived in a chain of `if`s. Every
 * unknown path returned **200 with the server's JSON blob** — `/robots.txt`,
 * `/sitemap.xml`, `/favicon.ico`, anything at all. A crawler asking for robots
 * got a JSON document with a 200, and there was no 404 anywhere on the host.
 *
 * That is the same soft-404 fixed on the Pages site in iteration 23 and left in
 * place here, which is exactly the "rule applied everywhere except one place"
 * shape this project keeps finding. A routing table can be checked as a set;
 * a chain of conditionals cannot.
 *
 * Returns a descriptor only — no Response objects, no environment, nothing that
 * needs a Worker — so the whole surface is testable under plain node.
 */

/** The IndexNow key for this host. Public by design: hosting it is the proof. */
export const INDEXNOW_KEY = "8c1f47b0e2a94d6fb35ac0d918e7f24c";


/**
 * A browser viewport — which is precisely what this server hands an agent.
 * Inline rather than a file because a Worker has no asset store, and an SVG
 * favicon covers every size a browser asks for with one response.
 */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0E1614"/>
  <rect x="6" y="7" width="20" height="18" rx="3" fill="none" stroke="#4FBF9E" stroke-width="2.2"/>
  <path d="M6 13h20" stroke="#4FBF9E" stroke-width="2.2"/>
  <circle cx="9.6" cy="10" r="1.15" fill="#4FBF9E"/>
</svg>`;

export function resolveRoute(method, pathname, accept = "") {
  const wantsHtml = String(accept).includes("text/html");

  if (method === "OPTIONS") return { kind: "cors" };

  // Any POST is JSON-RPC, on any path. Deliberately unchanged: clients were
  // never told the path was checked, and tightening it now could break one.
  if (method === "POST") return { kind: "mcp" };

  if (method !== "GET" && method !== "HEAD") {
    return { kind: "method-not-allowed" };
  }

  switch (pathname) {
    case "/mcp":
      // GET on the RPC endpoint is a mistake worth naming rather than 404ing.
      return { kind: "method-not-allowed" };
    case "/stats":
      return { kind: "stats" };
    case "/privacy":
      // A directory submission asks for a privacy policy URL, and this server
      // does record three fields — so it needs a real page, not a homepage anchor.
      return { kind: "privacy" };
    case "/robots.txt":
      return { kind: "robots" };
    case "/sitemap.xml":
      return { kind: "sitemap" };
    case `/${INDEXNOW_KEY}.txt`:
      return { kind: "indexnow-key" };
    case "/favicon.svg":
    case "/favicon.ico":
      // Browsers probe /favicon.ico regardless of what the page declares, and a
      // 404 there is a wasted request on every visit. Serve the SVG for both.
      return { kind: "favicon" };
    case "/":
    case "/index.html":
      return wantsHtml ? { kind: "landing" } : { kind: "json" };
    default:
      // Everything else is genuinely absent. Say so, in the caller's format.
      return { kind: "not-found", html: wantsHtml };
  }
}

/**
 * robots.txt for this host. It is a separate hostname from makermargins.com and
 * inherits none of that zone's files, so this is the only robots it will ever
 * have. `/mcp` is disallowed because it answers 405 to GET — letting crawlers
 * hammer it wastes their budget and ours to no purpose.
 */
export function robotsTxt(origin = "https://render.makermargins.com") {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /mcp",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    ""
  ].join("\n");
}

/** Two pages worth indexing: the landing page and the public usage counter. */
export function sitemapXml(origin = "https://render.makermargins.com", lastmod = "2026-09-02") {
  const urls = [
    { loc: `${origin}/`, priority: "1.0" },
    { loc: `${origin}/stats`, priority: "0.3" },
    { loc: `${origin}/privacy`, priority: "0.3" }
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.flatMap((u) => [
      "  <url>",
      `    <loc>${u.loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      "    <changefreq>weekly</changefreq>",
      `    <priority>${u.priority}</priority>`,
      "  </url>"
    ]),
    "</urlset>",
    ""
  ].join("\n");
}

/** A 404 a person can read, in the same visual language as the landing page. */
export function notFoundHtml(origin = "https://render.makermargins.com") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Not found — render-mcp</title>
<style>
  :root{color-scheme:light;--paper:#F2F4F1;--ink:#14201C;--ink-2:#46564F;--mat:#16715B}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    color-scheme:dark;--paper:#101614;--ink:#E6EDE9;--ink-2:#A7B5AE;--mat:#4FBF9E}}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:16px/1.6 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .box{max-width:44ch}
  h1{font-size:26px;margin:0 0 10px}
  p{color:var(--ink-2);margin:0 0 14px}
  a{color:var(--mat)}
</style>
</head>
<body>
  <div class="box">
    <h1>There is nothing at this address</h1>
    <p>This host runs an MCP server, not a website. There are only two pages:
       the <a href="${origin}/">overview</a> and the public
       <a href="${origin}/stats">usage counter</a>.</p>
    <p>The MCP endpoint itself is <code>${origin}/mcp</code>, and it answers
       JSON-RPC over POST — a browser cannot usefully open it.</p>
  </div>
</body>
</html>
`;
}

/** The privacy position, stated as a page so it can be cited by a URL. */
export function privacyHtml(origin = "https://render.makermargins.com") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy — render-mcp</title>
<meta name="description" content="What render-mcp records and what it does not. URLs and page content are never stored or logged.">
<link rel="canonical" href="${origin}/privacy">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root{color-scheme:light;--paper:#F2F4F1;--panel:#FBFCFA;--line:#D3DAD2;
    --ink:#14201C;--ink-2:#46564F;--ink-3:#5A6A62;--mat:#16715B}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
    color-scheme:dark;--paper:#101614;--panel:#171F1C;--line:#2C3A35;
    --ink:#E6EDE9;--ink-2:#A7B5AE;--ink-3:#8F9F98;--mat:#4FBF9E}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:16px/1.6 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:680px;margin:0 auto;padding:56px 24px 72px}
  h1{font-size:32px;line-height:1.2;margin:0 0 8px}
  .dek{color:var(--ink-2);margin:0 0 32px}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-3);
     margin:36px 0 12px;font-weight:600}
  p{margin:0 0 14px;max-width:66ch}
  table{border-collapse:collapse;width:100%;margin:0 0 14px}
  th,td{text-align:left;padding:9px 12px;border:1px solid var(--line);font-size:14.5px}
  th{background:var(--panel);font-weight:600}
  code{font-family:ui-monospace,monospace;font-size:13.5px}
  a{color:var(--mat)}
  footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--line);
    color:var(--ink-3);font-size:14px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Privacy</h1>
  <p class="dek">What this server records, and what it does not.</p>

  <main>
    <h2>URLs and page content are never stored or logged</h2>
    <p>Each call launches a browser, does the work, hands back the result, and closes it.
    Nothing about <em>what</em> you asked for is retained &mdash; not the URL, not the HTML,
    not the screenshot or PDF.</p>

    <h2>One thing is counted</h2>
    <p>Stated precisely rather than hidden behind the word &ldquo;anonymised&rdquo;:</p>
    <table>
      <tr><th>Recorded</th><th>Not recorded</th></tr>
      <tr><td>Which tool ran</td><td>The URL, or any part of it</td></tr>
      <tr><td>How it ended (<code>ok</code>, <code>timeout</code>, &hellip;)</td><td>Your IP address</td></tr>
      <tr><td>Roughly how long it took</td><td>Any header, cookie or credential</td></tr>
      <tr><td></td><td>Any page content, image or PDF</td></tr>
    </table>
    <p>Three fields, with no way to tie them to a request, a person or a site. The function that
    writes them is never handed the URL, so it cannot record one by accident. The counts are
    public at <a href="${origin}/stats">${origin}/stats</a>.</p>

    <h2>No accounts, no credentials</h2>
    <p>There is no signup, no API key and no session. The server holds no logins, so it never
    sees a password or a token, and anything behind authentication renders as its login page.</p>

    <h2>Content fetched on your behalf</h2>
    <p>Pages are fetched from the public web and returned to you marked as untrusted data. Private
    and loopback addresses are refused.</p>

    <h2>Why counting happens at all</h2>
    <p>This server is free. The only way to decide whether it is worth keeping alive is knowing
    whether anything calls it.</p>
  </main>

  <footer>
    <a href="${origin}/">render-mcp</a> &middot;
    <a href="https://github.com/RodRomer/render-mcp">Source</a> &middot; MIT
  </footer>
</div>
</body>
</html>
`;
}