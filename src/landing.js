/**
 * The human-readable page for render.makermargins.com.
 *
 * Why it exists: the domain served `application/json` to every caller, including
 * a person in a browser. A developer who followed the URL from a registry saw raw
 * JSON, and a search engine saw no title, no headings and nothing to index. The
 * installer of an MCP server is a human editing a config file, so having no human
 * surface at all was a distribution defect, not a cosmetic one.
 *
 * Positioning is deliberate. This does **not** present itself as a free
 * screenshot API: that market is saturated with no-signup options (Microlink,
 * Site-Shot, Thum.io, HookRay), and against them we would be the worse product —
 * fewer formats, fewer options, a tighter rate limit. What none of them offer is
 * a browser an *agent* can drive over MCP, or the three tools that need a real
 * layout engine. Lead with that, and let the screenshot be a feature rather than
 * the pitch.
 *
 * Kept as a pure function of the tool list so the page cannot drift out of step
 * with what the server actually advertises.
 */

const ENDPOINT = "https://render.makermargins.com/mcp";
const REPO = "https://github.com/RodRomer/render-mcp";

/** Escape text destined for HTML. The tool descriptions are ours, but this is cheap. */
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One sentence per tool, in the order an agent would reach for them. */
const BLURBS = {
  screenshot_url: "See a page as a person would, after JavaScript has run.",
  rendered_html: "The DOM after JavaScript — for single-page apps that return an empty shell.",
  page_diagnostics: "Console errors, failed requests and bad statuses. An agent cannot see a browser console any other way.",
  accessibility_audit: "axe-core in a real browser, so colour-contrast rules actually fire.",
  inspect_element: "Why an element isn't showing: box model, computed styles, and what's covering it.",
  url_to_pdf: "The page as a browser would print it."
};

export function landingPage(tools) {
  const rows = tools.map((t) => `
      <div class="tool">
        <code>${esc(t.name)}</code>
        <p>${esc(BLURBS[t.name] || t.description.slice(0, 120))}</p>
      </div>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>render-mcp — a real browser for AI agents</title>
<meta name="description" content="A hosted MCP server that gives an AI agent a real browser: screenshots, post-JavaScript HTML, console diagnostics, WCAG audits and computed styles. No API key, no signup.">
<link rel="canonical" href="https://render.makermargins.com/">
<meta property="og:type" content="website">
<meta property="og:title" content="render-mcp — a real browser for AI agents">
<meta property="og:description" content="A hosted MCP server that gives an AI agent a real browser. No API key, no signup, nothing to install.">
<meta property="og:url" content="https://render.makermargins.com/">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"render-mcp",
"applicationCategory":"DeveloperApplication","operatingSystem":"Any",
"description":"A hosted MCP server that gives AI agents a real browser: screenshots, post-JavaScript HTML, console diagnostics, accessibility audits and computed styles.",
"offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},
"url":"https://render.makermargins.com/"}
</script>
<style>
  :root{
    color-scheme: light;
    --paper:#F2F4F1; --panel:#FBFCFA; --panel-2:#EAEEE9;
    --line:#D3DAD2; --ink:#14201C; --ink-2:#46564F; --ink-3:#5A6A62;
    --mat:#16715B; --on-mat:#FFFFFF; --radius:10px;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      color-scheme: dark;
      --paper:#101614; --panel:#171F1C; --panel-2:#1E2825;
      --line:#2C3A35; --ink:#E6EDE9; --ink-2:#A7B5AE; --ink-3:#8F9F98;
      --mat:#4FBF9E; --on-mat:#0B1512;
    }
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--paper); color:var(--ink);
    font:16px/1.6 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  .wrap{max-width:760px; margin:0 auto; padding:56px 24px 72px}
  header{border-bottom:1px solid var(--line); padding-bottom:28px; margin-bottom:32px}
  .eyebrow{
    font-family:ui-monospace,"IBM Plex Mono",monospace; font-size:11px; letter-spacing:.16em;
    text-transform:uppercase; color:var(--mat); margin:0 0 10px;
  }
  h1{font-size:38px; line-height:1.15; letter-spacing:-.02em; margin:0 0 12px}
  .dek{font-size:19px; color:var(--ink-2); margin:0; max-width:56ch}
  h2{font-size:15px; text-transform:uppercase; letter-spacing:.1em; color:var(--ink-3);
     margin:40px 0 14px; font-weight:600}
  p{margin:0 0 14px; max-width:66ch}
  pre{
    background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
    padding:14px 16px; overflow-x:auto; margin:0 0 12px;
  }
  code{font-family:ui-monospace,"IBM Plex Mono",monospace; font-size:13.5px}
  pre code{color:var(--ink)}
  .tool{
    border:1px solid var(--line); border-radius:var(--radius); background:var(--panel);
    padding:14px 16px; margin-bottom:10px;
  }
  .tool code{color:var(--mat); font-weight:600; font-size:14px}
  .tool p{margin:6px 0 0; color:var(--ink-2); font-size:14.5px}
  ul{margin:0 0 14px; padding-left:20px; color:var(--ink-2)} li{margin-bottom:7px; max-width:64ch}
  a{color:var(--mat)}
  footer{margin-top:48px; padding-top:22px; border-top:1px solid var(--line);
         color:var(--ink-3); font-size:14px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <p class="eyebrow">MCP server &middot; no API key &middot; no signup</p>
    <h1>A real browser for AI&nbsp;agents</h1>
    <p class="dek">An agent can fetch a URL. It cannot <em>see</em> one. This gives it a genuine
    headless browser over MCP &mdash; hosted, so there is nothing to install.</p>
  </header>

  <main>
    <h2>Add it</h2>
    <pre><code>claude mcp add --transport http render ${ENDPOINT}</code></pre>
    <p>Or point any MCP client at <code>${ENDPOINT}</code> over streamable HTTP. That is the whole
    setup &mdash; no account, no key, no credentials to manage.</p>

    <h2>What it does</h2>
    ${rows}

    <h2>Why not just use a screenshot API</h2>
    <p>If a screenshot is genuinely all you need, use one &mdash; several are free and need no
    signup, and they will beat this on formats and options. The difference is the other three
    tools: reading a browser's console, auditing a rendered page against WCAG, and resolving why
    an element isn't visible. Those need a real layout engine, and an agent has no way to reach
    one.</p>
    <p>Other MCP browsers exist too, and they are good. They install locally &mdash; Node, browser
    binaries, absolute paths. This one runs hosted and stateless, which is the difference between
    an agent being able to use it and not.</p>

    <h2>What it won't do</h2>
    <ul>
      <li>No private networks. Loopback, RFC1918, <code>169.254.x.x</code>, <code>.internal</code>
          and <code>.local</code> are refused &mdash; this runs inside Cloudflare's network.</li>
      <li>No logins. There is no session, so anything behind authentication renders as its
          login page.</li>
      <li>A 20 second navigation limit, and a free-tier capacity ceiling. Failures come back as
          readable text saying <em>which</em> &mdash; ours or the page's.</li>
      <li>Page content is returned marked as untrusted data, not instructions.</li>
    </ul>

    <h2>Privacy</h2>
    <p>URLs and page content are never stored or logged. Only three things are counted &mdash;
    which tool ran, how it ended, and roughly how long it took &mdash; and they are public at
    <a href="/stats">/stats</a>.</p>
  </main>

  <footer>
    <a href="${REPO}">Source on GitHub</a> &middot; MIT &middot;
    <a href="${ENDPOINT}">${ENDPOINT}</a><br>
    Machines get JSON from this URL; people get this page.
  </footer>
</div>
</body>
</html>`;
}
