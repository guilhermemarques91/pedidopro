-- PedidoPro ERP — Ficha técnica dos produtos.
-- Evolui `products` com dados fiscais (NCM, CEST, CFOP, origem, CST/CSOSN, GTIN) e
-- campos livres da ficha técnica (rendimento, modo de preparo, tempo, observações).
-- Cria `product_recipe`: os insumos/ingredientes (receita) de um produto, com custo
-- calculado a partir do preço de compra de cada componente.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

ALTER TABLE products
  -- Informações fiscais
  ADD COLUMN ncm         VARCHAR(8)  NULL AFTER sale_price,
  ADD COLUMN cest        VARCHAR(7)  NULL AFTER ncm,
  ADD COLUMN cfop        VARCHAR(4)  NULL AFTER cest,
  ADD COLUMN origem      VARCHAR(1)  NULL AFTER cfop,   -- 0..8 (origem da mercadoria)
  ADD COLUMN cst_csosn   VARCHAR(4)  NULL AFTER origem, -- CST (regime normal) ou CSOSN (Simples)
  ADD COLUMN gtin        VARCHAR(14) NULL AFTER cst_csosn, -- código de barras (EAN/GTIN)
  -- Ficha técnica (campos livres)
  ADD COLUMN yield_qty     DECIMAL(12,3) NULL AFTER gtin,  -- rendimento (quanto a receita produz)
  ADD COLUMN yield_unit    VARCHAR(30)   NULL AFTER yield_qty,
  ADD COLUMN prep_time_min INT           NULL AFTER yield_unit, -- tempo de preparo (min)
  ADD COLUMN prep_method   TEXT          NULL AFTER prep_time_min,
  ADD COLUMN tech_notes    TEXT          NULL AFTER prep_method;

-- Receita/insumos de um produto (matéria-prima -> prato do cardápio).
-- component_id aponta para outro produto (para puxar custo); component_name é o
-- texto livre quando o insumo não está cadastrado como produto.
CREATE TABLE IF NOT EXISTS product_recipe (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL DEFAULT 1,
  product_id     INT NOT NULL,
  component_id   INT NULL,
  component_name VARCHAR(200) NULL,
  quantity       DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit           VARCHAR(30) NULL,
  sort_order     INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_product_recipe_product (product_id),
  KEY idx_product_recipe_org (org_id),
  CONSTRAINT fk_recipe_product   FOREIGN KEY (product_id)   REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_recipe_component FOREIGN KEY (component_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
