/**
 * Usage counting — the pure half.
 *
 * Deliberately append-only. Each call writes its own key and nothing is ever read
 * back and rewritten, so concurrent calls cannot lose an increment the way a
 * read-modify-write counter silently does. Counting is exact, not approximate.
 *
 * The key *is* the record: everything the summary needs is encoded in the name,
 * so summarising is a list operation with no values to fetch.
 *
 *   c:2026-09-02:screenshot_url:ok:fast:9f3a1c
 *   │ │          │             │  │    └─ random, so concurrent calls never collide
 *   │ │          │             │  └────── duration bucket
 *   │ │          │             └───────── outcome
 *   │ │          └─────────────────────── tool
 *   │ └────────────────────────────────── UTC day
 *   └──────────────────────────────────── prefix
 *
 * There is deliberately nowhere in that key for a URL, an address or any page
 * content to go. The privacy promise is enforced by the shape of the data, not
 * by remembering to be careful.
 */

/** Coarse enough to be useful, coarse enough to reveal nothing. */
export function durationBucket(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "unknown";
  if (n < 2000) return "fast";
  if (n < 8000) return "mid";
  return "slow";
}

/** UTC, so a summary means the same thing wherever it is read. */
export function utcDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 10);
}

/** Colons separate fields, so no field may contain one. */
function safe(s) {
  return String(s == null ? "unknown" : s).replace(/[^A-Za-z0-9_.-]/g, "_") || "unknown";
}

export function usageKey(tool, outcome, ms, date, rand) {
  return [
    "c",
    utcDay(date),
    safe(tool),
    safe(outcome),
    durationBucket(ms),
    safe(rand)
  ].join(":");
}

/**
 * Turn a list of key names into totals. Unparseable keys are counted separately
 * rather than dropped — silently discarding data would make the summary quietly
 * wrong, which is the one thing a usage report must never be.
 */
export function summarise(keyNames) {
  const out = {
    total: 0,
    malformed: 0,
    byTool: {},
    byOutcome: {},
    byDay: {},
    byBucket: {},
    firstDay: null,
    lastDay: null
  };

  for (const name of keyNames || []) {
    const parts = String(name).split(":");
    if (parts.length < 6 || parts[0] !== "c") { out.malformed++; continue; }
    const [, day, tool, outcome, bucket] = parts;

    out.total++;
    out.byTool[tool] = (out.byTool[tool] || 0) + 1;
    out.byOutcome[outcome] = (out.byOutcome[outcome] || 0) + 1;
    out.byDay[day] = (out.byDay[day] || 0) + 1;
    out.byBucket[bucket] = (out.byBucket[bucket] || 0) + 1;

    if (out.firstDay === null || day < out.firstDay) out.firstDay = day;
    if (out.lastDay === null || day > out.lastDay) out.lastDay = day;
  }

  return out;
}

/** Highest count first, so the interesting row is the first one read. */
function ranked(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * A plain-text report. Says "nothing yet" in as many words when there is nothing,
 * because a page of zeroes reads like a broken counter rather than an honest one.
 */
export function formatSummary(s, opts = {}) {
  const lines = [];
  lines.push("render-mcp — usage");
  lines.push("==================");
  lines.push("");

  if (s.total === 0) {
    lines.push("No tool calls recorded yet.");
    lines.push("");
    lines.push("Counting started when this was deployed, so an empty report means");
    lines.push("nothing has called the server since then — not that counting is broken.");
    if (opts.truncated) lines.push("(Note: the key listing was truncated.)");
    return lines.join("\n");
  }

  lines.push(`${s.total} tool call${s.total === 1 ? "" : "s"}` +
    (s.firstDay ? `, ${s.firstDay} to ${s.lastDay}` : ""));
  lines.push("");

  lines.push("By tool");
  for (const [k, v] of ranked(s.byTool)) lines.push(`  ${String(v).padStart(6)}  ${k}`);
  lines.push("");

  lines.push("By outcome");
  for (const [k, v] of ranked(s.byOutcome)) lines.push(`  ${String(v).padStart(6)}  ${k}`);
  lines.push("");

  lines.push("By day");
  for (const [k, v] of Object.entries(s.byDay).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${String(v).padStart(6)}  ${k}`);
  }
  lines.push("");

  lines.push("Duration  (fast <2s, mid <8s, slow >=8s)");
  for (const [k, v] of ranked(s.byBucket)) lines.push(`  ${String(v).padStart(6)}  ${k}`);

  if (s.malformed) {
    lines.push("");
    lines.push(`${s.malformed} record${s.malformed === 1 ? "" : "s"} could not be parsed.`);
  }
  if (opts.truncated) {
    lines.push("");
    lines.push("Listing was truncated — the totals above are a lower bound.");
  }

  lines.push("");
  lines.push("Only the tool name, outcome and duration bucket are recorded.");
  lines.push("No URLs, addresses, headers or page content — see the README.");

  return lines.join("\n");
}
