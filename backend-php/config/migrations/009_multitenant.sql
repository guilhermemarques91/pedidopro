-- PedidoPro ERP — Etapa 0: multi-tenant (fundação leve)
-- Introduz o conceito de ORGANIZAÇÃO (tenant do ERP = o negócio dono dos dados),
-- distinto de `users.company_id` (que é o login da empresa-CLIENTE do Marmitex).
--
-- Fundação leve: cria a tabela `organizations`, uma org padrão (id=1) e adiciona
-- `org_id` (NOT NULL DEFAULT 1) nas tabelas-RAIZ de negócio. Tabelas de detalhe
-- (itens de cotação/pedido, marmitas, tokens, eventos) herdam a org pelo pai, então
-- não recebem coluna. Ainda sem UI de troca de tenant — quando virar multi-org de
-- verdade, é só ligar o escopo por org_id nas queries de listagem.
--
-- Aplicada pelo runner (config/migrate.php), uma vez. NÃO é idempotente (ADD COLUMN),
-- mas o runner garante execução única via schema_migrations.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS organizations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  slug       VARCHAR(80),
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_organizations_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Org padrão: todos os dados existentes (single-tenant) pertencem a ela.
INSERT INTO organizations (id, name, slug) VALUES (1, 'Organização padrão', 'default')
  ON DUPLICATE KEY UPDATE id = id;

-- Membership: a qual org o login pertence (staff interno). NULL/1 = org padrão.
ALTER TABLE users
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_users_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_users_org (org_id);

-- === Compras / cadastros (tabelas-raiz) ===
ALTER TABLE categories
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_categories_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_categories_org (org_id);

ALTER TABLE suppliers
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_suppliers_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_suppliers_org (org_id);

ALTER TABLE products
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_products_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_products_org (org_id);

ALTER TABLE items
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_items_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_items_org (org_id);

ALTER TABLE quotations
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_quotations_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_quotations_org (org_id);

ALTER TABLE purchase_requests
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_purchase_requests_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_purchase_requests_org (org_id);

ALTER TABLE orders
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_orders_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_orders_org (org_id);

ALTER TABLE imports
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_imports_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_imports_org (org_id);

ALTER TABLE inbox_prices
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_inbox_prices_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_inbox_prices_org (org_id);

-- === Marmitex (catálogo + empresas-cliente são raízes da org) ===
ALTER TABLE marmitex_companies
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_marmitex_companies_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_marmitex_companies_org (org_id);

ALTER TABLE marmitex_sizes
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_marmitex_sizes_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_marmitex_sizes_org (org_id);

ALTER TABLE marmitex_proteins
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_marmitex_proteins_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_marmitex_proteins_org (org_id);

ALTER TABLE marmitex_sides
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_marmitex_sides_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_marmitex_sides_org (org_id);

ALTER TABLE marmitex_observations
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_marmitex_observations_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_marmitex_observations_org (org_id);

-- === Delivery (raízes operáveis: canais, pedidos, clientes, alertas) ===
ALTER TABLE channels
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_channels_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_channels_org (org_id);

ALTER TABLE delivery_orders
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_delivery_orders_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_delivery_orders_org (org_id);

ALTER TABLE delivery_customers
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_delivery_customers_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_delivery_customers_org (org_id);

ALTER TABLE delivery_alerts
  ADD COLUMN org_id INT NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_delivery_alerts_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  ADD INDEX idx_delivery_alerts_org (org_id);
