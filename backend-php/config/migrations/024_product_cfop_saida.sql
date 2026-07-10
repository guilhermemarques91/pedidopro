-- PedidoPro ERP — Operações fiscais de SAÍDA (CFOP) por destino.
-- O CFOP de saída depende do endereço do cliente da nota: dentro (5xxx) ou fora (6xxx)
-- do estado. Reaproveitamos `products.cfop` como "saída DENTRO do estado" (padrão quando
-- não há cliente vinculado) e adicionamos `cfop_saida_fora` para "saída FORA do estado".
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

ALTER TABLE products
  ADD COLUMN cfop_saida_fora VARCHAR(4) NULL AFTER cfop; -- CFOP de saída interestadual (6xxx)
