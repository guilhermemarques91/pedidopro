-- Troca forçada de senha no 1º login: flag no usuário. O admin marca ao criar/
-- resetar a senha; o frontend bloqueia a navegação até o usuário trocar via
-- POST /auth/change-password (que zera a flag).
SET NAMES utf8mb4;
ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
