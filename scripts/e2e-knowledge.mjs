// End-to-end test of the knowledge base (book of methods, error → fix hints) against a running LOCAL site, with
// TEMPORARY accounts (an author, a prover, a moderator) deleted at the end with everything they created:
//   public reads and search, contributions (client header, model, validation, near-duplicates), moderation (promote,
//   hide, unhide; non-moderators refused), hints (pattern and fuzzy match, contribution rules), book entries in the
//   desk's gap, book citations stored on a submission, and the citation credit rules (referee track, no self-citation,
//   only the proof that settles a problem, only entries older than the proof).
//   node scripts/e2e-knowledge.mjs
import crypto from "node:crypto";
import pg from "pg";
import { CLIENT_VERSION } from "../shared/version.mjs";
import { creditBookCites } from "../shared/knowledge.mjs";
import { POINTS } from "../shared/scoring.mjs";

const BASE = process.env.NOSORRY_URL ?? "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://nosorry:nosorry_dev@127.0.0.1:5433/nosorry" });
await db.connect();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

async function account(tag, role = "user") {
  const handle = `kb-e2e-${tag}-${crypto.randomBytes(3).toString("hex")}`;
  const prefix = crypto.randomBytes(4).toString("hex");
  const key = `ns_${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
  const { rows: [u] } = await db.query(`INSERT INTO users(handle, password_hash, email, email_verified_at, created_at, role) VALUES ($1,'!',$2, now(), now() - interval '2 days', $3) RETURNING id`,
    [handle, `${handle}@nosorry.invalid`, role]);
  await db.query(`INSERT INTO api_keys(user_id, name, prefix, key_hash, scopes) VALUES ($1,'e2e',$2,$3,'{read,submit}')`, [u.id, prefix, crypto.createHash("sha256").update(key).digest("hex")]);
  return { id: Number(u.id), handle, key };
}
const A = await account("author"), B = await account("prover"), MOD = await account("mod", "moderator");
const users = [A.id, B.id, MOD.id];
const api = async (who, method, p, body, extra = {}) => {
  const r = await fetch(BASE + p, { method, headers: { ...(who ? { authorization: `Bearer ${who.key}` } : {}), "content-type": "application/json", "x-nosorry-client": `cli/${CLIENT_VERSION}`, ...extra }, body: body ? JSON.stringify(body) : undefined });
  let j; try { j = await r.json(); } catch { j = null; }
  return { status: r.status, j };
};
const tag = crypto.randomBytes(3).toString("hex");
const entry = {
  title: `Unfold a recursive definition with its equation lemmas ${tag}`,
  problem: "A goal mentions a function defined by recursion and simp does not unfold it.",
  method: "Use the equation lemmas Lean generates (`f.eq_1`, `f.eq_def`) with `rw` or `simp only`, instead of `unfold`, which can loop on well-founded definitions.",
  lean: "example : f 0 = 1 := by rw [f.eq_1]", tags: ["tactics"], keywords: ["unfold", "eq_def", "recursion"], model: "e2e-model",
};

try {
  // ── reads
  let r = await api(null, "GET", "/api/v1/book?limit=5");
  check("the book is public and seeded", r.status === 200 && r.j.counts.total >= 40, `${r.status} total=${r.j?.counts?.total}`);
  r = await api(null, "GET", "/api/v1/book?q=native_decide");
  check("search by word finds entries", r.j?.entries?.length > 0, r.j?.entries?.map((e) => e.slug).slice(0, 3).join(", "));
  r = await api(null, "GET", "/api/v1/book?tag=performance");
  check("tag filter", r.j?.entries?.length > 0 && r.j.entries.every((e) => e.tags.includes("performance")), `${r.j?.entries?.length}`);
  r = await api(null, "GET", "/api/v1/book?q=heartbeets%20timout");
  check("misspelt query falls back to fuzzy search", r.j?.entries?.length > 0, `fuzzy=${r.j?.fuzzy} ${r.j?.entries?.[0]?.slug}`);
  r = await api(null, "GET", "/api/v1/book/start-here-proving-on-nosorry");
  check("one entry by slug, with provenance", r.status === 200 && !!r.j?.source?.name && r.j?.cite?.type === "book", `${r.status}`);
  const page = await fetch(`${BASE}/book`).then((x) => x.text());
  check("the /book page renders", page.includes("Book of methods"));
  const errs = await fetch(`${BASE}/book/errors`).then((x) => x.status);
  check("the /book/errors page renders", errs === 200, `${errs}`);

  // ── contributions
  r = await api(A, "POST", "/api/v1/book", entry, { "x-nosorry-client": "" });
  check("a contribution without the client header is refused (426)", r.status === 426, `${r.status}`);
  r = await api(A, "POST", "/api/v1/book", { ...entry, model: undefined });
  check("a contribution needs the model", r.status === 400 && /model/.test(r.j?.error ?? ""), `${r.status}`);
  r = await api(A, "POST", "/api/v1/book", { ...entry, tags: ["misc"] });
  check("tags must be among the five", r.status === 400 && /tags/.test(r.j?.error ?? ""), `${r.status}`);
  r = await api(A, "POST", "/api/v1/book", { ...entry, method: "too short" });
  check("a method needs substance", r.status === 400, `${r.status}`);
  r = await api(A, "POST", "/api/v1/book", entry);
  check("an entry is added as community", r.status === 201 && r.j?.status === "community", `${r.status} ${r.j?.slug ?? r.j?.error}`);
  const slug = r.j?.slug;
  r = await api(B, "POST", "/api/v1/book", { ...entry, title: entry.title + "s" });
  check("a near-duplicate title is refused (409) with the similar entry", r.status === 409 && Array.isArray(r.j?.details), `${r.status}`);

  // ── moderation
  r = await api(B, "POST", `/api/v1/book/${slug}`, { action: "promote" });
  check("a member cannot moderate", r.status === 403, `${r.status}`);
  r = await api(MOD, "POST", `/api/v1/book/${slug}`, { action: "promote" });
  r = await api(null, "GET", `/api/v1/book/${slug}`);
  check("a moderator promotes an entry to verified", r.j?.status === "verified", r.j?.status);
  r = await api(MOD, "POST", `/api/v1/book/${slug}`, { action: "hide" });
  check("hiding needs a reason", r.status === 400, `${r.status}`);
  await api(MOD, "POST", `/api/v1/book/${slug}`, { action: "hide", reason: "e2e test" });
  r = await api(null, "GET", `/api/v1/book/${slug}`);
  const listed = await api(null, "GET", `/api/v1/book?q=${tag}`);
  check("a hidden entry is gone for the public", r.status === 404 && !listed.j.entries.some((e) => e.slug === slug), `${r.status}`);
  r = await api(MOD, "GET", `/api/v1/book/${slug}`);
  check("moderators still see a hidden entry", r.status === 200 && !!r.j?.hidden, `${r.status}`);
  await api(MOD, "POST", `/api/v1/book/${slug}`, { action: "unhide" });
  r = await api(null, "GET", `/api/v1/book/${slug}`);
  check("unhide brings it back", r.status === 200, `${r.status}`);

  // ── hints
  r = await api(null, "GET", `/api/v1/hints?error=${encodeURIComponent("error: maximum recursion depth has been reached\nuse `set_option maxRecDepth <num>` to increase limit")}`);
  check("hints: a pattern matches a recursion-depth error", r.j?.hints?.[0]?.matched_pattern === true, r.j?.hints?.[0]?.slug);
  r = await api(null, "POST", "/api/v1/hints/match", { error: "Solution.lean:12:4: error: linarith failed to find a contradiction\ncase a\nx y : ℝ\n⊢ False" });
  check("hints: POST match for long errors", r.j?.hints?.length > 0, r.j?.hints?.map((h) => h.slug).join(", "));
  r = await api(null, "GET", `/api/v1/hints?error=${encodeURIComponent("zzqx unrelated words only")}`);
  check("hints: nothing for an unrelated text", r.j?.hints?.length === 0, `${r.j?.hints?.length}`);
  r = await api(A, "POST", "/api/v1/hints", { pattern: "error.*", title: "Anything", explanation: "matches all errors whatever they say", fixes: ["do something about it"] });
  check("hints: a too-broad pattern is refused", r.status === 400, `${r.status} ${r.j?.error}`);
  r = await api(A, "POST", "/api/v1/hints", { pattern: `e2e-hint-${tag} failed`, title: `E2E hint ${tag}`, explanation: "an error used by the end-to-end test only", fixes: ["fix it the e2e way, then retry"], example: `error: e2e-hint-${tag} failed`, tags: ["tactic"] });
  check("hints: a contribution is accepted", r.status === 201, `${r.status} ${r.j?.error ?? ""}`);

  // ── desk gap and citations on a submission
  const { rows: [p] } = await db.query(`SELECT p.id, p.slug, v.challenge_source FROM problems p JOIN problem_versions v ON v.id=p.current_version_id
    WHERE p.status='open' AND p.resolution IS NULL AND p.formalization='formal' AND p.verification='lean-kernel' AND p.slug NOT LIKE '%--%'
      AND NOT EXISTS (SELECT 1 FROM desk_leases d WHERE d.problem_id=p.id AND d.state='active') ORDER BY p.id LIMIT 1`);
  r = await api(B, "GET", `/api/v1/desk/next?model=e2e-model&agent=e2e&problem=${p.slug}`);
  check("the desk's gap lists book entries", Array.isArray(r.j?.gap?.book) && r.j.gap.book.length >= 1, r.j?.gap?.book?.map((e) => e.slug).join(", ") ?? r.j?.error);
  const lease = r.j?.lease?.id;
  r = await api(B, "POST", "/api/v1/submissions", { problem: p.slug, kind: "partial", lean_source: p.challenge_source, explanation_md: "e2e knowledge test",
    agent: { name: "e2e", model: "e2e-model" }, cites: [{ type: "book", id: slug }, { type: "book", id: "no-such-entry-e2e" }] });
  const { rows: [stored] } = r.j?.id ? await db.query("SELECT cites FROM submissions WHERE public_id=$1", [r.j.id]) : { rows: [] };
  const entryId = Number((await db.query("SELECT id FROM book_entries WHERE slug=$1", [slug])).rows[0].id);
  check("a submission stores its book citations by id", !!stored?.cites?.some((c) => c.type === "book" && c.id === entryId), JSON.stringify(stored?.cites));
  check("an unknown book entry is reported in warnings", (r.j?.warnings ?? []).some((w) => /unknown book/.test(w)), JSON.stringify(r.j?.warnings));
  if (lease) await api(B, "POST", `/api/v1/desk/release?lease=${lease}&reason=other`, { note: "e2e" });

  // ── credit rules (shared/knowledge.mjs, as the worker calls it), inside a transaction that is rolled back
  await db.query("BEGIN");
  try {
    await db.query("UPDATE book_entries SET created_at = now() - interval '1 day' WHERE id=$1", [entryId]);
    const mk = async (user, kind, ageMin) => (await db.query(
      `INSERT INTO submissions(public_id, user_id, problem_id, problem_version_id, kind, status, cites, created_at)
       SELECT $1,$2,$3,current_version_id,$4,'verified',$5, now() - make_interval(mins => $6) FROM problems WHERE id=$3 RETURNING *`,
      [`s-e2e${crypto.randomBytes(4).toString("hex")}`, user, p.id, kind, JSON.stringify([{ type: "book", id: entryId }]), ageMin])).rows[0];
    const pts = async () => (await db.query("SELECT coalesce(sum(delta),0)::int AS n, array_agg(DISTINCT track) AS t FROM point_events WHERE user_id=$1 AND reason='book:cited'", [A.id])).rows[0];
    const own = await mk(A.id, "proof", 30);
    await creditBookCites(db, { ...own, problem_status: "open" });
    check("citing your own entry earns nothing", (await pts()).n === 0);
    await db.query("UPDATE submissions SET status='rejected' WHERE id=$1", [own.id]);
    const first = await mk(B.id, "proof", 20);
    const c1 = await creditBookCites(db, { ...first, problem_status: "open" });
    const after = await pts();
    check(`the proof that settles a problem credits the author (+${POINTS.book.cited}, referee track)`, after.n === POINTS.book.cited && after.t?.[0] === "referee", `${after.n} ${after.t}`);
    check("the citation is recorded", c1.includes(slug));
    const later = await mk(B.id, "proof", 10);
    await creditBookCites(db, { ...later, problem_status: "open" });
    check("a later proof of a settled problem pays nothing more", (await pts()).n === POINTS.book.cited);
  } finally { await db.query("ROLLBACK"); }
  await db.query("BEGIN");
  try {
    const { rows: [old] } = await db.query(
      `INSERT INTO submissions(public_id, user_id, problem_id, problem_version_id, kind, status, cites, created_at)
       SELECT $1,$2,$3,current_version_id,'proof','verified',$4, now() - interval '10 days' FROM problems WHERE id=$3 RETURNING *`,
      [`s-e2e${crypto.randomBytes(4).toString("hex")}`, B.id, p.id, JSON.stringify([{ type: "book", id: entryId }])]);
    await creditBookCites(db, { ...old, problem_status: "open" });
    const { rows: [x] } = await db.query("SELECT count(*)::int AS n FROM point_events WHERE user_id=$1 AND reason='book:cited'", [A.id]);
    check("an entry written after the proof earns nothing", x.n === 0);
  } finally { await db.query("ROLLBACK"); }
} finally {
  await db.query("BEGIN");
  await db.query("SET LOCAL session_replication_role = replica");
  const { rows: subs } = await db.query("SELECT id FROM submissions WHERE user_id = ANY($1)", [users]);
  const ids = subs.map((x) => x.id);
  await db.query("DELETE FROM jobs WHERE submission_id = ANY($1)", [ids]);
  await db.query("DELETE FROM verification_runs WHERE submission_id = ANY($1)", [ids]);
  await db.query("DELETE FROM problem_events WHERE user_id = ANY($1) OR (ref_type='submission' AND ref_id = ANY($2))", [users, ids]);
  await db.query("DELETE FROM book_cites WHERE submission_id = ANY($1)", [ids]);
  await db.query("DELETE FROM point_events WHERE user_id = ANY($1)", [users]);
  await db.query("DELETE FROM book_entries WHERE author_id = ANY($1)", [users]);
  await db.query("DELETE FROM lean_hints WHERE author_id = ANY($1)", [users]);
  await db.query("DELETE FROM leads WHERE user_id = ANY($1)", [users]);
  await db.query("DELETE FROM desk_leases WHERE user_id = ANY($1)", [users]);
  await db.query("DELETE FROM submissions WHERE user_id = ANY($1)", [users]);
  await db.query("DELETE FROM api_idempotency WHERE user_id = ANY($1)", [users]);
  await db.query("DELETE FROM audit_log WHERE actor_id = ANY($1)", [users]);
  await db.query("DELETE FROM api_keys WHERE user_id = ANY($1)", [users]);
  await db.query("DELETE FROM users WHERE id = ANY($1)", [users]);
  await db.query("COMMIT");
  await db.end();
  console.log(`${pass} passed, ${fail} failed (test accounts removed)`);
  process.exitCode = fail ? 1 : 0;
}
