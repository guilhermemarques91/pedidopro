-- PedidoPro ERP — Taxonomia de itens no padrão PDV/ERP (espelha o sistema do usuário).
-- Adiciona:
--   - products.tipo         : eixo fixo (Mercadoria, Produto, Combo, Adicional,
--                             Matéria-prima, Item intermediário, Uso e consumo, Ativo imobilizado)
--   - products.sub_classe_id: Sub-classe (filha da Classe = product_types)
--   - products.purchase_unit: unidade de compra/produção (UN.COMPRA/PROD)
--   - campos fiscais de operação: cfop_entrada, regime_tributario
--   - product_subclasses     : cadastro gerenciável das sub-classes (filhas da Classe)
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

-- Sub-classes: filhas de uma Classe (product_types). Ex.: Classe "Refeição" -> Sub-classe "Executivo".
CREATE TABLE IF NOT EXISTS product_subclasses (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  type_id    INT NULL,                 -- Classe de itens pai (product_types) ou NULL (solta)
  name       VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_subclass_org (org_id),
  KEY idx_subclass_type (type_id),
  CONSTRAINT fk_subclass_org  FOREIGN KEY (org_id)  REFERENCES organizations(id),
  CONSTRAINT fk_subclass_type FOREIGN KEY (type_id) REFERENCES product_types(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE products
  ADD COLUMN tipo              VARCHAR(30) NULL AFTER name,
  ADD COLUMN sub_classe_id     INT         NULL AFTER type_id,
  ADD COLUMN purchase_unit     VARCHAR(30) NULL AFTER unit,
  ADD COLUMN cfop_entrada      VARCHAR(4)  NULL AFTER cfop,
  ADD COLUMN regime_tributario VARCHAR(40) NULL AFTER cfop_entrada,
  ADD INDEX idx_products_tipo (tipo),
  ADD INDEX idx_products_subclasse (sub_classe_id),
  ADD CONSTRAINT fk_products_subclasse FOREIGN KEY (sub_classe_id) REFERENCES product_subclasses(id) ON DELETE SET NULL;
