-- M1C-A: Vessel Workflow Engine — persistent multi-step workflow state.
-- DB target: memory.db (NOT harness.db — see B-级 review M-1)
-- TARGET_VERSION: 3

CREATE TABLE IF NOT EXISTS workflow_state (
  id              TEXT    PRIMARY KEY,
  kind            TEXT    NOT NULL DEFAULT 'multi_step',
  -- pending | running | paused | interrupted | completed | failed | cancelled
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','paused','interrupted','completed','failed','cancelled')),
  current_step    INTEGER NOT NULL DEFAULT 0,
  total_steps     INTEGER NOT NULL DEFAULT 0,
  steps_json      TEXT    NOT NULL,   -- JSON array of WorkflowStep
  context_json    TEXT,               -- JSON object with accumulated step results
  paused_reason   TEXT,               -- HITL message to show user
  paused_options  TEXT,               -- JSON array of string options (null = approve/reject)
  chosen_option   TEXT,               -- user's choice at HITL (set before resume)
  error_message   TEXT,               -- for failed status
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_state_status ON workflow_state(status);
CREATE INDEX IF NOT EXISTS idx_workflow_state_created ON workflow_state(created_at DESC);
