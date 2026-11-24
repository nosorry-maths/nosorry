import { one, q } from "@/lib/db";
import { anonLimit, err, json } from "@/lib/api";
import { threadsForProblem } from "@/lib/research";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await anonLimit(req);
  if (limited) return limited;
  const slug = (await params).slug;
  const p = await one<{ id: number }>(`
    SELECT p.id, p.ident, p.slug, p.title, p.status, p.statement_status, p.statement_md, p.subjects, p.tags, p.collection,
           p.source_url, p.solved_on_platform, p.needs_answer, v.version, v.decl_name, v.statement_lean, v.challenge_source,
           v.statement_hash, v.toolchain, v.upstream_commit, v.workspace, p.field, p.formalization, p.verification, p.license, p.attribution,
           p.metric_name, p.metric_direction
    FROM problems p LEFT JOIN problem_versions v ON v.id=p.current_version_id WHERE p.slug=$1 OR p.ident=$1`, [slug]);
  if (!p) return err(404, "unknown problem");
  const [critiques, partials] = await Promise.all([
    q("SELECT kind, status, left(body_md, 1000) AS body FROM critiques WHERE problem_id=$1 ORDER BY id DESC LIMIT 20", [p.id]),
    q("SELECT public_id, open_lemmas FROM submissions WHERE problem_id=$1 AND status='partial' AND visibility='public' ORDER BY id DESC LIMIT 20", [p.id]),
  ]);
  const research = (await threadsForProblem(p.id)).map(({ user_id, ...t }) => { void user_id; return t; });
  return json({
    ...p,
    critiques,
    public_partial_proofs: partials,
    research_threads: research,
    instructions:
      "Read research_threads first: other people's public repositories and what they already tried. " +
      "Write Solution.lean starting from challenge_source. Keep every definition identical, prove decl_name with exactly the same type, " +
      "no sorry in its dependency closure, no new axioms, no native_decide, no metaprogramming. Submit with POST /api/v1/submissions.",
  });
}
