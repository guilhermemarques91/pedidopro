-- PedidoPro — Schema PostgreSQL

CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'buyer', 'approver')),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  color      VARCHAR(7),
  icon       VARCHAR(50),
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE suppliers (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(150) NOT NULL,
  contact_name     VARCHAR(150),
  phone            VARCHAR(30),
  email            VARCHAR(150),
  category_id      INT REFERENCES categories(id),
  order_type       VARCHAR(20) NOT NULL CHECK (order_type IN ('portal', 'whatsapp')),
  portal_url       TEXT,
  whatsapp_number  VARCHAR(30),
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_category ON suppliers(category_id);

CREATE TABLE items (
  id            SERIAL PRIMARY KEY,
  supplier_id   INT NOT NULL REFERENCES suppliers(id),
  name          VARCHAR(200) NOT NULL,
  unit          VARCHAR(30) NOT NULL,
  package_size  NUMERIC(10,3),
  package_unit  VARCHAR(30),
  base_price    NUMERIC(12,2),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_items_supplier ON items(supplier_id);

CREATE TABLE quotations (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  created_by  INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX idx_quotations_status ON quotations(status);
CREATE INDEX idx_quotations_created_by ON quotations(created_by);

CREATE TABLE quotation_items (
  id             SERIAL PRIMARY KEY,
  quotation_id   INT NOT NULL REFERENCES quotations(id),
  item_id        INT NOT NULL REFERENCES items(id),
  supplier_id    INT NOT NULL REFERENCES suppliers(id),
  price          NUMERIC(12,2),
  quantity       NUMERIC(10,3),
  notes          TEXT,
  source         VARCHAR(20) NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual', 'excel', 'pdf', 'image', 'whatsapp')),
  extracted_by_ai BOOLEAN NOT NULL DEFAULT false,
  reviewed       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qi_quotation ON quotation_items(quotation_id);
CREATE INDEX idx_qi_item ON quotation_items(item_id);
CREATE INDEX idx_qi_supplier ON quotation_items(supplier_id);

CREATE TABLE price_history (
  id           SERIAL PRIMARY KEY,
  item_id      INT NOT NULL REFERENCES items(id),
  supplier_id  INT NOT NULL REFERENCES suppliers(id),
  price        NUMERIC(12,2) NOT NULL,
  quotation_id INT REFERENCES quotations(id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ph_item ON price_history(item_id);
CREATE INDEX idx_ph_supplier ON price_history(supplier_id);

CREATE TABLE orders (
  id               SERIAL PRIMARY KEY,
  supplier_id      INT NOT NULL REFERENCES suppliers(id),
  quotation_id     INT REFERENCES quotations(id),
  status           VARCHAR(30) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'received', 'cancelled')),
  total_amount     NUMERIC(14,2),
  notes            TEXT,
  created_by       INT NOT NULL REFERENCES users(id),
  approved_by      INT REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  received_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_supplier ON orders(supplier_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_by ON orders(created_by);

CREATE TABLE order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id),
  item_id     INT NOT NULL REFERENCES items(id),
  quantity    NUMERIC(10,3) NOT NULL,
  unit_price  NUMERIC(12,2) NOT NULL,
  subtotal    NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes       TEXT
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_approvals (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id),
  action     VARCHAR(20) NOT NULL CHECK (action IN ('approved', 'rejected')),
  user_id    INT NOT NULL REFERENCES users(id),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approvals_order ON order_approvals(order_id);

CREATE TABLE imports (
  id            SERIAL PRIMARY KEY,
  filename      VARCHAR(255) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'error')),
  total_rows    INT,
  imported_rows INT,
  error_rows    INT,
  error_log     JSONB,
  created_by    INT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
