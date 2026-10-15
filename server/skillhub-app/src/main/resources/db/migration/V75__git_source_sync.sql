CREATE TABLE git_source (
 id UUID PRIMARY KEY,
 owner_id VARCHAR(128) NOT NULL REFERENCES user_account(id),
 repository VARCHAR(2048) NOT NULL,
 requested_ref VARCHAR(256) NOT NULL,
 subdir VARCHAR(1024) NOT NULL,
 credential_id VARCHAR(128),
 namespace VARCHAR(128) NOT NULL,
 visibility VARCHAR(32) NOT NULL,
 auto_sync BOOLEAN NOT NULL DEFAULT FALSE,
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 last_commit VARCHAR(64),
 last_version VARCHAR(128),
 last_status VARCHAR(32) NOT NULL DEFAULT 'READY',
 last_error VARCHAR(512),
 last_checked_at TIMESTAMPTZ,
 lease_until TIMESTAMPTZ,
 hook_nonce UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_git_source_owner ON git_source(owner_id);
CREATE INDEX idx_git_source_scheduled ON git_source(last_checked_at) WHERE enabled AND auto_sync;
