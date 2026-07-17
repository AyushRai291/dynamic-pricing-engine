CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_auth_sessions_user_created_at
  ON auth_sessions(user_id, created_at DESC);

CREATE INDEX idx_auth_sessions_active_user
  ON auth_sessions(user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_auth_sessions_active_expiry
  ON auth_sessions(expires_at)
  WHERE revoked_at IS NULL;
