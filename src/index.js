/**
 * render-mcp — an MCP server that gives an agent a real browser.
 *
 * The protocol logic lives in protocol.js and is tested outside Cloudflare.
 * This file is the thin shell: HTTP transport in, browser work out.
 */

import puppeteer from "@cloudflare/puppeteer";
import { handleRpc, clampNumber, SERVER_INFO, TOOLS } from "./protocol.js";
import { inspectInPage, verdictFor } from "./inspect-page.js";

/** Browser work costs money and time, so cap it hard. */
const NAV_TIMEOUT_MS = 20000;
const SELECTOR_TIMEOUT_MS = 8000;

// Pinned so an upstream change can never alter audit results silently.
const AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
      ...extra
    }
  });
}

function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

/** Open a page with sane defaults. Callers must always close the browser. */
async function openPage(env, url, width, height) {
  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(url, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });
  return { browser, page };
}

async function runTool(name, args, env) {
  const url = args.url;

  if (name === "screenshot_url") {
    const width = clampNumber(args.width, 320, 2560, 1280);
    const height = clampNumber(args.height, 240, 2000, 800);
    const fullPage = args.full_page === true;

    const { browser, page } = await openPage(env, url, width, height);
    try {
      const buf = await page.screenshot({ type: "png", fullPage });
      return {
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: bytesToBase64(buf)
          },
          {
            type: "text",
            text: `Screenshot of ${url} at ${width}x${height}${fullPage ? ", full page" : ""}.`
          }
        ]
      };
    } finally {
      await browser.close();
    }
  }

  if (name === "rendered_html") {
    const maxChars = clampNumber(args.max_chars, 1000, 500000, 100000);
    const { browser, page } = await openPage(env, url, 1280, 800);
    try {
      if (typeof args.wait_for === "string" && args.wait_for.trim() !== "") {
        try {
          await page.waitForSelector(args.wait_for.trim(), { timeout: SELECTOR_TIMEOUT_MS });
        } catch {
          // Not fatal — return whatever rendered, and say so.
        }
      }
      const html = await page.content();
      const truncated = html.length > maxChars;
      const body = truncated ? html.slice(0, maxChars) : html;
      const note = truncated
        ? `\n\n[Truncated at ${maxChars} characters of ${html.length}. Raise max_chars for more.]`
        : "";
      return toolText(body + note);
    } finally {
      await browser.close();
    }
  }

  if (name === "page_diagnostics") {
    const width = clampNumber(args.width, 320, 2560, 1280);
    const height = clampNumber(args.height, 240, 2000, 800);
    const includeWarnings = args.include_warnings === true;

    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });

      const console_ = [];
      const failed = [];
      const badStatus = [];

      // Listeners must be attached before navigation or early events are missed.
      page.on("console", (msg) => {
        const type = msg.type();
        if (type === "error" || type === "warning" || includeWarnings) {
          console_.push({ type, text: String(msg.text()).slice(0, 500) });
        }
      });
      page.on("pageerror", (err) => {
        console_.push({ type: "pageerror", text: String(err?.message || err).slice(0, 500) });
      });
      page.on("requestfailed", (req) => {
        failed.push({
          url: String(req.url()).slice(0, 300),
          reason: String(req.failure()?.errorText || "unknown")
        });
      });
      page.on("response", (res) => {
        const s = res.status();
        if (s >= 400) { badStatus.push({ url: String(res.url()).slice(0, 300), status: s }); }
      });

      const response = await page.goto(url, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });
      const pageStatus = response ? response.status() : null;
      const title = await page.title().catch(() => "");

      const errors = console_.filter((c) => c.type === "error" || c.type === "pageerror");
      const warnings = console_.filter((c) => c.type === "warning");

      const lines = [];
      lines.push(`Page: ${url}`);
      lines.push(`HTTP status: ${pageStatus === null ? "unknown" : pageStatus}`);
      if (title) { lines.push(`Title: ${title}`); }
      lines.push("");

      if (errors.length === 0 && failed.length === 0 && badStatus.length === 0) {
        lines.push("No console errors, no failed requests, no 4xx/5xx responses. The page loaded cleanly.");
      } else {
        if (errors.length) {
          lines.push(`Console errors (${errors.length}):`);
          errors.slice(0, 25).forEach((e) => lines.push(`  - [${e.type}] ${e.text}`));
          if (errors.length > 25) { lines.push(`  ...and ${errors.length - 25} more`); }
          lines.push("");
        }
        if (failed.length) {
          lines.push(`Failed requests (${failed.length}):`);
          failed.slice(0, 25).forEach((f) => lines.push(`  - ${f.reason}  ${f.url}`));
          if (failed.length > 25) { lines.push(`  ...and ${failed.length - 25} more`); }
          lines.push("");
        }
        if (badStatus.length) {
          lines.push(`Responses with 4xx/5xx (${badStatus.length}):`);
          badStatus.slice(0, 25).forEach((b) => lines.push(`  - ${b.status}  ${b.url}`));
          if (badStatus.length > 25) { lines.push(`  ...and ${badStatus.length - 25} more`); }
          lines.push("");
        }
      }

      if (includeWarnings && warnings.length) {
        lines.push(`Console warnings (${warnings.length}):`);
        warnings.slice(0, 25).forEach((w) => lines.push(`  - ${w.text}`));
      }

      return toolText(lines.join("\n").trim());
    } finally {
      await browser.close();
    }
  }

  if (name === "accessibility_audit") {
    const standard = ["wcag2a", "wcag2aa", "wcag21aa", "all"].includes(args.standard)
      ? args.standard
      : "wcag2aa";
    const maxViolations = clampNumber(args.max_violations, 1, 50, 20);

    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      // Some sites' CSP would block an injected script; we are auditing, not modifying.
      await page.setBypassCSP(true);
      await page.goto(url, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });

      // Loaded from CDN rather than bundled — keeps the Worker small.
      await page.addScriptTag({ url: AXE_CDN });
      await page.waitForFunction("typeof window.axe !== 'undefined'", { timeout: 10000 });

      const tags = standard === "all" ? null : [standard];
      const results = await page.evaluate(async (t) => {
        const opts = t ? { runOnly: { type: "tag", values: t } } : {};
        const r = await window.axe.run(document, opts);
        return {
          violations: r.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            count: v.nodes.length,
            samples: v.nodes.slice(0, 3).map((n) => String(n.html).slice(0, 200))
          })),
          passCount: r.passes.length,
          incompleteCount: r.incomplete.length
        };
      }, tags);

      const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
      results.violations.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));

      const total = results.violations.reduce((s, v) => s + v.count, 0);
      const lines = [];
      lines.push(`Accessibility audit of ${url}`);
      lines.push(`Ruleset: ${standard}`);
      lines.push(
        `${results.violations.length} violation type${results.violations.length === 1 ? "" : "s"} ` +
        `across ${total} element${total === 1 ? "" : "s"}. ` +
        `${results.passCount} checks passed, ${results.incompleteCount} need manual review.`
      );
      lines.push("");

      if (results.violations.length === 0) {
        lines.push(`No violations found in the ${standard} ruleset.`);
        lines.push("");
        // A narrow ruleset returning zero is easy to misread as "this page is fine".
        // Say plainly what was not checked.
        if (standard !== "all") {
          lines.push(
            `Note: ${standard} is a narrow filter and ran only ${results.passCount} rules. It excludes ` +
            "best-practice checks such as landmarks and heading order, which commonly fail on pages that " +
            "pass WCAG AA. Re-run with standard=\"all\" for the full picture."
          );
          lines.push("");
        }
        lines.push("Automated testing catches roughly a third of accessibility problems either way —");
        lines.push("keyboard navigation and screen-reader behaviour still need a human.");
      } else {
        results.violations.slice(0, maxViolations).forEach((v) => {
          lines.push(`[${(v.impact || "unknown").toUpperCase()}] ${v.help}`);
          lines.push(`  Rule: ${v.id} · ${v.count} element${v.count === 1 ? "" : "s"}`);
          v.samples.forEach((s) => lines.push(`    ${s}`));
          lines.push(`  How to fix: ${v.helpUrl}`);
          lines.push("");
        });
        if (results.violations.length > maxViolations) {
          lines.push(`...and ${results.violations.length - maxViolations} more violation types.`);
        }
      }

      return toolText(lines.join("\n").trim());
    } finally {
      await browser.close();
    }
  }

  if (name === "inspect_element") {
    const width = clampNumber(args.width, 320, 2560, 1280);
    const height = clampNumber(args.height, 240, 2000, 800);
    const maxMatches = clampNumber(args.max_matches, 1, 10, 3);
    const selector = args.selector;

    const { browser, page } = await openPage(env, url, width, height);
    try {
      const data = await page.evaluate(inspectInPage, selector, maxMatches);

      if (data.badSelector) {
        return toolText(
          `"${selector}" is not a valid CSS selector, so the browser could not run it. ` +
          `Note this takes a CSS selector, not XPath.`,
          true
        );
      }

      const lines = [];
      lines.push(`Inspecting "${selector}" on ${url}`);
      lines.push(`Viewport: ${data.viewport.w}x${data.viewport.h}`);

      if (data.total === 0) {
        lines.push("");
        lines.push(
          "No elements matched. The selector may be wrong, or the content may be rendered later than " +
          "this snapshot — check with rendered_html to see the DOM this page actually produced."
        );
        return toolText(lines.join("\n"));
      }

      lines.push(`${data.total} element${data.total === 1 ? "" : "s"} matched, showing ${data.report.length}.`);
      lines.push("");

      data.report.forEach((e, i) => {
        lines.push(`--- match ${i + 1}: ${e.tag}`);

        // Lead with the diagnosis, since that is the question being asked.
        lines.push(`  ${verdictFor(e)}`);

        lines.push(`  Box: ${e.box.w}x${e.box.h} at (${e.box.x}, ${e.box.y})`);
        lines.push(`  display:${e.display}  visibility:${e.visibility}  opacity:${e.opacity}`);
        lines.push(`  position:${e.position}  z-index:${e.zIndex}  overflow:${e.overflow}`);
        lines.push(`  colour:${e.color} on ${e.background}`);
        lines.push(`  font: ${e.font}`);
        lines.push(`  margin:${e.margin}  padding:${e.padding}`);
        lines.push(`  border:${e.border}`);
        if (e.transform) { lines.push(`  transform:${e.transform}`); }
        lines.push("");
      });

      lines.push(
        "These are post-cascade, post-layout values from a real browser — the same numbers DevTools " +
        "shows. They cannot be derived by reading the HTML and CSS."
      );

      return toolText(lines.join("\n").trim());
    } finally {
      await browser.close();
    }
  }

  if (name === "url_to_pdf") {
    const { browser, page } = await openPage(env, url, 1280, 800);
    try {
      const buf = await page.pdf({
        format: "A4",
        landscape: args.landscape === true,
        printBackground: true
      });
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: url,
              mimeType: "application/pdf",
              blob: bytesToBase64(buf)
            }
          },
          { type: "text", text: `PDF of ${url}.` }
        ]
      };
    } finally {
      await browser.close();
    }
  }

  return toolText(`Tool "${name}" is not implemented.`, true);
}

