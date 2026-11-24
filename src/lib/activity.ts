import { q } from "./db";

/** One person's public research activity (profile page). */
export async function userActivity(userId: number) {
  const [leads, notes, critiques] = await Promise.all([
    q<{ id: number; slug: string; title: string; approach: string; agent: string | null; status: string; outcome: string | null; last_beat: string }>(`
      SELECT l.id, p.slug, p.title, l.approach, l.agent, l.status, l.outcome, l.last_beat
      FROM leads l JOIN problems p ON p.id=l.problem_id WHERE l.user_id=$1 ORDER BY (l.status='active') DESC, l.last_beat DESC LIMIT 50`, [userId]),
    q<{ id: number; kind: string; slug: string; title: string; body_md: string; obstruction_md: string | null; plus: number; created_at: string }>(`
      SELECT n.id, n.kind, p.slug, p.title, n.body_md, n.obstruction_md, cardinality(n.plus_ones)::int AS plus, n.created_at
      FROM notes n JOIN problems p ON p.id=n.problem_id WHERE n.user_id=$1 AND n.status <> 'hidden' AND n.kind <> 'reply'
      ORDER BY n.created_at DESC LIMIT 50`, [userId]),
    q<{ id: number; kind: string; status: string; slug: string; title: string; body_md: string; resolution_md: string | null; created_at: string }>(`
      SELECT c.id, c.kind, c.status, p.slug, p.title, c.body_md, c.resolution_md, c.created_at
      FROM critiques c JOIN problems p ON p.id=c.problem_id WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT 50`, [userId]),
  ]);
  return { leads, notes, critiques };
}
