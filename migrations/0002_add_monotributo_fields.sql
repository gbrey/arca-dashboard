-- Agregar campos de información de monotributo a billing_limits
ALTER TABLE billing_limits ADD COLUMN next_due_amount REAL;
ALTER TABLE billing_limits ADD COLUMN next_due_date TEXT;
ALTER TABLE billing_limits ADD COLUMN billing_update_date TEXT;
ALTER TABLE billing_limits ADD COLUMN billed_amount REAL;

