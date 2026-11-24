#!/usr/bin/env node
// End-to-end smoke test against a running instance (default: the Docker stack on :3100).
//   node scripts/smoke.mjs [--url http://localhost:3100] [--quick]
// Creates a throw-away user + API key directly in the database (local development only), then exercises
// pages, the public API, real Lean verification (proof / sorry / axiom / metric), the research board,
// the stream and the MCP server. The key is revoked at the end. Exit code 1 if anything failed.
import pg from "pg";
import { MIN_CLIENT_VERSION } from "../shared/version.mjs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const BASE = (args[args.indexOf("--url") + 1] && args.includes("--url") ? args[args.indexOf("--url") + 1] : "http://localhost:3100").replace(/\/$/, "");
const QUICK = args.includes("--quick");
const DB = process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let failed = 0, passed = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(p, opts = {}) {
  const r = await fetch(BASE + p, { redirect: "manual", ...opts });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), headers: r.headers };
}

// ---------- 1. pages ----------
section("Pages (anonymous)");
const PAGES = ["/", "/list/math", "/list/math?status=open", "/list/math.NT", "/recent", "/research", "/leaderboard", "/leaderboard?by=agent",
  "/queue", "/start", "/docs", "/docs/agents", "/docs/manual", "/docs/collaborate", "/docs/physics", "/docs/verification", "/docs/scoring",
  "/docs/security", "/about", "/search?q=erdos+problem", "/search?q=riemann", "/p/erdos-488", "/p/erdos-488?tab=stream",
  "/p/erdos-488?tab=statement", "/p/demo-sum-100?tab=records", "/p/erdos-488/challenge.lean", "/login", "/signup", "/llms.txt",
  "/icon.svg", "/api/v1/openapi.json", "/u/demo-alice"];
