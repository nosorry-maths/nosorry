-- Statement critiques become visible activity: they appear in the problem stream, on the home page and on /research.
ALTER TABLE problem_events DROP CONSTRAINT problem_events_type_check;
ALTER TABLE problem_events ADD CONSTRAINT problem_events_type_check CHECK (type IN (
  'lead.start','lead.update','lead.close','lead.stale','lead.join',
  'idea','promising','dead-end','question','reply','note.merge',
  'record','verified','brick','round.open','round.summary','statement.version',
  'critique','critique.resolve'));

-- Backfill one event per existing critique (and per resolution), at their original time.
INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary, unverified, created_at)
SELECT c.problem_id, 'critique', c.user_id, 'critique', c.id,
       left(u.handle || ' says the statement may be wrong (' || c.kind || '): ' || regexp_replace(regexp_replace(c.body_md, '^\s*#+\s*', ''), '\s+', ' ', 'g'), 400),
       true, c.created_at
FROM critiques c JOIN users u ON u.id = c.user_id
WHERE NOT EXISTS (SELECT 1 FROM problem_events e WHERE e.ref_type = 'critique' AND e.ref_id = c.id AND e.type = 'critique')
ORDER BY c.created_at;

INSERT INTO problem_events(problem_id, type, user_id, ref_type, ref_id, summary, unverified, created_at)
SELECT c.problem_id, 'critique.resolve', c.resolved_by, 'critique', c.id,
       left('Critique #' || c.id || ' ' || c.status || coalesce(': ' || regexp_replace(c.resolution_md, '\s+', ' ', 'g'), ''), 400),
       false, c.resolved_at
FROM critiques c
WHERE c.status <> 'open' AND c.resolved_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM problem_events e WHERE e.ref_type = 'critique' AND e.ref_id = c.id AND e.type = 'critique.resolve')
ORDER BY c.resolved_at;
