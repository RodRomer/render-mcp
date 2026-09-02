/**
 * Tests for usage counting. Pure functions, no KV, no Worker, no network.
 *
 * These matter more than they look. A usage report is the input to the only
 * decisions left for this server — pay for more browser time, add per-call
 * pricing, promote it, or retire it. A counter that is quietly wrong is worse
 * than no counter at all, because it produces confident bad decisions.
 */

import { usageKey, durationBucket, utcDay, summarise, formatSummary } from "../src/usage.js";

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

section("1. Duration buckets");
check("under two seconds is fast", durationBucket(1999), "fast");
check("two seconds exactly is mid", durationBucket(2000), "mid");
check("under eight seconds is mid", durationBucket(7999), "mid");
check("eight seconds exactly is slow", durationBucket(8000), "slow");
check("a negative duration is not silently bucketed", durationBucket(-1), "unknown");
check("a non-number is not silently bucketed", durationBucket("soon"), "unknown");
check("undefined is not silently bucketed", durationBucket(undefined), "unknown");

section("2. Days are UTC, so a report means the same thing anywhere");
check("formats a date", utcDay(new Date("2026-09-02T10:30:00Z")), "2026-09-02");
check("late UTC evening stays on its own day", utcDay(new Date("2026-09-02T23:59:59Z")), "2026-09-02");
check("one second later rolls over", utcDay(new Date("2026-09-03T00:00:00Z")), "2026-09-03");
check("an invalid date is flagged, not guessed", utcDay("not a date"), "unknown");

section("3. Key construction — the privacy boundary");
const k = usageKey("screenshot_url", "ok", 1200, new Date("2026-09-02T10:00:00Z"), "9f3a1c");
check("builds the expected key", k, "c:2026-09-02:screenshot_url:ok:fast:9f3a1c");
check("has exactly six fields", k.split(":").length, 6);

// A colon in any field would corrupt every summary that parses these keys.
const dirty = usageKey("bad:tool", "we:ird", 100, new Date("2026-09-02T00:00:00Z"), "a:b");
check("colons in a field cannot break the format", dirty.split(":").length, 6);
check("  and are replaced, not dropped", dirty, "c:2026-09-02:bad_tool:we_ird:fast:a_b");

// The privacy promise is meant to be structural. Prove a URL cannot survive into
// a key even if one is passed where a tool name belongs.
const leaky = usageKey("https://secret.example.com/path?token=abc", "ok", 10,
  new Date("2026-09-02T00:00:00Z"), "z");
check("a url passed as a tool name cannot produce a usable url", leaky.includes("//"), false);
check("  query strings cannot survive", leaky.includes("?"), false);
check("  and the key still has six fields", leaky.split(":").length, 6);

section("4. Summarising");
const keys = [
  "c:2026-09-01:screenshot_url:ok:fast:a1",
  "c:2026-09-01:screenshot_url:ok:mid:a2",
  "c:2026-09-01:rendered_html:timeout:slow:a3",
  "c:2026-09-02:screenshot_url:capacity:fast:a4",
  "c:2026-09-02:inspect_element:ok:fast:a5"
];
const s = summarise(keys);
check("counts every record", s.total, 5);
check("groups by tool", s.byTool, { screenshot_url: 3, rendered_html: 1, inspect_element: 1 });
check("groups by outcome", s.byOutcome, { ok: 3, timeout: 1, capacity: 1 });
check("groups by day", s.byDay, { "2026-09-01": 3, "2026-09-02": 2 });
check("groups by duration", s.byBucket, { fast: 3, mid: 1, slow: 1 });
check("finds the first day", s.firstDay, "2026-09-01");
check("finds the last day", s.lastDay, "2026-09-02");
check("nothing malformed", s.malformed, 0);

section("5. Bad input is reported, never silently dropped");
const messy = summarise([
  "c:2026-09-01:screenshot_url:ok:fast:a1",
  "garbage",
  "c:too:few:fields",
  "x:2026-09-01:tool:ok:fast:a2",   // wrong prefix
  ""
]);
check("counts only the valid record", messy.total, 1);
check("and reports the rest rather than hiding them", messy.malformed, 4);
check("an empty list is not an error", summarise([]).total, 0);
check("a null list is not an error", summarise(null).total, 0);

section("6. The report");
const empty = formatSummary(summarise([]));
check("empty says so in words", empty.includes("No tool calls recorded yet"), true);
// A page of zeroes reads like a broken counter; say which it is.
check("  and distinguishes 'nothing used it' from 'counting is broken'",
  empty.includes("not that counting is broken"), true);

const report = formatSummary(s);
check("names the busiest tool first", report.indexOf("screenshot_url") < report.indexOf("rendered_html"), true);
check("shows the total", report.includes("5 tool calls"), true);
check("shows the date range", report.includes("2026-09-01 to 2026-09-02"), true);
check("restates what is not recorded", report.includes("No URLs"), true);
check("a single call is not pluralised", formatSummary(summarise(["c:2026-09-01:t:ok:fast:a"])).includes("1 tool call,"), true);

check("truncation is disclosed as a lower bound",
  formatSummary(s, { truncated: true }).includes("lower bound"), true);
check("malformed records are surfaced in the report",
  formatSummary(messy).includes("could not be parsed"), true);

console.log(`\n========================================`);
console.log(`  PASSED: ${pass}    FAILED: ${fail}`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
