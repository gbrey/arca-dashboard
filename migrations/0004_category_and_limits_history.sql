-- Historial de categorías por cuenta y período de recategorización
CREATE TABLE IF NOT EXISTS category_history (
  id TEXT PRIMARY KEY,
  arca_account_id TEXT NOT NULL,
  period TEXT NOT NULL,              -- Formato: "2026-01" (Enero 2026) o "2025-07" (Julio 2025)
  category TEXT NOT NULL,            -- A, B, C, D, E, F, G, H, I, J, K
  total_billed INTEGER,              -- Total facturado en ese período (opcional, para registro)
  notes TEXT,                        -- Notas opcionales
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (arca_account_id) REFERENCES arca_accounts(id) ON DELETE CASCADE,
  UNIQUE(arca_account_id, period)
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_category_history_account ON category_history(arca_account_id);
CREATE INDEX IF NOT EXISTS idx_category_history_period ON category_history(period);

-- Historial de límites del monotributo por período
-- Los límites se publican a fines de Enero y Julio, aplican desde ese momento
CREATE TABLE IF NOT EXISTS monotributo_limits_history (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL UNIQUE,       -- Formato: "2026-01" o "2025-07"
  valid_from INTEGER NOT NULL,       -- Fecha desde la que aplican (timestamp)
  valid_until INTEGER,               -- Fecha hasta la que aplican (null = vigente)
  limits_json TEXT NOT NULL,         -- JSON con límites por categoría {"A": 8992597.87, "B": 13175201.52, ...}
  source TEXT,                       -- Fuente: "AFIP", "manual", etc.
  notes TEXT,                        -- Notas opcionales (ej: "Actualización por IPC")
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Índice para búsqueda por fecha
CREATE INDEX IF NOT EXISTS idx_limits_history_valid_from ON monotributo_limits_history(valid_from);

