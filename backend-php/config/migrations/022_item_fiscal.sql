-- PedidoPro ERP — Item de catálogo desacoplado do fornecedor + dados fiscais de entrada.
-- Mudança de modelo: items.supplier_id passa a ser OPCIONAL. O item vira catálogo puro;
-- os fornecedores do item vivem em item_suppliers (preenchido no lançamento da NF-e de
-- entrada ou manualmente na tela do item). Adiciona campos fiscais de entrada.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

ALTER TABLE items
  MODIFY COLUMN supplier_id INT NULL,
  -- Dados tributários de entrada
  ADD COLUMN ncm       VARCHAR(8)  NULL AFTER base_price,
  ADD COLUMN cest      VARCHAR(7)  NULL AFTER ncm,
  ADD COLUMN cfop      VARCHAR(4)  NULL AFTER cest,
  ADD COLUMN origem    VARCHAR(1)  NULL AFTER cfop,     -- 0..8 (origem da mercadoria)
  ADD COLUMN cst_csosn VARCHAR(4)  NULL AFTER origem,   -- CST (regime normal) ou CSOSN (Simples)
  ADD COLUMN gtin      VARCHAR(14) NULL AFTER cst_csosn; -- código de barras (EAN/GTIN)
