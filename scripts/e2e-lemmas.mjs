#!/usr/bin/env node
// End-to-end test of intermediate lemmas, the MCP tools and the update notice. Run it ONLY against a disposable copy
// of the database: it creates accounts, lemmas and submissions.
//   DATABASE_URL=postgres://…/nosorry_preview node scripts/e2e-lemmas.mjs --url http://localhost:3101
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const BASE = (args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3101").replace(/\/$/, "");
const DB = process.env.DATABASE_URL;
if (!DB || !/preview|test|e2e/.test(DB)) { console.error("refusing: DATABASE_URL must point to a disposable copy (name containing preview/test/e2e)"); process.exit(2); }
const PARENT = args.includes("--parent") ? args[args.indexOf("--parent") + 1] : "wotw-graphconjecture96";

let failed = 0, passed = 0;
const ok = (n, c, x = "") => { if (c) { passed++; console.log(`  ok    ${n}`); } else { failed++; console.log(`  FAIL  ${n}${x ? ` — ${x}` : ""}`); } };
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = new pg.Client({ connectionString: DB }); await db.connect();

async function user(handle) {
  const { rows: [u] } = await db.query("INSERT INTO users(handle, password_hash) VALUES ($1,'scrypt$disabled') ON CONFLICT (handle) DO UPDATE SET handle=EXCLUDED.handle RETURNING id", [handle]);
  const prefix = crypto.randomBytes(4).toString("hex"), key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
  await db.query("INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,$4)", [u.id, prefix, crypto.createHash("sha256").update(key).digest("hex"), ["submit", "read"]]);
  return { id: u.id, handle, key };
}
async function call(u, method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { "content-type": "application/json", ...(u ? { authorization: `Bearer ${u.key}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
  return { status: r.status, j };
}
async function waitSub(u, id, s = 300) {
  for (let i = 0; i < s / 3; i++) { const r = await call(u, "GET", `/api/v1/submissions/${id}`); if (r.j?.done) return r.j; await sleep(3000); }
  return null;
}
async function waitLemma(slug, s = 300) {
  for (let i = 0; i < s / 3; i++) { const { rows: [l] } = await db.query("SELECT lemma_state, lemma_note FROM problems WHERE slug=$1", [slug]); if (l && l.lemma_state !== "checking") return l; await sleep(3000); }
  return null;
}

const tag = crypto.randomBytes(2).toString("hex");
const K = 1000 + crypto.randomInt(9_000_000);   // a statement unique to this run (duplicates are detected by statement)
const STMT = `(n : ℕ) : n + ${K} = ${K} + n`;
const A = await user(`e2e_alice_${tag}`), B = await user(`e2e_bob_${tag}`);

section(`Proposals on ${PARENT}`);
const name = `nosorry_e2e_add_zero_${tag}`;
const p1 = await call(A, "POST", `/api/v1/problems/${PARENT}/lemmas`, { name, statement: STMT, note: "warm-up lemma for the e2e test" });
ok("propose a valid lemma (201)", p1.status === 201 && p1.j.slug, JSON.stringify(p1.j).slice(0, 200));
const slug = p1.j.slug;
const dup = await call(A, "POST", `/api/v1/problems/${PARENT}/lemmas`, { name, statement: `theorem x ${STMT} := by omega` });
ok("same lemma again is reported as existing", dup.status === 200 && dup.j.existing === true, JSON.stringify(dup.j).slice(0, 160));
const inj = await call(A, "POST", `/api/v1/problems/${PARENT}/lemmas`, { name: `inj_${tag}`, statement: "(n : ℕ) : True\naxiom cheat : False" });
ok("command injection in a statement is refused (400)", inj.status === 400, JSON.stringify(inj.j).slice(0, 160));
const noType = await call(A, "POST", `/api/v1/problems/${PARENT}/lemmas`, { name: `notype_${tag}`, statement: "(n : ℕ)" });
ok("statement without a type is refused (400)", noType.status === 400);
const badName = await call(A, "POST", `/api/v1/problems/${PARENT}/lemmas`, { name: "bad name", statement: "(n : ℕ) : n = n" });
ok("invalid Lean name is refused (400)", badName.status === 400);
const bogus = await call(A, "POST", `/api/v1/problems/${PARENT}/lemmas`, { name: `bogus_${tag}`, statement: "(n : ℕ) : thisIdentifierDoesNotExist n" });
ok("a statement that does not compile is accepted for checking (201)", bogus.status === 201, JSON.stringify(bogus.j).slice(0, 160));

section("Statement checks (worker)");
const l1 = await waitLemma(slug);
ok("valid lemma becomes open", l1?.lemma_state === "open", JSON.stringify(l1));
const l2 = await waitLemma(bogus.j.slug);
ok("non-compiling lemma becomes invalid, with the reason", l2?.lemma_state === "invalid" && /error/i.test(l2.lemma_note ?? ""), JSON.stringify(l2).slice(0, 200));
const list = await call(null, "GET", `/api/v1/problems/${PARENT}/lemmas`);
ok("list_lemmas shows the open lemma", (list.j.lemmas ?? []).some((x) => x.name === name && x.state === "open"));
const st = await call(null, "GET", `/api/v1/problems/${PARENT}/state`);
ok("problem_state includes lemmas", (st.j.lemmas ?? []).some((x) => x.name === name));

section("Proving the lemma");
const lp = await call(null, "GET", `/api/v1/problems/${slug}`);
const challenge = lp.j.challenge_source ?? "";
ok("the lemma has its own Challenge.lean with the lemma inside", challenge.includes(`theorem ${name} ${STMT} := by\n  sorry`), challenge.slice(-300));
const proof = challenge.replace(`theorem ${name} ${STMT} := by\n  sorry`, `theorem ${name} ${STMT} := by\n  omega`);
const s1 = await call(A, "POST", "/api/v1/submissions", { problem: slug, kind: "proof", lean_source: proof, agent: { name: "e2e" } });
ok("submit a proof of the lemma", s1.status === 202, JSON.stringify(s1.j).slice(0, 200));
const v1 = s1.j.id ? await waitSub(A, s1.j.id) : null;
ok("lemma proof verified", v1?.status === "verified", v1 ? `${v1.status} ${JSON.stringify(v1.latest_run?.stages?.filter((x) => x.status !== "pass") ?? [])}` : "timeout");
const { rows: [after] } = await db.query("SELECT l.lemma_state, s.visibility, (SELECT coalesce(sum(delta),0) FROM point_events WHERE user_id=$2 AND submission_id=s.id)::int AS pts FROM problems l JOIN submissions s ON s.problem_id=l.id AND s.public_id=$3 WHERE l.slug=$1", [slug, A.id, s1.j.id]);
// Proving a lemma you proposed yourself earns the "later" amount (1): the anti-farming rule for statement authors.
ok("lemma marked proved, proof published, +1 (own lemma: no first-proof bonus)", after?.lemma_state === "proved" && after.visibility === "public" && after.pts === 1, JSON.stringify(after));

section("Reusing the lemma in a proof of the parent");
const { rows: [ref] } = await db.query(`SELECT s.lean_source FROM submissions s JOIN problems p ON p.id=s.problem_id WHERE p.slug=$1 AND s.kind='proof' AND s.status='verified' ORDER BY s.id LIMIT 1`, [PARENT]);
if (!ref) ok("a verified proof of the parent exists to build on", false, "none in this database");
else {
  // Paste the lemma before the main theorem and make the proof depend on it.
  const lemmaDecl = `theorem ${name} ${STMT} := by\n  omega\n\n`;
  let src = ref.lean_source.replace(/^theorem conjecture96/m, `${lemmaDecl}theorem conjecture96`);
  src = src.replace(/(theorem conjecture96[\s\S]*?:= by\n)/, `$1  have _e2e := ${name} 0\n`);
  ok("built a parent proof that uses the lemma", src.includes(lemmaDecl) && src.includes(`have _e2e := ${name} 0`));
  const s2 = await call(B, "POST", "/api/v1/submissions", { problem: PARENT, kind: "proof", lean_source: src, agent: { name: "e2e" } });
  const v2 = s2.j.id ? await waitSub(B, s2.j.id, 420) : null;
  ok("parent proof using the lemma is verified", v2?.status === "verified", v2 ? `${v2.status} ${JSON.stringify(v2.latest_run?.stages?.filter((x) => x.status !== "pass") ?? []).slice(0, 400)}` : JSON.stringify(s2.j).slice(0, 200));
  const { rows: [use] } = await db.query(`SELECT (SELECT count(*)::int FROM lemma_uses u JOIN problems l ON l.id=u.lemma_id WHERE l.slug=$1) AS uses,
      (SELECT coalesce(sum(delta),0)::int FROM point_events WHERE user_id=$2 AND reason LIKE 'lemma_used:%') AS credit`, [slug, A.id]);
  ok("usage recorded and the lemma's prover credited (+3)", use.uses === 1 && use.credit === 3, JSON.stringify(use));
}

section("Sharing the open lemmas of a partial proof");
const { rows: [part] } = await db.query(`SELECT s.public_id, s.user_id, u.handle FROM submissions s JOIN users u ON u.id=s.user_id WHERE s.status='partial' ORDER BY s.id DESC LIMIT 1`);
if (!part) ok("a partial proof exists", false, "none in this database");
else {
  const prefix = crypto.randomBytes(4).toString("hex"), key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
  await db.query("INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,$4)", [part.user_id, prefix, crypto.createHash("sha256").update(key).digest("hex"), ["submit", "read"]]);
  const owner = { key };
  const notOwner = await call(B, "POST", `/api/v1/submissions/${part.public_id}/share-lemmas`);
  ok("someone else cannot share your open lemmas (400)", notOwner.status === 400);
  const sh = await call(owner, "POST", `/api/v1/submissions/${part.public_id}/share-lemmas`);
  ok("the author shares the open lemmas", sh.status === 200 && Array.isArray(sh.j.lemmas), JSON.stringify(sh.j).slice(0, 300));
  for (const l of (sh.j.lemmas ?? []).filter((x) => x.ok && !x.existing)) {
    const r = await waitLemma(l.slug, 420);
    ok(`shared lemma ${l.name} checked (${r?.lemma_state})`, r && r.lemma_state !== "checking", JSON.stringify(r).slice(0, 300));
  }
  const again = await call(owner, "POST", `/api/v1/submissions/${part.public_id}/share-lemmas`);
  ok("sharing twice does not duplicate", (again.j.lemmas ?? []).every((x) => !x.ok || x.existing), JSON.stringify(again.j).slice(0, 200));
}

section("Library search");
const sr = await call(null, "GET", `/api/v1/lemmas?q=${encodeURIComponent(name)}&state=all`);
ok("search_lemmas finds the lemma", (sr.j.lemmas ?? []).some((x) => x.name === name && x.state === "proved"), JSON.stringify(sr.j).slice(0, 200));

section("MCP server");
async function mcp(file, calls) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [file], { env: { ...process.env, NOSORRY_URL: BASE, NOSORRY_API_KEY: A.key } });
    let out = ""; p.stdout.on("data", (d) => { out += d; });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
    calls.forEach((c, i) => send({ jsonrpc: "2.0", id: i + 2, ...c }));
    setTimeout(() => { p.kill(); resolve(out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } })); }, 9000);
  });
}
const MCP = path.resolve("skill/nosorry/bin/nosorry-mcp.mjs");
const r1 = await mcp(MCP, [{ method: "tools/list" }, { method: "tools/call", params: { name: "list_lemmas", arguments: { slug: PARENT } } }, { method: "tools/call", params: { name: "check_updates", arguments: {} } }]);
const tools = r1.find((m) => m.id === 2)?.result?.tools ?? [];
ok("MCP lists 16 tools incl. lemma tools", tools.length === 16 && ["list_lemmas", "search_lemmas", "propose_lemma", "share_open_lemmas", "check_updates"].every((n) => tools.some((t) => t.name === n)), String(tools.length));
ok("MCP list_lemmas works", JSON.stringify(r1.find((m) => m.id === 3)?.result ?? {}).includes(name));
ok("MCP check_updates: up to date", JSON.stringify(r1.find((m) => m.id === 4)?.result ?? {}).includes('\\"up_to_date\\": true'));
ok("MCP instructions mention lemmas", (r1.find((m) => m.id === 1)?.result?.instructions ?? "").includes("lemma"));
// An older copy of the MCP server must warn.
const old = path.join(os.tmpdir(), `nosorry-mcp-old-${tag}.mjs`);
fs.writeFileSync(old, fs.readFileSync(MCP, "utf8").replace(/^const VERSION = "[^"]*";/m, 'const VERSION = "0.3.0";'));
const r2 = await mcp(old, [{ method: "tools/call", params: { name: "list_lemmas", arguments: { slug: PARENT } } }]);
ok("an outdated MCP server announces it in its instructions", (r2.find((m) => m.id === 1)?.result?.instructions ?? "").includes("out of date"));
ok("…and in its first tool result, with the update command", /out of date[\s\S]*install/.test(r2.find((m) => m.id === 2)?.result?.content?.[0]?.text ?? ""));
fs.rmSync(old, { force: true });

section("CLI");
const cli = (a, env = {}) => spawnSync(process.execPath, [path.resolve("skill/nosorry/bin/nosorry.mjs"), ...a], { encoding: "utf8", env: { ...process.env, NOSORRY_URL: BASE, NOSORRY_API_KEY: A.key, HOME: os.tmpdir(), USERPROFILE: os.tmpdir(), ...env } });
const c1 = cli(["lemmas", PARENT]);
ok("nosorry lemmas <slug>", c1.status === 0 && c1.stdout.includes(name), c1.stderr.slice(0, 200));
const c2 = cli(["version"]);
ok("nosorry version: up to date", c2.status === 0 && c2.stdout.includes("up to date"), c2.stdout + c2.stderr);

section("Pages");
for (const p of ["/lemmas", `/lemmas?q=${name}`, `/p/${slug}`, `/p/${PARENT}?tab=lemmas`, "/research?f=lemmas", "/leaderboard", "/", `/u/${A.handle}`]) {
  const r = await fetch(BASE + p); const t = await r.text();
  ok(`${r.status} ${p}`, r.status === 200 && !/Application error|digest:/i.test(t));
}
const lemmaPage = await (await fetch(`${BASE}/p/${slug}`)).text();
ok("proved lemma page shows the reuse snippet", lemmaPage.includes("Reuse this lemma") && lemmaPage.includes(name));

await db.end();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
