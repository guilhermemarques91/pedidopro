-- Migração 002: papel 'requester', listas de compra e rastreabilidade lista→pedidos.
-- Idempotente o suficiente para rodar uma vez no pedidopro_dev.

-- 1) Novo papel 'requester' no CHECK de users.role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'buyer', 'approver', 'requester'));

-- 2) Lista de compras
CREATE TABLE IF NOT EXISTS purchase_requests (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'submitted', 'allocated', 'ordered', 'cancelled')),
  notes        TEXT,
  created_by   INT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_preq_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_preq_created_by ON purchase_requests(created_by);

CREATE TABLE IF NOT EXISTS purchase_request_items (
  id               SERIAL PRIMARY KEY,
  request_id       INT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id       INT REFERENCES products(id) ON DELETE SET NULL,
  free_text        VARCHAR(200),
  quantity         NUMERIC(10,3) NOT NULL,
  unit             VARCHAR(30) NOT NULL DEFAULT 'un',
  notes            TEXT,
  alloc_supplier_id INT REFERENCES suppliers(id),
  alloc_item_id     INT REFERENCES items(id),
  alloc_name        VARCHAR(200),
  alloc_unit        VARCHAR(30),
  alloc_price       NUMERIC(12,2),
  CHECK (product_id IS NOT NULL OR free_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_preq_items_request ON purchase_request_items(request_id);

-- 3) orders → purchase_requests
ALTER TABLE orders ADD COLUMN IF NOT EXISTS purchase_request_id INT;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_purchase_request;
ALTER TABLE orders ADD CONSTRAINT fk_orders_purchase_request
  FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id);
CREATE INDEX IF NOT EXISTS idx_orders_preq ON orders(purchase_request_id);
