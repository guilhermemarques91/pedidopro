-- Entrada de estoque por NF-e (XML). Registro por nota importada — a chave de
-- acesso única impede lançar a mesma nota duas vezes.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS nfe_imports (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  access_key    VARCHAR(44) NOT NULL,
  number        VARCHAR(20) NULL,
  supplier_cnpj VARCHAR(20) NULL,
  supplier_name VARCHAR(150) NULL,
  supplier_id   INT NULL,
  issued_at     DATETIME NULL,
  total         DECIMAL(14,2) NULL,
  item_count    INT NOT NULL DEFAULT 0,
  created_by    INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_nfe_key (access_key),
  KEY idx_nfe_org (org_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CNPJ no fornecedor: casa o emitente da NF-e com o cadastro (e prepara a
-- futura busca automática de notas contra o CNPJ).
ALTER TABLE suppliers ADD COLUMN cnpj VARCHAR(20) NULL;
