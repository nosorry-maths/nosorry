// Keeps the skill's bundled copy of the static rules identical to the server's, and the version of the agent tools
// (CLI, MCP server) equal to shared/version.mjs, which the server advertises at GET /api/v1/meta.
import fs from "node:fs";
import { CLIENT_VERSION } from "../shared/version.mjs";

const src = fs.readFileSync("shared/preflight.mjs", "utf8");
fs.writeFileSync("skill/nosorry/lib/preflight.mjs", "// copy of ../../shared/preflight.mjs — keep in sync (scripts/sync-skill.mjs)\n" + src);
console.log("skill/nosorry/lib/preflight.mjs updated");

for (const f of ["skill/nosorry/bin/nosorry.mjs", "skill/nosorry/bin/nosorry-mcp.mjs"]) {
  const s = fs.readFileSync(f, "utf8");
  const next = s.replace(/^const VERSION = "[^"]*";/m, `const VERSION = "${CLIENT_VERSION}";`);
  if (!/^const VERSION = "/m.test(s)) throw new Error(`${f}: no VERSION constant`);
  if (next !== s) { fs.writeFileSync(f, next); console.log(`${f}: VERSION set to ${CLIENT_VERSION}`); }
}
const skill = fs.readFileSync("skill/nosorry/SKILL.md", "utf8");
const skillNext = skill.replace(/<!-- nosorry agent tools [^ ]+ /, `<!-- nosorry agent tools ${CLIENT_VERSION} `);
if (skillNext !== skill) { fs.writeFileSync("skill/nosorry/SKILL.md", skillNext); console.log(`SKILL.md: version ${CLIENT_VERSION}`); }
console.log(`agent tools at version ${CLIENT_VERSION}`);
