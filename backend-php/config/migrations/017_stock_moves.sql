-- Módulo Estoque etapa 2: saldo e movimentações.
-- Fonte da verdade = stock_moves (log imutável); products.stock_qty/avg_cost são
-- o saldo materializado (atualizados na mesma transação de cada movimento).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS stock_moves (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  product_id    INT NOT NULL,
  type          VARCHAR(10) NOT NULL,            -- in | out | adjust
  qty_delta     DECIMAL(12,3) NOT NULL,          -- variação aplicada ao saldo (+/-)
  unit_cost     DECIMAL(12,4) NULL,              -- custo unitário (entradas)
  balance_after DECIMAL(12,3) NOT NULL,          -- saldo após o movimento
  ref           VARCHAR(60) NULL,                -- origem: order:N | manual
  notes         VARCHAR(255) NULL,
  created_by    INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_stock_moves_product (product_id, id),
  KEY idx_stock_moves_org (org_id, created_at),
  CONSTRAINT fk_stock_moves_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE products
  ADD COLUMN stock_qty DECIMAL(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN avg_cost  DECIMAL(12,4) NULL;
