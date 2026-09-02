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
    case "/robots.txt":
      return { kind: "robots" };
    case "/sitemap.xml":
      return { kind: "sitemap" };
    case `/${INDEXNOW_KEY}.txt`:
      return { kind: "indexnow-key" };
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
    { loc: `${origin}/stats`, priority: "0.3" }
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
