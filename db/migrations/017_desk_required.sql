-- Work through the API / MCP on a problem happens under a desk lease: submissions and leads record the lease they were
-- made under (a lead ends with its lease; a verified proof under a lease releases it). Writes may carry an
-- Idempotency-Key: a retried request replays the first answer instead of acting twice.
ALTER TABLE submissions ADD COLUMN desk_lease_id bigint REFERENCES desk_leases(id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN desk_lease_id bigint REFERENCES desk_leases(id) ON DELETE SET NULL;
CREATE INDEX leads_desk_lease ON leads(desk_lease_id) WHERE status <> 'closed';
CREATE INDEX desk_leases_user_active ON desk_leases(user_id) WHERE state = 'active';

CREATE TABLE api_idempotency (
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
  route        text NOT NULL,
  request_hash text NOT NULL,
  status       int,                        -- NULL while the first request is running
  body         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX api_idempotency_age ON api_idempotency(created_at);