for (const p of PAGES) {
  const r = await get(p);
  ok(`${r.status} ${p}`, r.status === 200 && !/Application error|Internal Server Error|digest:/i.test(r.text), r.status !== 200 ? `status ${r.status}` : "error text in page");
}
for (const p of ["/submit", "/account"]) {
  const r = await get(p);
  ok(`${p} redirects anonymous users to login`, [302, 303, 307].includes(r.status) && /login/.test(r.headers.get("location") ?? ""), `status ${r.status}`);
}
for (const f of ["SKILL.md", "bin/nosorry.mjs", "bin/nosorry-mcp.mjs", "lib/preflight.mjs"]) {
  const r = await get(`/skill/${f}`);
  ok(`skill file /skill/${f}`, r.status === 200 && r.text.length > 500, `status ${r.status}`);
}
for (const f of ["install.sh", "install.ps1"]) {
  const r = await get(`/skill/${f}`);
  ok(`installer ${f} is clean`, r.status === 200 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.text) && r.text.includes("nosorry-mcp.mjs") && !/skills\r?\n/.test(r.text), `status ${r.status}`);
}
{ const r = await get("/mod"); ok("/mod is hidden (404) from non-moderators", r.status === 404, `status ${r.status}`); }
{ const r = await get("/random"); ok("/random redirects to a problem", [302, 303, 307].includes(r.status) && /\/p\//.test(r.headers.get("location") ?? ""), `status ${r.status}`); }
{ const r = await get("/p/does-not-exist-xyz"); ok("unknown problem gives 404", r.status === 404, `status ${r.status}`); }
{ const r = await get("/"); ok("home has charts and how-it-works", /class="how"/.test(r.text) && /chart-svg/.test(r.text)); }
{ const r = await get("/"); ok("security headers (CSP with nonce)", /nonce-/.test(r.headers.get("content-security-policy") ?? "")); }

// ---------- 2. public API ----------
section("Public API");
{ const r = await get("/api/v1/problems?limit=5"); ok("GET /problems", r.status === 200 && Array.isArray(r.json?.items ?? r.json?.problems ?? r.json), `status ${r.status}`); }
{ const r = await get("/api/v1/problems/erdos-488"); ok("GET /problems/erdos-488", r.status === 200 && r.json?.slug === "erdos-488"); }
{ const r = await get("/api/v1/problems/erdos-488/state"); ok("GET /problems/:slug/state", r.status === 200 && r.json && "leads" in r.json); }
{ const r = await get("/api/v1/problems/erdos-488/stream?since=0"); ok("GET /stream (JSON)", r.status === 200 && Array.isArray(r.json?.events)); }
{ const r = await get("/api/v1/me"); ok("GET /me without key is 401", r.status === 401, `status ${r.status}`); }
{
  const ctrl = new AbortController();
  const r = await fetch(`${BASE}/api/v1/problems/erdos-488/stream?since=0`, { headers: { accept: "text/event-stream" }, signal: ctrl.signal });
  ok("stream (SSE) opens", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/event-stream"));
  ctrl.abort();
}

// ---------- 3. account + key ----------
section("Throw-away account");
const db = new pg.Client({ connectionString: DB });
await db.connect();
const handle = `smoke_${Date.now().toString(36)}`;
const prefix = crypto.randomBytes(4).toString("hex");
const KEY = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
const { rows: [u] } = await db.query("INSERT INTO users(handle, password_hash) VALUES ($1, 'scrypt$disabled') RETURNING id", [handle]);
await db.query("INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'smoke test',$2,$3,$4)",
  [u.id, prefix, crypto.createHash("sha256").update(KEY).digest("hex"), ["submit", "read"]]);
const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json", "x-nosorry-client": `cli/${MIN_CLIENT_VERSION}` };
const post = (p, body) => get(p, { method: "POST", headers: auth, body: JSON.stringify(body) });
{ const r = await get("/api/v1/me", { headers: auth }); ok(`GET /me with key (${handle})`, r.status === 200 && r.json?.handle === handle, `status ${r.status}`); }

// ---------- 4. verification ----------
async function submitAndWait(name, body, expect, timeoutS = 240) {
  const r = await post("/api/v1/submissions", { agent: { name: "smoke-test" }, ...body });
  if (r.status === 400 && expect.includes("refused") && r.json?.error === "preflight failed") { ok(`${name} → refused at preflight (${r.json.details?.[0]?.code})`, true); return null; }
  if (r.status !== 202) { ok(name, false, `submit status ${r.status}: ${r.text.slice(0, 200)}`); return null; }
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    await sleep(2500);
    const s = await get(`/api/v1/submissions/${r.json.id}`, { headers: auth });
    if (s.json?.done) { ok(`${name} → ${s.json.status}`, expect.includes(s.json.status), `expected ${expect.join("/")}, review: ${s.json.review_note ?? ""}`); return s.json; }
  }
  ok(name, false, `not done after ${timeoutS}s (queue or worker down?)`);
  return null;
}
const demo = (proof) => `namespace Demo\n\ndef IsEven (n : Nat) : Prop := ∃ k, n = 2 * k\n\ntheorem even_add : ∀ a b, IsEven a → IsEven b → IsEven (a + b) := by\n${proof}\n\nend Demo\n`;
const nonce = () => `-- smoke ${crypto.randomBytes(4).toString("hex")}\n`;
if (!QUICK) {
  section("Lean verification (real worker)");
  await submitAndWait("valid proof is verified",
    { problem: "demo-even-add", kind: "proof", lean_source: nonce() + demo(`  intro a b ⟨x, hx⟩ ⟨y, hy⟩\n  exact ⟨x + y + 0 * ${crypto.randomInt(1e6)}, by omega⟩`) }, ["verified"]);
  await submitAndWait("proof with sorry is rejected",
    { problem: "demo-even-add", kind: "proof", lean_source: nonce() + demo("  sorry") }, ["rejected", "partial"]);
  await submitAndWait("proof using a new axiom is rejected",
    { problem: "demo-even-add", kind: "proof", lean_source: nonce() + "axiom cheat : False\n" + demo("  exact cheat.elim") }, ["rejected", "refused"]);
  await submitAndWait("changed statement is rejected",
    { problem: "demo-even-add", kind: "proof", lean_source: nonce() + demo("  intro a b _ _\n  exact ⟨0, by omega⟩").replace("IsEven (a + b)", "True ∨ IsEven (a + b)").replace("exact ⟨0, by omega⟩", "exact Or.inl trivial") }, ["rejected"]);
  const a = 2 + crypto.randomInt(96);  // a fresh solution each run (identical ones are refused as duplicates)
  const m = await submitAndWait("metric solution is verified and its value extracted",
    { problem: "demo-sum-100", kind: "proof", lean_source: nonce() + `namespace Sum100\n\ndef answerList : List Nat := [${a}, ${100 - a}]\n\ntheorem correct : answerList.sum = 100 ∧ ∀ x ∈ answerList, 0 < x := by decide\n\ntheorem metric_bound : answerList.length ≤ 2 := by decide\n\nend Sum100\n` }, ["verified"]);
  if (m) { const v = await db.query("SELECT metric_value FROM submissions WHERE public_id=$1", [m.id]); ok("metric value = 2", Number(v.rows[0]?.metric_value) === 2, `got ${v.rows[0]?.metric_value}`); }
}

// ---------- 5. research board ----------
section("Research board");
const approach = `Smoke test approach ${crypto.randomBytes(3).toString("hex")}: induction on the sum of both witnesses`;
const L = await post("/api/v1/problems/demo-even-add/leads", { approach, eta_hours: 1, force: true });
ok("start a lead", (L.status === 201 || L.status === 200) && L.json?.lead_id, `status ${L.status}: ${L.text.slice(0, 160)}`);
const leadId = L.json?.lead_id;
if (leadId) {
  const up = await post(`/api/v1/leads/${leadId}`, { action: "update", extend_hours: 1 });
  ok("heartbeat a lead", up.status === 200, `status ${up.status}`);
  for (const p of ["/p/demo-even-add?tab=board", "/", "/research"]) {
    const r = await get(p);
    ok(`${p} renders with an active lead`, r.status === 200 && !/Application error|digest:/i.test(r.text) && (p !== "/p/demo-even-add?tab=board" || r.text.includes("Smoke test approach")), `status ${r.status}`);
  }
  const jn = await post(`/api/v1/leads/${leadId}`, { action: "join" });
  ok("joining your own lead is refused", jn.status === 400, `status ${jn.status}`);
  const bad = await post(`/api/v1/leads/${leadId}`, { action: "close", outcome: "dead-end", note_md: "too short" });
  ok("dead end without obstruction is refused", bad.status === 400, `status ${bad.status}`);
  const cl = await post(`/api/v1/leads/${leadId}`, { action: "close", outcome: "dead-end", note_md: "Smoke test: closing this lead as a dead end.", obstruction_md: "Smoke test obstruction: the induction hypothesis is too weak for odd witnesses." });
  ok("close a lead as a dead end", cl.status === 200, `status ${cl.status}: ${cl.text.slice(0, 160)}`);
}
const N = await post("/api/v1/problems/demo-even-add/notes", { kind: "idea", body_md: `Smoke test idea ${crypto.randomBytes(3).toString("hex")}: write both numbers as twice something and add.`, force: true });
ok("post an idea", (N.status === 201 || N.status === 200) && (N.json?.note_id || N.json?.merged_into), `status ${N.status}: ${N.text.slice(0, 160)}`);
{ const s = await get("/api/v1/problems/demo-even-add/state", { headers: auth }); ok("dead end visible in board state", JSON.stringify(s.json ?? {}).includes("too weak for odd witnesses")); }
{ const s = await get("/api/v1/problems/demo-even-add/stream?since=0"); ok("events appear in the stream", (s.json?.events ?? []).some((e) => e.handle === handle)); }

// ---------- 6. MCP ----------
section("MCP server (stdio)");
await new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, "skill", "nosorry", "bin", "nosorry-mcp.mjs")], { env: { ...process.env, NOSORRY_URL: BASE, NOSORRY_API_KEY: KEY } });
  let out = "";
  p.stdout.on("data", (d) => { out += d; });
  const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "problem_state", arguments: { slug: "demo-even-add" } } });
  setTimeout(() => {
    p.kill();
    const msgs = out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    ok("MCP initialize", msgs.some((m) => m.id === 1 && m.result));
    ok("MCP lists 11 tools", (msgs.find((m) => m.id === 2)?.result?.tools ?? []).length === 11);
    const st = msgs.find((m) => m.id === 3)?.result;
    ok("MCP problem_state returns the board", !!st && !st.isError && JSON.stringify(st).includes("lead"));
    resolve();
  }, 6000);
});

// ---------- cleanup ----------
await db.query("UPDATE api_keys SET revoked_at=now() WHERE prefix=$1", [prefix]);
{ const r = await get("/api/v1/me", { headers: auth }); ok("revoked key is refused", r.status === 401, `status ${r.status}`); }
await db.end();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
