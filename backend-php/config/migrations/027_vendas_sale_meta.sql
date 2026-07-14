-- PedidoPro ERP — Vendas: nome do cliente e quantidade de pessoas (mesa/comanda/retirada).
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

ALTER TABLE sales
  ADD COLUMN customer_name VARCHAR(120) NULL AFTER notes,
  ADD COLUMN party_size SMALLINT UNSIGNED NULL AFTER customer_name;
