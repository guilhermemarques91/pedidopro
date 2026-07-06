-- Contrato por empresa (Clientes Empresariais / Marmitex):
--  - preço diferenciado por tamanho (ausência = preço base do cardápio);
--  - itens do cardápio ocultos para a empresa (ausência = disponível).
-- O cardápio base continua único; o contrato só sobrepõe o que for diferente.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_company_prices (
  company_id INT NOT NULL,
  size_id    INT NOT NULL,
  price      DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (company_id, size_id),
  CONSTRAINT fk_mcp_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_mcp_size    FOREIGN KEY (size_id)    REFERENCES marmitex_sizes(id)     ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_company_hidden (
  company_id INT NOT NULL,
  item_type  VARCHAR(20) NOT NULL,   -- sizes | proteins | sides | observations
  item_id    INT NOT NULL,
  PRIMARY KEY (company_id, item_type, item_id),
  CONSTRAINT fk_mch_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
