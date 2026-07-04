-- PedidoPro ERP — login por nome de usuário (username) em vez de e-mail.
-- O e-mail deixa de ser obrigatório (vira opcional). username é a credencial.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

-- 1) Coluna username (temporariamente NULL para backfill).
ALTER TABLE users ADD COLUMN username VARCHAR(80) NULL AFTER name;

-- 2) Backfill: usa o e-mail (único) como username inicial; admin ganha 'admin'.
UPDATE users SET username = email WHERE username IS NULL;
UPDATE users SET username = 'admin' WHERE email = 'admin@pedidopro.local';

-- 3) username passa a obrigatório e único; e-mail passa a opcional.
ALTER TABLE users MODIFY username VARCHAR(80) NOT NULL, ADD UNIQUE KEY uq_users_username (username);
ALTER TABLE users MODIFY email VARCHAR(150) NULL;
