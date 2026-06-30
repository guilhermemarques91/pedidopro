-- 007_item_suppliers.sql
-- Permite que um item se relacione a vários fornecedores (modelo aditivo).
-- items.supplier_id continua sendo o "fornecedor de origem"; esta tabela guarda
-- os vínculos (origem + extras). supplier_code/base_price podem variar por fornecedor.

CREATE TABLE IF NOT EXISTS item_suppliers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  item_id       INT NOT NULL,
  supplier_id   INT NOT NULL,
  supplier_code VARCHAR(50) NULL,
  base_price    DECIMAL(12,2) NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_item_supplier (item_id, supplier_id),
  CONSTRAINT fk_is_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_is_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_item_suppliers_supplier ON item_suppliers(supplier_id);

-- Backfill: cada item vira um vínculo com seu fornecedor de origem (copiando preço/código).
INSERT IGNORE INTO item_suppliers (item_id, supplier_id, supplier_code, base_price)
SELECT id, supplier_id, supplier_code, base_price FROM items;
