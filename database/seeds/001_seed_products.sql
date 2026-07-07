INSERT INTO products (
  sku,
  name,
  category,
  current_price,
  cost_price,
  min_price,
  max_price,
  inventory_count,
  metadata
)
VALUES
  (
    'MOB-SAMSUNG-A55-128',
    'Samsung Galaxy A55 5G 128GB',
    'Mobiles',
    38999.00,
    32500.00,
    34999.00,
    42999.00,
    36,
    '{"brand": "Samsung", "storage": "128GB", "color": "Awesome Navy"}'::jsonb
  ),
  (
    'MOB-ONEPLUS-NORD4-256',
    'OnePlus Nord 4 256GB',
    'Mobiles',
    32999.00,
    27500.00,
    29999.00,
    36999.00,
    48,
    '{"brand": "OnePlus", "storage": "256GB", "color": "Mercurial Silver"}'::jsonb
  ),
  (
    'LAP-LENOVO-SLIM5-I5',
    'Lenovo IdeaPad Slim 5 Intel i5',
    'Laptops',
    62999.00,
    53500.00,
    57999.00,
    72999.00,
    18,
    '{"brand": "Lenovo", "ram": "16GB", "storage": "512GB SSD"}'::jsonb
  ),
  (
    'TV-MI-XPRO-43',
    'Xiaomi X Pro 43 inch 4K Smart TV',
    'Televisions',
    31999.00,
    26200.00,
    28999.00,
    37999.00,
    22,
    '{"brand": "Xiaomi", "screen_size": "43 inch", "resolution": "4K"}'::jsonb
  ),
  (
    'APP-LG-WM-FHV1208',
    'LG 8kg Front Load Washing Machine',
    'Appliances',
    36990.00,
    30600.00,
    32990.00,
    42990.00,
    14,
    '{"brand": "LG", "capacity": "8kg", "type": "front load"}'::jsonb
  ),
  (
    'AUD-BOAT-AIRDOPES-141',
    'boAt Airdopes 141 Bluetooth Earbuds',
    'Audio',
    1299.00,
    780.00,
    999.00,
    1999.00,
    150,
    '{"brand": "boAt", "battery_life": "42 hours", "color": "Bold Black"}'::jsonb
  ),
  (
    'FAS-NIKE-RUNSWIFT-3',
    'Nike Run Swift 3 Running Shoes',
    'Fashion',
    4295.00,
    2850.00,
    3495.00,
    5495.00,
    64,
    '{"brand": "Nike", "gender": "men", "primary_color": "black"}'::jsonb
  ),
  (
    'HOME-PRESTIGE-AIRFRYER-4L',
    'Prestige 4L Digital Air Fryer',
    'Home & Kitchen',
    3999.00,
    2650.00,
    3299.00,
    5999.00,
    41,
    '{"brand": "Prestige", "capacity": "4L", "controls": "digital"}'::jsonb
  )
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  current_price = EXCLUDED.current_price,
  cost_price = EXCLUDED.cost_price,
  min_price = EXCLUDED.min_price,
  max_price = EXCLUDED.max_price,
  inventory_count = EXCLUDED.inventory_count,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
