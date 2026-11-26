-- Record challenges ("record races") posed on nosorry itself: what /challenges shows beyond the metric columns of 012:
-- the family they belong to, the best construction known in the literature (value, who, where), known bounds, and how
-- to display the score (e.g. ω challenges store τ·10⁶ as an integer).
ALTER TABLE problems ADD COLUMN challenge_info jsonb;
-- {
--   "family": "Matrix multiplication",       grouping on /challenges
--   "summary": "one sentence",               card text
--   "known": { "value": 23, "by": "Laderman (1976)", "url": "https://…" },   best known before nosorry
--   "bound": "lower bound 19 (Bläser 2003)", optional
--   "scale": 1e-6, "unit": "",               displayed value = stored value × scale
--   "order": 10                              order inside its family
-- }

INSERT INTO collections(slug, name, description, source_url)
VALUES ('records', 'Record races', 'Challenges posed on nosorry: beat the best known construction, with a proof checked by Lean.', NULL)
ON CONFLICT (slug) DO NOTHING;
