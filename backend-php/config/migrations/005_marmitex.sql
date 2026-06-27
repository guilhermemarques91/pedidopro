-- PedidoPro — Módulo Marmitex (catering B2B de marmitas para empresas)
-- Empresas-cliente passam os pedidos diariamente FORA do ERP; o dono fatura depois
-- (NF-e) lendo o relatório de consumo agrupado. Distinto das tabelas de compras/delivery.
-- Tabelas idempotentes (CREATE TABLE IF NOT EXISTS). O ALTER de `users` roda UMA vez
-- (rodar de novo num banco já migrado falha no ALTER — esperado).
SET NAMES utf8mb4;

-- Empresas-cliente (tenants). O login da empresa é um users.role='company' + company_id.
CREATE TABLE IF NOT EXISTS marmitex_companies (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(150) NOT NULL,
  cnpj              VARCHAR(20),
  contact_name      VARCHAR(150),
  phone             VARCHAR(30),
  email             VARCHAR(150),
  notes             TEXT,
  order_cutoff_time TIME NULL,                       -- horário-limite de edição do pedido do dia
  active            TINYINT(1) NOT NULL DEFAULT 1,
  created_by        INT,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vincula um login (users) à empresa. NULL para usuários internos (staff). Roda uma vez.
ALTER TABLE users ADD COLUMN company_id INT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE SET NULL;

-- Catálogo gerencial (cadastro do dono). Preço só no tamanho (decisão de negócio).
CREATE TABLE IF NOT EXISTS marmitex_sizes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(80) NOT NULL,
  price      DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_proteins (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_sides (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_observations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fechamento de período = relatório gerado. Congela o agregado em report_json.
CREATE TABLE IF NOT EXISTS marmitex_invoices (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id    INT NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'closed',   -- 'closed' | 'cancelled'
  total_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  marmita_count INT NOT NULL DEFAULT 0,
  report_json   JSON,
  created_by    INT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_marmitex_invoices_company (company_id),
  CONSTRAINT fk_marmitex_invoices_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cabeçalho = submissão diária. Um por empresa por dia (UNIQUE).
CREATE TABLE IF NOT EXISTS marmitex_orders (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  company_id   INT NOT NULL,
  service_date DATE NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'submitted', -- 'submitted' | 'cancelled'
  notes        TEXT,
  created_by   INT,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marmitex_order_day (company_id, service_date),
  CONSTRAINT fk_marmitex_orders_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Uma linha por marmita individual: alimenta etiquetas (uma por marmita) E o relatório.
-- Nomes/preço são snapshot no envio (não mudam se o catálogo mudar depois).
CREATE TABLE IF NOT EXISTS marmitex_marmitas (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT NOT NULL,
  company_id        INT NOT NULL,                        -- desnormalizado p/ relatório
  service_date      DATE NOT NULL,                       -- desnormalizado p/ filtro de período
  person_name       VARCHAR(150),                        -- nome da etiqueta
  size_id           INT,
  size_name         VARCHAR(80) NOT NULL,                -- snapshot
  protein_id        INT,
  protein_name      VARCHAR(120),                        -- snapshot
  sides_json        JSON,                                -- snapshot: [{id,name}]
  observation       VARCHAR(255),
  unit_price        DECIMAL(12,2) NOT NULL DEFAULT 0,    -- = tamanho.price no envio
  billed_invoice_id INT NULL,                            -- NULL = pendente/não faturado
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_marmitas_company_date (company_id, service_date),
  KEY idx_marmitas_billed (billed_invoice_id),
  KEY idx_marmitas_order (order_id),
  CONSTRAINT fk_marmitas_order   FOREIGN KEY (order_id)          REFERENCES marmitex_orders(id)    ON DELETE CASCADE,
  CONSTRAINT fk_marmitas_size    FOREIGN KEY (size_id)           REFERENCES marmitex_sizes(id)     ON DELETE SET NULL,
  CONSTRAINT fk_marmitas_protein FOREIGN KEY (protein_id)        REFERENCES marmitex_proteins(id)  ON DELETE SET NULL,
  CONSTRAINT fk_marmitas_invoice FOREIGN KEY (billed_invoice_id) REFERENCES marmitex_invoices(id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
