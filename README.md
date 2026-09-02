# render-mcp

**Gives an AI agent a real browser.** Screenshots, PDFs, and the HTML a page produces *after*
JavaScript has run.

No API key. No signup. No account. Point your client at a URL and it works.

```
https://render.makermargins.com/mcp
```

---

## Why this exists

An agent can fetch a URL. It cannot *see* one.

Ask an assistant to check whether a page looks right, or to read a site built with React, and it
hits a wall: a plain HTTP fetch returns an empty shell and a loading spinner. The content is
built by JavaScript that never runs.

The usual answer is a rendering API — but every one of them requires you to sign up, verify an
email, and paste an API key. **An agent working on its own can't do any of that.** It has no
inbox and no card. A free tier it cannot register for is worth nothing to it.

This server needs none of it. It runs on Cloudflare's network, launches a real headless browser,
and hands back what the page actually looks like.

## Install

**Claude Code**

```bash
claude mcp add --transport http render https://render.makermargins.com/mcp
```

**Claude Desktop, Cursor, and other clients** — add to your MCP config:

```json
{
  "mcpServers": {
    "render": {
      "type": "http",
      "url": "https://render.makermargins.com/mcp"
    }
  }
}
```

That's the whole setup. Nothing to install, nothing to configure, no credentials.

## Tools

### `screenshot_url`

See a page as a person would. Returns a PNG.

| Argument | Type | Notes |
|---|---|---|
| `url` | string | **Required.** Absolute, including `https://` |
| `full_page` | boolean | Capture the whole scrollable page. Default `false` |
| `width` | number | Viewport width, 320–2560. Default `1280` |
| `height` | number | Viewport height, 240–2000. Default `800` |

Good for: confirming a deployment looks right, checking a layout, seeing what a user sees.

### `rendered_html`

The DOM *after* JavaScript has executed. Returns HTML text.

| Argument | Type | Notes |
|---|---|---|
| `url` | string | **Required.** Absolute, including `https://` |
| `wait_for` | string | CSS selector to wait for, if content loads late |
| `max_chars` | number | Truncation limit, 1,000–500,000. Default `100000` |

Good for: single-page apps, anything where a plain fetch returns a shell.

### `page_diagnostics`

Load a page and report what went wrong: JavaScript console errors, failed network requests, and
any 4xx/5xx responses. Returns a readable summary.

| Argument | Type | Notes |
|---|---|---|
| `url` | string | **Required.** Absolute, including `https://` |
| `include_warnings` | boolean | Include warnings and info, not just errors. Default `false` |
| `width` | number | Viewport width, 320–2560. Default `1280` |
| `height` | number | Viewport height, 240–2000. Default `800` |

Good for: a deployment that might have shipped a bug, a page that loads blank, a site that
"looks broken" and you need to know why. **An agent cannot see a browser console any other way.**

Playwright MCP can do this too — but it must be installed locally, with Node and browser
binaries present, and its HTTP mode has known session bugs. This runs hosted, stateless, with
nothing to install.

### `inspect_element`

Answers *"why isn't this element showing where I expect?"* for a CSS selector.

| Argument | Type | Notes |
|---|---|---|
| `url` | string | **Required.** Absolute, including `https://` |
| `selector` | string | **Required.** CSS selector, e.g. `.buy-button` |
| `max_matches` | number | How many matches to report, 1–10. Default `3` |
| `width` | number | Viewport width, 320–2560. Default `1280` |
| `height` | number | Viewport height, 240–2000. Default `800` |

Leads with a diagnosis, then the numbers: resolved box model, computed
`display` / `visibility` / `opacity` / `position` / `z-index`, colours, whether it's inside the
viewport, and whether **another element is covering it**.

The useful part is that it walks *up* the tree. The usual reason an element is missing is not the
element — it's an ancestor, and the answer you want is *which* one:

```
--- match 1: button#buy
  HIDDEN BY AN ANCESTOR — div.modal.panel has display:none. The element itself is fine.
```

It also catches the case no single property reveals. Content inside a closed `<details>` keeps a
normal box and reports `display:block`, `visibility:visible`, `opacity:1` — everything looks fine,
and it still doesn't paint:

