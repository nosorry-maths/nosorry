// Writes worker/fc-modules.txt: every FormalConjectures.* module imported by a stored statement, so the
// verifier image (Dockerfile.verifier) prebuilds them. Run after importing problems, then rebuild the image.
import pg from "pg";
import fs from "node:fs";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await c.connect();
const { rows } = await c.query(`SELECT DISTINCT trim(m) AS m FROM (SELECT (regexp_matches(challenge_source, 'import (FormalConjectures[.][^\n]+)', 'g'))[1] AS m FROM problem_versions) x ORDER BY 1`);
fs.writeFileSync(new URL("../worker/fc-modules.txt", import.meta.url), rows.map((r) => r.m).join("\n") + "\n");
console.log(`worker/fc-modules.txt: ${rows.length} modules`);
await c.end();
