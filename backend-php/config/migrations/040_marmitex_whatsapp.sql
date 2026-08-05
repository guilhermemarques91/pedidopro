-- Pedidos de clientes empresariais lidos do grupo de WhatsApp.
--
-- Hoje as empresas mandam o pedido do dia no grupo e alguém redigita marmita por
-- marmita na tela. Aqui entra o caminho automático: a mensagem cai numa staging
-- (marmitex_wa_messages), o worker interpreta com a IA local e monta o RASCUNHO do
-- dia (marmitex_wa_drafts + _draft_lines). Só o rascunho vira pedido de verdade —
-- automaticamente quando 100% das linhas casaram com o cardápio, ou pela tela de
-- revisão quando sobrou dúvida.
--
-- Por que a staging existe em vez de parsear no webhook: a IA local (CPU) leva
-- minutos e o túnel Cloudflare corta em 100s. O webhook só faz INSERT e responde
-- 200; quem paga a IA é o worker (CLI), igual ao sync de preços de fornecedor.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_wa_configs (
  company_id              INT NOT NULL PRIMARY KEY,
  enabled                 TINYINT(1) NOT NULL DEFAULT 0,
  group_jid               VARCHAR(80) NOT NULL,
  mode                    VARCHAR(20) NOT NULL DEFAULT 'incremental',
  list_replaces           TINYINT(1) NOT NULL DEFAULT 1,
  auto_apply              TINYINT(1) NOT NULL DEFAULT 0,
  auto_apply_after_cutoff TINYINT(1) NOT NULL DEFAULT 0,
  confirm_reply           TINYINT(1) NOT NULL DEFAULT 0,
  default_size_id         INT NULL,
  aliases_json            JSON NULL,
  ai_instructions         TEXT NULL,
  enabled_at              TIMESTAMP NULL,
  last_sweep_at           TIMESTAMP NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wa_group (group_jid),
  CONSTRAINT fk_wa_cfg_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_cfg_size FOREIGN KEY (default_size_id) REFERENCES marmitex_sizes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_wa_messages (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id    INT NOT NULL,
  group_jid     VARCHAR(80) NOT NULL,
  message_key   VARCHAR(160) NOT NULL,
  sender_jid    VARCHAR(80) NULL,
  sender_name   VARCHAR(150) NULL,
  body          TEXT NULL,
  message_ts    TIMESTAMP NULL,
  service_date  DATE NULL,
  source        VARCHAR(12) NOT NULL DEFAULT 'webhook',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  ignore_reason VARCHAR(160) NULL,
  attempts      INT NOT NULL DEFAULT 0,
  revision      INT NOT NULL DEFAULT 0,
  ai_raw        JSON NULL,
  payload       JSON NULL,
  error         TEXT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  parsed_at     TIMESTAMP NULL,
  UNIQUE KEY uq_wa_msg_key (message_key),
  KEY idx_wa_msg_queue (status, id),
  KEY idx_wa_msg_day (company_id, service_date),
  CONSTRAINT fk_wa_msg_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_wa_drafts (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  company_id       INT NOT NULL,
  service_date     DATE NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  block_reason     VARCHAR(255) NULL,
  late             TINYINT(1) NOT NULL DEFAULT 0,
  auto_applied     TINYINT(1) NOT NULL DEFAULT 0,
  applied_order_id INT NULL,
  applied_at       TIMESTAMP NULL,
  applied_by       INT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wa_draft_day (company_id, service_date),
  KEY idx_wa_draft_status (status, service_date),
  CONSTRAINT fk_wa_draft_company FOREIGN KEY (company_id) REFERENCES marmitex_companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marmitex_wa_draft_lines (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  draft_id      INT NOT NULL,
  message_id    INT NULL,
  line_index    INT NOT NULL DEFAULT 0,
  raw_text      VARCHAR(500) NULL,
  person_name   VARCHAR(150) NULL,
  size_id       INT NULL,
  protein_id    INT NULL,
  side_ids_json JSON NULL,
  observation   VARCHAR(255) NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'ok',
  issues_json   JSON NULL,
  fingerprint   VARCHAR(64) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_wa_line_draft (draft_id, status),
  CONSTRAINT fk_wa_line_draft FOREIGN KEY (draft_id) REFERENCES marmitex_wa_drafts(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_line_msg FOREIGN KEY (message_id) REFERENCES marmitex_wa_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE marmitex_orders ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual' AFTER status;

ALTER TABLE marmitex_orders ADD COLUMN wa_draft_id INT NULL AFTER source;
