-- Outbox de WhatsApp (offline-first): envios que falham (Evolution fora/sem
-- internet) ficam na fila e são drenados depois (retry). Log imutável de envio.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  to_number  VARCHAR(30) NOT NULL,
  message    TEXT NOT NULL,
  context    VARCHAR(60) NULL,             -- ex.: order:123 (rastreio)
  status     VARCHAR(12) NOT NULL DEFAULT 'pending', -- pending|sent|failed
  attempts   INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at    TIMESTAMP NULL,
  KEY idx_outbox_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