/** Chunked so a large screenshot doesn't blow the call stack via spread. */
function bytesToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id"
        }
      });
    }

    // A human landing on the URL should learn what this is.
    if (request.method === "GET" && url.pathname !== "/mcp") {
      return json({
        name: SERVER_INFO.name,
        title: SERVER_INFO.title,
        version: SERVER_INFO.version,
        description:
          "An MCP server that gives AI agents a real browser. Screenshots, PDFs, and post-JavaScript HTML. " +
          "No API key, no signup.",
        endpoint: new URL("/mcp", url.origin).toString(),
        transport: "streamable-http",
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description }))
      });
    }

    if (request.method !== "POST") {
      return json({ error: "POST JSON-RPC to /mcp" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    }

    // A batch is an array; a single call is an object. Handle both.
    const requests = Array.isArray(body) ? body : [body];
    const responses = [];

    for (const rpc of requests) {
      let out;
      try {
        out = handleRpc(rpc);
      } catch (err) {
        responses.push({ jsonrpc: "2.0", id: rpc?.id ?? null, error: { code: -32603, message: String(err) } });
        continue;
      }

      if (out === null) continue; // notification

      if (out && out.defer) {
        try {
          const result = await runTool(out.defer, out.args, env);
          responses.push({ jsonrpc: "2.0", id: out.id, result });
        } catch (err) {
          // Browser failures are the agent's problem to route around, not a crash.
          // Tell it *which* problem: our capacity or the page. Blaming the page for
          // our rate limit makes an agent abandon a URL that was fine.
          const raw = String(err?.message || err);
          const isCapacity = /429|rate limit|too many|concurrent|unable to create new browser/i.test(raw);
          const text = isCapacity
            ? `This server is at its rendering capacity right now, so ${out.args.url} was not attempted. ` +
              `Nothing is wrong with the URL — wait a few seconds and retry.`
            : `Could not render ${out.args.url}. ${raw}. ` +
              `The page may be slow, unreachable, or require a login.`;
          responses.push({ jsonrpc: "2.0", id: out.id, result: toolText(text, true) });
        }
        continue;
      }

      responses.push(out);
    }

    if (responses.length === 0) return new Response(null, { status: 202 });
    return json(Array.isArray(body) ? responses : responses[0]);
  }
};
