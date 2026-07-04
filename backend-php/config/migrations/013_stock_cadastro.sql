-- PedidoPro ERP — Módulo Estoque (etapa 1: cadastro + filtros).
-- Evolui `products` no cadastro central de materiais/itens/cardápio/bebidas:
--   - product_types: eixo "tipo" gerenciável (matéria-prima, uso e consumo, cardápio, bebida...)
--   - products ganha type_id, supplier_id (fornecedor principal), unit, cost_price (compra), sale_price (venda)
-- Categoria (tabela categories) continua sendo o filtro do topo. Saldo/movimentações virão em outra etapa.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS product_types (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  name       VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_types_org_name (org_id, name),
  KEY idx_product_types_org (org_id),
  CONSTRAINT fk_product_types_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tipos iniciais (a partir dos exemplos do usuário). Editáveis pela tela.
INSERT INTO product_types (org_id, name, sort_order) VALUES
  (1, 'Matéria-prima', 1),
  (1, 'Uso e consumo', 2),
  (1, 'Cardápio',      3),
  (1, 'Bebida',        4)
ON DUPLICATE KEY UPDATE name = VALUES(name);

ALTER TABLE products
  ADD COLUMN type_id     INT NULL AFTER category_id,
  ADD COLUMN supplier_id INT NULL AFTER type_id,
  ADD COLUMN unit        VARCHAR(30) NULL AFTER supplier_id,
  ADD COLUMN cost_price  DECIMAL(12,2) NULL AFTER unit,   -- preço de compra
  ADD COLUMN sale_price  DECIMAL(12,2) NULL AFTER cost_price, -- preço de venda
  ADD CONSTRAINT fk_products_type     FOREIGN KEY (type_id)     REFERENCES product_types(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)     ON DELETE SET NULL,
  ADD INDEX idx_products_type (type_id),
  ADD INDEX idx_products_supplier (supplier_id);
