CREATE TABLE competitor_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL CHECK (btrim(competitor_name) <> ''),
  competitor_url TEXT NOT NULL CHECK (btrim(competitor_url) <> ''),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT competitor_targets_product_competitor_key
    UNIQUE (product_id, competitor_name)
);

CREATE INDEX idx_competitor_targets_active_product
  ON competitor_targets(product_id, id)
  WHERE is_active = TRUE;
