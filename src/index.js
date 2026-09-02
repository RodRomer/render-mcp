/**
 * render-mcp — an MCP server that gives an agent a real browser.
 *
 * The protocol logic lives in protocol.js and is tested outside Cloudflare.
 * This file is the thin shell: HTTP transport in, browser work out.
 */

import puppeteer from "@cloudflare/puppeteer";
import { handleRpc, clampNumber, SERVER_INFO, TOOLS } from "./protocol.js";

/** Browser work costs money and time, so cap it hard. */
const NAV_TIMEOUT_MS = 20000;
const SELECTOR_TIMEOUT_MS = 8000;

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
