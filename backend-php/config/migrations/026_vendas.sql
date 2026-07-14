-- PedidoPro ERP — Módulo Vendas (balcão, retirada, mesas e comandas).
-- Painel Kanban unificado (Enviado -> Pronto -> Aguardando pagamento -> Concluído),
-- que também exibe delivery_orders (iFood/99Food) junto via filtro de origem.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

-- Cadastro fixo de mesas/comandas (evita digitação livre e mostra ocupação).
CREATE TABLE IF NOT EXISTS sales_stations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  kind       ENUM('mesa','comanda') NOT NULL,
  number     VARCHAR(10) NOT NULL,
  label      VARCHAR(60) NULL,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_station (org_id, kind, number),
  CONSTRAINT fk_stations_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contador atômico da senha diária (balcão + retirada compartilham a sequência).
CREATE TABLE IF NOT EXISTS sales_counters (
  org_id       INT NOT NULL DEFAULT 1,
  counter_date DATE NOT NULL,
  last_number  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, counter_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL DEFAULT 1,
  origin         ENUM('mesa','comanda','balcao','retirada') NOT NULL,
  station_id     INT NULL,               -- só mesa/comanda
  daily_number   INT NULL,               -- só balcão/retirada (senha do dia)
  status         ENUM('sent','ready','awaiting_payment','completed','cancelled') NOT NULL DEFAULT 'sent',
  payment_method VARCHAR(20) NULL,       -- dinheiro|debito|credito|pix|outro
  payment_status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  total_amount   DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes          VARCHAR(255) NULL,
  created_by     INT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at       TIMESTAMP NULL,
  paid_at        TIMESTAMP NULL,
  completed_at   TIMESTAMP NULL,
  cancelled_at   TIMESTAMP NULL,
  cancelled_by   INT NULL,
  KEY idx_sales_org_date (org_id, created_at),
  KEY idx_sales_station_open (station_id, status),
  CONSTRAINT fk_sales_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_sales_station FOREIGN KEY (station_id) REFERENCES sales_stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sale_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  sale_id      INT NOT NULL,
  product_id   INT NOT NULL,
  product_name VARCHAR(160) NOT NULL,   -- snapshot
  unit_price   DECIMAL(12,2) NOT NULL,  -- snapshot do sale_price
  quantity     DECIMAL(12,3) NOT NULL,
  subtotal     DECIMAL(12,2) NOT NULL,
  round_no     INT NOT NULL DEFAULT 1,  -- qual "envio" (mesa/comanda podem ter vários)
  sent_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_saleitems_sale (sale_id),
  CONSTRAINT fk_saleitems_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_saleitems_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
