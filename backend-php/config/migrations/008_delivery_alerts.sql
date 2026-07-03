-- PedidoPro — Módulo Delivery: alertas acionáveis (solicitações de cancelamento)
-- Cliente/plataforma pede pra cancelar um pedido já aceito → a loja aceita ou recusa.
-- Idempotente (CREATE TABLE IF NOT EXISTS); índices inline.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS delivery_alerts (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  order_id          INT,                                  -- FK delivery_orders.id (pode chegar antes do pedido)
  platform          VARCHAR(20) NOT NULL,                 -- 'ifood' | '99food'
  platform_order_id VARCHAR(160) NOT NULL,
  type              VARCHAR(40) NOT NULL DEFAULT 'cancellation_request',
  external_id       VARCHAR(190),                         -- disputeId (iFood) | apply_id (99Food)
  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|expired
  reason            TEXT,
  expires_at        TIMESTAMP NULL,
  payload           JSON,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at       TIMESTAMP NULL,
  UNIQUE KEY uq_delivery_alerts (platform, external_id),
  KEY idx_delivery_alerts_status (status),
  KEY idx_delivery_alerts_order (order_id),
  CONSTRAINT fk_delivery_alerts_order FOREIGN KEY (order_id) REFERENCES delivery_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
