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
