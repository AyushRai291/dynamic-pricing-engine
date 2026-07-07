CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  sku VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(100),
  current_price DECIMAL(10,2) NOT NULL CHECK (current_price >= 0),
  cost_price DECIMAL(10,2) NOT NULL CHECK (cost_price >= 0),
  min_price DECIMAL(10,2) NOT NULL CHECK (min_price >= 0),
  max_price DECIMAL(10,2) NOT NULL CHECK (max_price >= 0),
  inventory_count INTEGER NOT NULL DEFAULT 0 CHECK (inventory_count >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_price <= max_price),
  CHECK (cost_price <= current_price),
  CHECK (min_price <= current_price),
  CHECK (current_price <= max_price)
);

CREATE TABLE competitor_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  competitor_name VARCHAR(100) NOT NULL,
  competitor_url TEXT,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  raw_html_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE price_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  current_price DECIMAL(10,2) NOT NULL CHECK (current_price >= 0),
  suggested_price DECIMAL(10,2) NOT NULL CHECK (suggested_price >= 0),
  confidence_score DECIMAL(4,2) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)),
  price_score DECIMAL(5,2) CHECK (price_score IS NULL OR (price_score >= 0 AND price_score <= 100)),
  claude_rationale TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  feature_vector JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN price_suggestions.approved_by IS 'Nullable future users.id reference; no users table yet.';

CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  old_price DECIMAL(10,2) NOT NULL CHECK (old_price >= 0),
  new_price DECIMAL(10,2) NOT NULL CHECK (new_price >= 0),
  change_reason VARCHAR(50) NOT NULL,
  suggestion_id UUID REFERENCES price_suggestions(id) ON DELETE SET NULL,
  changed_by UUID,
  revenue_delta_7d DECIMAL(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN price_history.changed_by IS 'Nullable future users.id reference; no users table yet.';

CREATE INDEX idx_competitor_data_product_scraped_at
  ON competitor_data(product_id, scraped_at DESC);

CREATE INDEX idx_price_suggestions_product_status
  ON price_suggestions(product_id, status);

CREATE INDEX idx_price_suggestions_pending
  ON price_suggestions(product_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX idx_price_history_product_created_at
  ON price_history(product_id, created_at DESC);
