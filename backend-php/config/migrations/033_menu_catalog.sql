-- PedidoPro — Cardápio mestre local (fonte da verdade) publicado para iFood/99Food.
-- Idempotente via CREATE TABLE IF NOT EXISTS (padrão das migrations do projeto).
SET NAMES utf8mb4;

-- Categorias do cardápio (agrupadores de itens). Raiz da org (multi-tenant).
CREATE TABLE IF NOT EXISTS menu_categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  name       VARCHAR(100) NOT NULL,
  sort       INT NOT NULL DEFAULT 0,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_menu_categories_org (org_id),
  CONSTRAINT fk_menu_categories_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Itens vendáveis. Preço em REAIS (decimal); conversão p/ centavos é feita no
-- sync do 99Food. erp_product_id reservado p/ o de-para com estoque/ficha técnica.
CREATE TABLE IF NOT EXISTS menu_items (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL DEFAULT 1,
  category_id    INT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  description    VARCHAR(300),
  price          DECIMAL(12,2) NOT NULL DEFAULT 0,
  original_price DECIMAL(12,2),                    -- preço "de" (riscado) — opcional
  image_url      VARCHAR(500),                     -- imagem já hospedada (por plataforma via links)
  external_code  VARCHAR(60),                      -- código do PDV/ERP (externalCode iFood / app_external_id 99Food)
  erp_product_id INT,                              -- de-para futuro c/ produto do ERP (baixa de estoque)
  sort           INT NOT NULL DEFAULT 0,
  active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_menu_items_category (category_id),
  KEY idx_menu_items_org (org_id),
  CONSTRAINT fk_menu_items_category FOREIGN KEY (category_id) REFERENCES menu_categories(id) ON DELETE CASCADE,
  CONSTRAINT fk_menu_items_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Grupos de complementos de um item (ex.: "Escolha sua proteína").
CREATE TABLE IF NOT EXISTS menu_option_groups (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  item_id   INT NOT NULL,
  name      VARCHAR(100) NOT NULL,
  min       INT NOT NULL DEFAULT 0,               -- 0 = opcional, >0 = obrigatório
  max       INT NOT NULL DEFAULT 1,
  sort      INT NOT NULL DEFAULT 0,
  active    TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_menu_groups_item (item_id),
  CONSTRAINT fk_menu_groups_item FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Complementos (opções) dentro de um grupo.
CREATE TABLE IF NOT EXISTS menu_options (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  group_id    INT NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(300),
  price       DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 0 = incluso
  sort        INT NOT NULL DEFAULT 0,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_menu_options_group (group_id),
  CONSTRAINT fk_menu_options_group FOREIGN KEY (group_id) REFERENCES menu_option_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mapeamento id local ↔ id externo por canal (iFood usa UUIDs gerados por nós e
-- persistidos aqui; 99Food usa app_*_id derivado do id local, mas o registro marca
-- o que já foi publicado). extra guarda ids auxiliares (ex.: productId do iFood).
CREATE TABLE IF NOT EXISTS menu_channel_links (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  channel_id  INT NOT NULL,
  entity_type VARCHAR(20) NOT NULL,               -- category|item|group|option
  local_id    INT NOT NULL,
  external_id VARCHAR(190) NOT NULL,
  extra       JSON,
  synced_at   TIMESTAMP NULL,
  UNIQUE KEY uq_menu_links (channel_id, entity_type, local_id),
  KEY idx_menu_links_channel (channel_id),
  CONSTRAINT fk_menu_links_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Histórico de publicações do cardápio por canal (auditoria + task assíncrona 99Food).
CREATE TABLE IF NOT EXISTS menu_sync_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  channel_id  INT NOT NULL,
  action      VARCHAR(30) NOT NULL,               -- publish|import|item_status|item_update
  status      VARCHAR(20) NOT NULL DEFAULT 'ok',  -- ok|error
  detail      TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_menu_sync_channel (channel_id),
  CONSTRAINT fk_menu_sync_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
