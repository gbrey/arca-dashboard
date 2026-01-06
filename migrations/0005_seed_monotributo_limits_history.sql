-- Seed de límites históricos del monotributo
-- Fuente: https://www.afip.gob.ar/monotributo/montos-y-categorias-anteriores.asp

-- Enero a Julio 2024 (vigente desde 01/01/2024)
INSERT OR REPLACE INTO monotributo_limits_history (id, period, valid_from, limits_json, source, notes, created_at)
VALUES (
  'limits-2024-01',
  '2024-01',
  1704067200, -- 2024-01-01 00:00:00 UTC
  '{"A":6450000,"B":9450000,"C":13250000,"D":16450000,"E":19350000,"F":24250000,"G":29000000,"H":44000000,"I":49250000,"J":56400000,"K":68000000}',
  'AFIP',
  'Categorías vigentes Enero-Julio 2024',
  strftime('%s', 'now')
);

-- Agosto 2024 a Enero 2025 (vigente desde 01/08/2024)
INSERT OR REPLACE INTO monotributo_limits_history (id, period, valid_from, limits_json, source, notes, created_at)
VALUES (
  'limits-2024-07',
  '2024-07',
  1722470400, -- 2024-08-01 00:00:00 UTC
  '{"A":6450000,"B":9450000,"C":13250000,"D":16450000,"E":19350000,"F":24250000,"G":29000000,"H":44000000,"I":49250000,"J":56400000,"K":68000000}',
  'AFIP',
  'Categorías vigentes Agosto 2024 - Enero 2025',
  strftime('%s', 'now')
);

-- Febrero a Julio 2025 (vigente desde 01/02/2025)
INSERT OR REPLACE INTO monotributo_limits_history (id, period, valid_from, limits_json, source, notes, created_at)
VALUES (
  'limits-2025-01',
  '2025-01',
  1738368000, -- 2025-02-01 00:00:00 UTC
  '{"A":7813063.45,"B":11447046.44,"C":16050091.57,"D":19926340.10,"E":23439190.34,"F":29374695.90,"G":35128502.31,"H":53298417.30,"I":59657887.55,"J":68318880.36,"K":82370281.28}',
  'AFIP',
  'Categorías vigentes Febrero-Julio 2025',
  strftime('%s', 'now')
);

-- Agosto 2025 a Enero 2026 (vigente desde 01/08/2025) - Valores actuales
INSERT OR REPLACE INTO monotributo_limits_history (id, period, valid_from, limits_json, source, notes, created_at)
VALUES (
  'limits-2025-07',
  '2025-07',
  1754006400, -- 2025-08-01 00:00:00 UTC
  '{"A":8992597.87,"B":13175201.52,"C":18473166.15,"D":22934610.05,"E":26977793.60,"F":33809379.57,"G":40431835.35,"H":61344853.64,"I":68664410.05,"J":78632948.76,"K":94805682.90}',
  'AFIP',
  'Categorías vigentes Agosto 2025 - Enero 2026 (actuales)',
  strftime('%s', 'now')
);

