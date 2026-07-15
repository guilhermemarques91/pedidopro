-- PedidoPro ERP — Produtos: código interno do sistema de origem (ex.: AllFood), para
-- casar linhas em reimportações futuras da planilha de produtos/mercadorias.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

ALTER TABLE products
  ADD COLUMN external_code VARCHAR(30) NULL AFTER name,
  ADD UNIQUE KEY uq_products_org_extcode (org_id, external_code);
