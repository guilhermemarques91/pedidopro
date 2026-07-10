-- PedidoPro ERP — Impressoras de produção.
-- Cadastro gerenciável de impressoras (ex.: Cozinha, Bar, Chapa) para, no futuro módulo
-- de vendas, direcionar a impressão dos pedidos. products aponta para uma impressora.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS production_printers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  name       VARCHAR(80) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_prodprinter_org (org_id),
  CONSTRAINT fk_prodprinter_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE products
  ADD COLUMN production_printer_id INT NULL AFTER sub_classe_id,
  ADD INDEX idx_products_printer (production_printer_id),
  ADD CONSTRAINT fk_products_printer FOREIGN KEY (production_printer_id) REFERENCES production_printers(id) ON DELETE SET NULL;
