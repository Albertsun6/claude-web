-- Intent v2: add execution_depth / domain / confidence / classifier_method columns
--
-- TARGET_VERSION = 5  (memory.db 独立版本序列)
-- Additive ALTER TABLE — backwards compatible, existing rows get NULL values.
-- orchestrator.ts writeIntent() will populate these fields for new intents.

ALTER TABLE intents ADD COLUMN execution_depth TEXT CHECK (execution_depth IN ('pipeline','operations','direct'));
ALTER TABLE intents ADD COLUMN domain           TEXT;
ALTER TABLE intents ADD COLUMN confidence       REAL;
ALTER TABLE intents ADD COLUMN classifier_method TEXT CHECK (classifier_method IN ('rules','llm'));

CREATE INDEX IF NOT EXISTS idx_intents_depth  ON intents(execution_depth);
CREATE INDEX IF NOT EXISTS idx_intents_domain ON intents(domain);
