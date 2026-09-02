/**
 * MCP protocol layer — pure functions, no Worker or browser dependencies.
 *
 * Kept separate so it can be tested outside Cloudflare entirely, the same way the
 * calculators' maths was tested outside the browser. Everything here is
 * deterministic: given a JSON-RPC request, produce a JSON-RPC response.
 */

export const PROTOCOL_VERSION = "2025-06-18";

export const SERVER_INFO = {
  name: "render-mcp",
  title: "Render — a real browser for agents",
  version: "0.1.0"
};

/** Tool definitions, exactly as advertised over MCP. */
export const TOOLS = [
  {
    name: "screenshot_url",
    description:
      "Take a screenshot of a web page as it actually renders in a real browser, after JavaScript has run. " +
      "Use this when you need to see a page rather than read it — checking a layout, confirming a site is up " +
      "and looks right, or capturing what a user would actually see. Returns a PNG image.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The absolute URL to capture, including https://" },
        full_page: {
          type: "boolean",
          description: "Capture the entire scrollable page rather than just the viewport. Defaults to false.",
          default: false
        },
        width: { type: "number", description: "Viewport width in pixels. 320-2560. Defaults to 1280.", default: 1280 },
        height: { type: "number", description: "Viewport height in pixels. 240-2000. Defaults to 800.", default: 800 }
      },
      required: ["url"]
    }
  },
  {
    name: "rendered_html",
    description:
      "Fetch a page's HTML *after* JavaScript has executed. Use this when a plain HTTP fetch returns an empty " +
      "shell or a loading spinner — single-page apps, sites that build their content client-side, or anything " +
      "behind a framework. Returns the final DOM as HTML text.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The absolute URL to load, including https://" },
        wait_for: {
          type: "string",
          description: "Optional CSS selector to wait for before capturing, for pages that load content late."
        },
        max_chars: {
          type: "number",
          description: "Truncate the returned HTML to this many characters. Defaults to 100000.",
          default: 100000
        }
      },
      required: ["url"]
    }
  },
  {
    name: "page_diagnostics",
    description:
      "Load a page in a real browser and report what went wrong: JavaScript console errors and warnings, " +
      "network requests that failed, and the HTTP status of the page itself. Use this when a site looks " +
      "broken, a deployment might have shipped a bug, or a page loads blank and you need to know why. " +
      "An agent cannot see a browser's console any other way.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The absolute URL to load, including https://" },
        include_warnings: {
          type: "boolean",
          description: "Include console warnings and info messages, not just errors. Defaults to false.",
          default: false
        },
        width: { type: "number", description: "Viewport width in pixels. 320-2560. Defaults to 1280.", default: 1280 },
        height: { type: "number", description: "Viewport height in pixels. 240-2000. Defaults to 800.", default: 800 }
      },
      required: ["url"]
    }
  },
  {
    name: "accessibility_audit",
    description:
      "Run a WCAG accessibility audit on a page using axe-core in a real browser, and report the violations " +
      "with the elements responsible. Because it runs against a genuinely rendered page, colour-contrast and " +
      "other rules that depend on layout and computed colour actually fire — these are silently skipped by " +
      "audits that parse HTML without a layout engine. Use this to check a page meets WCAG before shipping.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The absolute URL to audit, including https://" },
        standard: {
          type: "string",
          description:
            "Which ruleset to run: 'wcag2a', 'wcag2aa' (the usual legal benchmark), 'wcag21aa', or 'all'. " +
            "Defaults to wcag2aa.",
          enum: ["wcag2a", "wcag2aa", "wcag21aa", "all"],
          default: "wcag2aa"
        },
        max_violations: {
          type: "number",
          description: "Maximum violation types to report in detail. 1-50. Defaults to 20.",
          default: 20
        }
      },
      required: ["url"]
    }
  },
  {
    name: "url_to_pdf",
    description:
      "Render a web page to PDF exactly as a browser would print it. Use this to archive a page, produce a " +
      "document from a rendered report, or capture something for a record. Returns a PDF file.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The absolute URL to render, including https://" },
        landscape: { type: "boolean", description: "Landscape orientation. Defaults to false.", default: false }
      },
      required: ["url"]
    }
  }
];

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Only http(s), and never a private or loopback host — a Worker sits inside
 * Cloudflare's network, so an unchecked URL is a server-side request forgery.
 */
export function validateUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "A url is required." };
  }
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: `Not a valid URL: ${raw}. Include the scheme, for example https://example.com` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `Unsupported scheme "${u.protocol}". Only http and https are allowed.` };
  }

  const host = u.hostname.toLowerCase();
  const blockedExact = ["localhost", "0.0.0.0", "[::1]", "::1", "metadata.google.internal"];
  if (blockedExact.includes(host)) {
    return { ok: false, error: "Refusing to fetch a loopback or metadata address." };
  }
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, error: "Refusing to fetch an internal hostname." };
  }
  // IPv4 literals in private ranges
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (isPrivate) {
      return { ok: false, error: "Refusing to fetch a private network address." };
    }
  }
  return { ok: true, url: u.toString() };
}

/** Clamp a numeric argument into a supported range, falling back to a default. */
export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/* ------------------------------------------------------------------ */
/* JSON-RPC                                                            */
/* ------------------------------------------------------------------ */

export function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * Handle every MCP method that needs no browser. Returns a response object, or
 * `{ defer: "toolName", args }` when the caller must go and do real work.
 * Returns null for notifications, which take no reply.
 */
export function handleRpc(req) {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return jsonRpcError(req?.id ?? null, -32600, "Invalid JSON-RPC 2.0 request.");
  }

  const { id, method, params } = req;

  // Notifications have no id and expect no response.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Gives you a real browser. Use screenshot_url to see a page, rendered_html when a plain fetch " +
          "returns an empty shell, and url_to_pdf to archive one. No API key or signup is needed."
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        return jsonRpcError(id, -32602, `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(", ")}`);
      }
      const check = validateUrl(params?.arguments?.url);
      if (!check.ok) {
        // Tool-level failures are results with isError, not protocol errors.
        return jsonRpcResult(id, { content: [{ type: "text", text: check.error }], isError: true });
      }
      return { defer: name, args: { ...(params?.arguments || {}), url: check.url }, id };
    }

    default:
      if (isNotification) return null;
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}
