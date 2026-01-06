-- Agregar campo is_admin para identificar usuarios administradores
ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;

-- Agregar campo is_blocked para bloquear usuarios
ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0;

-- Marcar gusbrey@gmail.com como admin
UPDATE users SET is_admin = 1 WHERE email = 'gusbrey@gmail.com';

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
CREATE INDEX IF NOT EXISTS idx_users_is_blocked ON users(is_blocked);

