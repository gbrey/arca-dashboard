export interface Env {
  DB: D1Database;
  CACHE?: KVNamespace;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  AFIP_SDK_API_KEY?: string;
  TUSFACTURAS_API_KEY?: string;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
}

export interface ArcaAccount {
  id: string;
  user_id: string;
  name: string;
  api_key_encrypted: string;
  api_token_encrypted?: string | null; // Opcional, para APIs que requieren token
  cuit?: string | null; // CUIT para AFIP SDK
  afip_username_encrypted?: string | null; // Username de AFIP
  afip_password_encrypted?: string | null; // Password de AFIP
  cert_encrypted?: string | null; // Certificado digital (para producción)
  key_encrypted?: string | null; // Clave privada (para producción)
  provider: 'afip_sdk' | 'tusfacturas';
  is_default?: number; // 1 si es la cuenta por defecto, 0 si no
  created_at: number;
}

export interface Invoice {
  id: string;
  arca_account_id: string;
  arca_invoice_id: string;
  amount: number;
  date: number;
  description: string | null;
  cached_data: string | null;
  created_at: number;
  updated_at: number;
}

export interface InvoiceTemplate {
  id: string;
  arca_account_id: string;
  description: string;
  default_amount: number | null;
  created_at: number;
}

export interface BillingLimit {
  arca_account_id: string;
  category: string;
  limit_amount: number;
  alert_threshold: number;
  next_due_amount?: number | null;
  next_due_date?: string | null;
  billing_update_date?: string | null;
  billed_amount?: number | null;
}

export interface CategoryHistory {
  id: string;
  arca_account_id: string;
  period: string; // "2026-01" o "2025-07"
  category: string;
  total_billed?: number | null;
  notes?: string | null;
  created_at: number;
  updated_at: number;
}

export interface MonotributoLimitsHistory {
  id: string;
  period: string; // "2026-01" o "2025-07"
  valid_from: number;
  valid_until?: number | null;
  limits_json: string; // JSON string
  source?: string | null;
  notes?: string | null;
  created_at: number;
}

// Helper para generar IDs únicos
export function generateId(): string {
  return crypto.randomUUID();
}

// Helper para obtener timestamp actual
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