```
  NOT RENDERED — it sits inside details.fees, which is not displaying its
  contents because of a closed <details>.
  Box: 70x27 ...  display:block  visibility:visible  opacity:1
```

Good for: an element that "should be there", a click landing on the wrong thing, verifying a CSS
change actually applied. **Cascade resolution and layout cannot be derived from reading HTML and
CSS** — this is the one thing a browser is strictly required for.

### `url_to_pdf`

Render a page to PDF as a browser would print it.

| Argument | Type | Notes |
|---|---|---|
| `url` | string | **Required.** Absolute, including `https://` |
| `landscape` | boolean | Default `false` |

Good for: archiving a page, turning a rendered report into a document.

## What it won't do

Stated plainly, so an agent doesn't waste calls discovering them:

- **No private networks.** Loopback, RFC1918 ranges, `169.254.x.x`, `.internal` and `.local`
  hostnames are refused. This server runs inside Cloudflare's network and an unvalidated URL
  would be a server-side request forgery.
- **No logins.** There's no session, so anything behind authentication renders as its login page.
- **20 second navigation limit.** Very slow pages will time out.
- **No JavaScript injection.** It renders pages; it doesn't run your code on them.

Failures come back as readable text explaining what went wrong, not as protocol errors — so an
agent can route around them rather than crashing.

## Privacy

**URLs and page content are never stored or logged.** Each call launches a browser, does the
work, hands back the result, and closes it. Nothing about *what* you asked for is retained.

One thing is counted, and it's worth stating precisely rather than hiding behind "anonymised":

| Recorded | Not recorded |
|---|---|
| Which tool ran (`screenshot_url`, …) | The URL, or any part of it |
| How it ended (`ok`, `timeout`, `capacity`, …) | Your IP address |
| How long it took, in milliseconds | Any header, cookie or credential |
| | Any page content, image or PDF |

That's three fields with no way to tie them to a request, a person or a site. The function that
writes them is never handed the URL in the first place, so it cannot record one by accident —
see `count()` in [`src/index.js`](src/index.js).

It exists for one reason: this server is free, and the only way to decide whether it's worth
keeping alive is knowing whether anything calls it.

The counts are public — no login, no dashboard:

```
https://render.makermargins.com/stats
```

## Development

```bash
npm install
npm test          # 151 tests (protocol + usage), no network or browser needed
npm run test:dom  # 39 DOM tests, headless Edge/Chrome, no network
npm run dev       # local worker
npm run deploy    # to Cloudflare
```

Two layers, both tested outside their host:

- **`src/protocol.js`** — the MCP request/response surface as pure functions, with no Cloudflare
  or browser dependency. Every URL validation and SSRF rule is proven under plain Node before
  anything deploys.
- **`src/inspect-page.js`** — the half of `inspect_element` that runs *inside* the page. It closes
  over nothing, so any real DOM can execute it. Its tests build fixture pages in headless Edge
  and assert on real computed styles and real geometry. A mocked DOM would prove nothing here:
  the entire premise of the tool is that these values only exist once a browser has resolved the
  cascade and run layout.

`src/index.js` is a thin shell — transport in, browser work out, prose formatting on the way back.

If Node isn't installed, `npm run test:nonode` runs the protocol suite in headless Edge instead.
It strips only the `export`/`import` keywords and executes the same source.

### When testing against a live page, use a neutral URL

Use `https://example.com` — it is reserved by IANA for exactly this — or `httpstat.us` for error
paths. **Do not point live tests at `makermargins.com`.**

The reason is not politeness. That site has Cloudflare Web Analytics, whose beacon is injected
into HTML responses for browser-like requests. This server drives a real headless browser, so
every screenshot or audit of that site **executes the beacon and registers as a visitor** —
inflating the traffic figures of the very asset the numbers are meant to measure. An instrument
that counts its own operator measures nothing.

## Status

Early and free. Built to find out whether MCP registry discovery actually works. If it gets
used, it'll be maintained; if it doesn't, that's a useful answer too.

Issues and pull requests welcome.

## Licence

MIT
