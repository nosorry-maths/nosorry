-- Physics and other fields (docs/veille-physique-lean.md).

-- A problem may exist before it has a formal statement (e.g. Physlib informal lemmas): it then waits for a formalization.
ALTER TABLE problems ADD COLUMN formalization text NOT NULL DEFAULT 'formal' CHECK (formalization IN ('formal','informal'));

-- How a solution can be checked. Only 'lean-kernel' is automated today; the others are declared so problems can be
-- catalogued honestly, and submissions to them are refused until their checker exists.
--   lean-kernel        a Lean proof checked by the kernel (the pipeline)
--   certificate        an external solver result (SMT, dReal, SOS…) accepted only with a certificate replayed in Lean
--   cas                symbolic answer checked by a computer-algebra system (not a formal proof)
--   numeric-tolerance  numeric answer within a tolerance (not a formal proof)
ALTER TABLE problems ADD COLUMN verification text NOT NULL DEFAULT 'lean-kernel'
  CHECK (verification IN ('lean-kernel','certificate','cas','numeric-tolerance'));

-- Licence and attribution of imported content, shown on the problem page.
ALTER TABLE problems ADD COLUMN license text;
ALTER TABLE problems ADD COLUMN attribution text;

-- Which prebuilt Lean workspace verifies a statement (each pins its own toolchain and libraries):
-- formal-conjectures (Mathlib), physlib (Physlib + Mathlib), core (Lean only).
ALTER TABLE problem_versions ADD COLUMN workspace text NOT NULL DEFAULT 'formal-conjectures'
  CHECK (workspace ~ '^[a-z0-9-]{2,40}$');
UPDATE problem_versions SET workspace='core' WHERE problem_id IN (SELECT id FROM problems WHERE 'demo' = ANY(tags));

-- Reviewer note required when a physics statement is marked reviewed (units, idealisations, model).
ALTER TABLE problem_versions ADD COLUMN review_note text;

CREATE INDEX ON problems(field, status);
