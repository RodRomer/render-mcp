/**
 * Tests for the Claude Code plugin manifests.
 *
 * Why these matter: the manifests are only exercised when a real user runs
 * `/plugin marketplace add`, and a mistake surfaces as an install failure on
 * someone else's machine — the worst place to discover one. The failure modes
 * are all cheap to check here: a source path that does not exist, a name that
 * disagrees between the two files, a version that drifts from the server's, or
 * an endpoint that does not match what the server actually serves.
 *
 * The install itself cannot be tested without an interactive client, so these
 * check everything that can be checked without one, and nothing is asserted
 * about behaviour that was not verified.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SERVER_INFO } from "../src/protocol.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

function section(t) { console.log(`\n=== ${t} ===`); }

const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

section("1. The files exist where Claude Code looks for them");
for (const p of [
  ".claude-plugin/marketplace.json",
  "plugins/render/.claude-plugin/plugin.json",
  "plugins/render/.mcp.json"
]) {
  check(`${p} exists`, existsSync(join(root, p)), true);
}

const marketplace = read(".claude-plugin/marketplace.json");
const plugin = read("plugins/render/.claude-plugin/plugin.json");
const mcp = read("plugins/render/.mcp.json");

section("2. The marketplace catalog");
check("has a name", typeof marketplace.name, "string");
check("names an owner", typeof marketplace.owner.name, "string");
check("lists exactly one plugin", marketplace.plugins.length, 1);
check("the name is kebab-case with no spaces", /^[a-z0-9-]+$/.test(marketplace.name), true);
// `claude plugin validate` warns when this is absent, and the review pipeline
// runs that same check. Found by running the official validator, not by reading.
check("the marketplace itself has a description", (marketplace.description || "").length > 30, true);

section("3. The catalog entry and the plugin manifest agree");
// A mismatch here is an install failure on a stranger's machine.
check("names match", marketplace.plugins[0].name, plugin.name);
check("the source path actually exists",
  existsSync(join(root, marketplace.plugins[0].source)), true);
check("the source points at the directory holding the manifest",
  existsSync(join(root, marketplace.plugins[0].source, ".claude-plugin", "plugin.json")), true);
check("both carry a description",
  marketplace.plugins[0].description.length > 40 && plugin.description.length > 40, true);

section("4. The plugin manifest");
check("plugin name is kebab-case", /^[a-z0-9-]+$/.test(plugin.name), true);
// Drift here means users install a plugin claiming a version the server isn't on.
check("version matches the server's", plugin.version, SERVER_INFO.version);
check("declares a licence", plugin.license, "MIT");
check("points at the live page", plugin.homepage, "https://render.makermargins.com/");
check("points at the repository", plugin.repository.includes("github.com/RodRomer/render-mcp"), true);

section("4b. The LobeHub marketplace manifest");
// LobeHub auto-crawled this repo at v0.1.0 and froze there, listing no tools.
// This manifest is how the listing gets corrected, and the version must track
// the server or the same drift returns silently.
const lhm = read("lhm.plugin.json");
check("declares the identifier LobeHub already assigned", lhm.identifier, "rodromer-render-mcp");
check("version tracks the server", lhm.version, SERVER_INFO.version);
check("carries a substantial description", lhm.description.length > 60, true);
check("name is set", lhm.name.length > 0, true);

section("4c. The official registry manifest (server.json)");
// This file was the one version surface NOT covered here, and it drifted: while
// plugin.json and lhm.plugin.json listed all six capabilities, server.json still
// advertised "screenshots, PDFs, post-JS HTML" — the three things ~300 other
// registry servers already do — and named none of the three that a full census of
// 26,493 live servers showed almost nobody else offers.
//
// The cause is structural and worth naming: server.json's description is capped at
// 100 characters by the registry schema, so it is the only manifest forced to
// *choose* what to lead with. The unconstrained files never had to, so they never
// went wrong. A cap turns an omission into a decision.
const server = read("server.json");
check("version matches the server's", server.version, SERVER_INFO.version);
check("registry name is the io.github form", server.name, "io.github.RodRomer/render-mcp");
// Hard schema limit. Exceeding it is rejected at publish time, in CI, after a push.
check("description is within the schema's 100-char cap", server.description.length <= 100, true);
check("description is not empty", server.description.length >= 1, true);
// Positioning, corrected by verdict 82 after measuring npm rather than the registry.
//
// The first version of this test asserted we lead with console/element/WCAG, on the
// belief those capabilities were scarce. They are not: Google's chrome-devtools-mcp
// (10M npm downloads/month, 29 tools) and Microsoft's @playwright/mcp (24M/month,
// 24 tools) both do all of them, and both are better resourced than we will ever be.
// Leading on capability is leading with our weakest hand.
//
// What neither can offer is running with nothing installed. Playwright MCP needs npx,
// Node and browser binaries; chrome-devtools-mcp needs a local Chrome. That property
// is structural, not a feature they can ship, so it is what the description leads on.
check("leads with the hosted / zero-install property, not a capability",
  /^hosted|no install|nothing to install/i.test(server.description), true);
// Capability words still have to appear: descriptions are what keyword search matches,
// and this field is the only indexed text the registry holds.
check("still carries capability keywords for search",
  /screenshot|console|DOM|WCAG/i.test(server.description), true);
check("states the keyless property", /no API key|keyless/i.test(server.description), true);
check("points the website at the human landing page, not the repo",
  server.websiteUrl, "https://render.makermargins.com/");
check("declares the streamable-http remote", server.remotes[0].url,
  "https://render.makermargins.com/mcp");

section("5. The MCP server declaration");
const servers = Object.keys(mcp.mcpServers);
check("declares exactly one server", servers.length, 1);
const s = mcp.mcpServers[servers[0]];
check("is a remote http server", s.type, "http");
check("points at the real endpoint", s.url, "https://render.makermargins.com/mcp");
// The point of a hosted server is that a plugin ships no binaries and runs no
// local process. A command here would silently reintroduce the install step
// that this whole approach exists to remove.
check("declares no local command", s.command, undefined);
check("declares no args", s.args, undefined);
check("requires no environment variables", s.env, undefined);

section("6. Nothing secret is shipped in the plugin");
const raw = readFileSync(join(root, "plugins/render/.mcp.json"), "utf8") +
            readFileSync(join(root, "plugins/render/.claude-plugin/plugin.json"), "utf8");
check("no token-shaped strings", /(token|secret|api[_-]?key)"\s*:\s*"[^"]{8,}/i.test(raw), false);
check("no bearer headers", /bearer /i.test(raw), false);

console.log(`\n========================================`);
console.log(`  PASSED: ${pass}    FAILED: ${fail}`);
console.log(`========================================`);
process.exit(fail === 0 ? 0 : 1);
