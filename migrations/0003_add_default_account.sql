-- Agregar campo is_default para marcar cuenta por defecto
ALTER TABLE arca_accounts ADD COLUMN is_default INTEGER DEFAULT 0;

-- Índice para mejorar búsqueda de cuenta default
CREATE INDEX IF NOT EXISTS idx_arca_accounts_user_default ON arca_accounts(user_id, is_default);

