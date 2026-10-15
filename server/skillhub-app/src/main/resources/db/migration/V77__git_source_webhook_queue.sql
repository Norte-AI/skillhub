ALTER TABLE git_source ADD COLUMN sync_requested BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX idx_git_source_queued ON git_source(created_at) WHERE enabled AND sync_requested;
