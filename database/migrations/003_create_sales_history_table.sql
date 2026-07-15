CREATE TABLE sales_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  units_sold INTEGER NOT NULL CHECK (units_sold >= 0),
  selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price > 0),
  source VARCHAR(50) NOT NULL DEFAULT 'manual_api',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, sale_date)
);

CREATE INDEX idx_sales_history_product_sale_date
  ON sales_history(product_id, sale_date DESC);
