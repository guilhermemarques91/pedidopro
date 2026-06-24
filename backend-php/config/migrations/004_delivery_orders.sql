-- PedidoPro — Módulo Delivery (agregador iFood + 99Food)
-- Recebe e opera pedidos de CLIENTES (vendas), distinto das tabelas de compras.
-- Idempotente via CREATE TABLE IF NOT EXISTS (não dropa: protege dados em produção).
-- Índices definidos inline no CREATE para não falhar em reexecução.
SET NAMES utf8mb4;

-- Uma linha por integração (loja × plataforma). Credenciais ficam aqui (não no .env)
-- para permitir cadastro/edição pela UI e múltiplas lojas.
CREATE TABLE IF NOT EXISTS channels (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  platform       VARCHAR(20) NOT NULL,            -- 'ifood' | '99food'
  name           VARCHAR(150) NOT NULL,
  merchant_id    VARCHAR(120),
  client_id      VARCHAR(190),
  client_secret  TEXT,
  webhook_secret VARCHAR(190),
  active          TINYINT(1) NOT NULL DEFAULT 1,
  auto_confirm    TINYINT(1) NOT NULL DEFAULT 0,  -- confirma pedidos 'placed' automaticamente (aceite automático)
  extra           JSON,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_channels_platform_merchant (platform, merchant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cache de token OAuth (client_credentials). Refresh sob demanda quando expira.
CREATE TABLE IF NOT EXISTS channel_tokens (
  channel_id   INT NOT NULL PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at   TIMESTAMP NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_channel_tokens_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Clientes por plataforma — base para "novos vs recorrentes" (Fase 2).
CREATE TABLE IF NOT EXISTS delivery_customers (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  platform             VARCHAR(20) NOT NULL,
  platform_customer_id VARCHAR(160),
  name                 VARCHAR(190),
  phone                VARCHAR(40),
  first_order_at       TIMESTAMP NULL,
  last_order_at        TIMESTAMP NULL,
  orders_count         INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_delivery_customers (platform, platform_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pedido normalizado (modelo unificado entre plataformas).
CREATE TABLE IF NOT EXISTS delivery_orders (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  channel_id        INT,
  platform          VARCHAR(20) NOT NULL,          -- 'ifood' | '99food'
  platform_order_id VARCHAR(160) NOT NULL,         -- id interno da plataforma
  display_id        VARCHAR(40),                   -- nº curto/verificador exibido
  merchant_id       VARCHAR(120),
  -- Status unificado: placed|confirmed|preparing|ready|dispatched|concluded|cancelled
  status            VARCHAR(20) NOT NULL DEFAULT 'placed',
  platform_status   VARCHAR(40),                   -- status cru da plataforma
  order_type        VARCHAR(20) NOT NULL DEFAULT 'delivery', -- delivery|takeout
  -- Entrega
  delivery_mode     VARCHAR(20),                   -- own|partner (99Food híbrido)
  delivery_address  JSON,
  delivery_distance_m INT,
  eta               TIMESTAMP NULL,
  driver            JSON,
  -- Cliente (snapshot + FK opcional)
  customer_id       INT,
  customer_name     VARCHAR(190),
  customer_phone    VARCHAR(40),
  -- Valores (conciliação fina na Fase 2; campos já disponíveis)
  items_amount      DECIMAL(12,2),
  delivery_fee      DECIMAL(12,2),
  discount_merchant DECIMAL(12,2),
  discount_platform DECIMAL(12,2),
  customer_paid     DECIMAL(12,2),
  commission        DECIMAL(12,2),
  net_amount        DECIMAL(12,2),
  -- Tempos
  placed_at         TIMESTAMP NULL,
  confirmed_at      TIMESTAMP NULL,
  ready_at          TIMESTAMP NULL,
  dispatched_at     TIMESTAMP NULL,
  concluded_at      TIMESTAMP NULL,
  cancelled_at      TIMESTAMP NULL,
  raw               JSON,                          -- payload original (auditoria/reprocesso)
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_delivery_orders (platform, platform_order_id),
  KEY idx_delivery_orders_status (status),
  KEY idx_delivery_orders_platform (platform),
  KEY idx_delivery_orders_placed (placed_at),
  CONSTRAINT fk_delivery_orders_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE SET NULL,
  CONSTRAINT fk_delivery_orders_customer FOREIGN KEY (customer_id) REFERENCES delivery_customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_order_items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  order_id     INT NOT NULL,
  name         VARCHAR(200) NOT NULL,
  quantity     DECIMAL(10,3) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(12,2),
  total        DECIMAL(12,2),
  observations TEXT,
  options      JSON,
  KEY idx_delivery_items_order (order_id),
  CONSTRAINT fk_delivery_items_order FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fila de idempotência: deduplica eventos vindos por webhook E por polling.
CREATE TABLE IF NOT EXISTS channel_events (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  platform      VARCHAR(20) NOT NULL,
  event_id      VARCHAR(190) NOT NULL,
  order_id      VARCHAR(160),                      -- id do pedido na plataforma
  type          VARCHAR(60),
  source        VARCHAR(12) NOT NULL DEFAULT 'webhook', -- webhook|polling
  payload       JSON,
  received_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at  TIMESTAMP NULL,
  UNIQUE KEY uq_channel_events (platform, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
