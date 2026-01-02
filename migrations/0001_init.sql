-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tabla de cuentas ARCA vinculadas
CREATE TABLE IF NOT EXISTS arca_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_token_encrypted TEXT, -- Opcional, para APIs que requieren token además de key
  cuit TEXT, -- CUIT para AFIP SDK
  afip_username_encrypted TEXT, -- Username de AFIP (encriptado)
  afip_password_encrypted TEXT, -- Password de AFIP (encriptado)
  cert_encrypted TEXT, -- Certificado digital encriptado (para producción)
  key_encrypted TEXT, -- Clave privada encriptada (para producción)
  provider TEXT NOT NULL DEFAULT 'afip_sdk', -- 'afip_sdk' o 'tusfacturas'
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabla de facturas (cache local)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  arca_account_id TEXT NOT NULL,
  arca_invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  date INTEGER NOT NULL,
  description TEXT,
  cached_data TEXT, -- JSON con datos completos de ARCA
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (arca_account_id) REFERENCES arca_accounts(id) ON DELETE CASCADE
);

-- Tabla de plantillas para emisión mensual
CREATE TABLE IF NOT EXISTS invoice_templates (
  id TEXT PRIMARY KEY,
  arca_account_id TEXT NOT NULL,
  description TEXT NOT NULL,
  default_amount REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (arca_account_id) REFERENCES arca_accounts(id) ON DELETE CASCADE
);

-- Tabla de límites de facturación por cuenta
CREATE TABLE IF NOT EXISTS billing_limits (
  arca_account_id TEXT PRIMARY KEY,
  category TEXT NOT NULL, -- A, B, C, D, E, F, G, H
  limit_amount REAL NOT NULL,
  alert_threshold REAL NOT NULL DEFAULT 0.8, -- 80% por defecto
  FOREIGN KEY (arca_account_id) REFERENCES arca_accounts(id) ON DELETE CASCADE
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_invoices_account_date ON invoices(arca_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date DESC);
CREATE INDEX IF NOT EXISTS idx_arca_accounts_user ON arca_accounts(user_id);

