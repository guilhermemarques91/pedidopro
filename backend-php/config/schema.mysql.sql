-- PedidoPro — Schema MySQL (porte do schema PostgreSQL)
-- Importar via phpMyAdmin no banco criado pelo cPanel.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(20) NOT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (role IN ('admin','buyer','approver','requester'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  color      VARCHAR(7),
  icon       VARCHAR(50),
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE suppliers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  contact_name    VARCHAR(150),
  phone           VARCHAR(30),
  email           VARCHAR(150),
  category_id     INT,
  order_type      VARCHAR(20) NOT NULL,
  portal_url      TEXT,
  whatsapp_number VARCHAR(30),
  notes           TEXT,
  active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_suppliers_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CHECK (order_type IN ('portal','whatsapp'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_suppliers_category ON suppliers(category_id);

CREATE TABLE products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  category_id INT,
  active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE items (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id  INT NOT NULL,
  product_id   INT,
  name         VARCHAR(200) NOT NULL,
  unit         VARCHAR(30) NOT NULL,
  package_size DECIMAL(10,3),
  package_unit VARCHAR(30),
  base_price   DECIMAL(12,2),
  active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_items_supplier ON items(supplier_id);
CREATE INDEX idx_items_product ON items(product_id);

CREATE TABLE quotations (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(200) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at  TIMESTAMP NULL,
  CONSTRAINT fk_quotations_user FOREIGN KEY (created_by) REFERENCES users(id),
  CHECK (status IN ('draft','active','closed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_quotations_status ON quotations(status);
CREATE INDEX idx_quotations_created_by ON quotations(created_by);

CREATE TABLE quotation_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id    INT NOT NULL,
  item_id         INT NOT NULL,
  supplier_id     INT NOT NULL,
  price           DECIMAL(12,2),
  quantity        DECIMAL(10,3),
  notes           TEXT,
  source          VARCHAR(20) NOT NULL DEFAULT 'manual',
  extracted_by_ai TINYINT(1) NOT NULL DEFAULT 0,
  reviewed        TINYINT(1) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_qi_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id),
  CONSTRAINT fk_qi_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_qi_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CHECK (source IN ('manual','excel','pdf','image','whatsapp'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_qi_quotation ON quotation_items(quotation_id);
CREATE INDEX idx_qi_item ON quotation_items(item_id);
CREATE INDEX idx_qi_supplier ON quotation_items(supplier_id);

CREATE TABLE price_history (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  item_id      INT NOT NULL,
  supplier_id  INT NOT NULL,
  price        DECIMAL(12,2) NOT NULL,
  quotation_id INT,
  recorded_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ph_item FOREIGN KEY (item_id) REFERENCES items(id),
  CONSTRAINT fk_ph_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_ph_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_ph_item ON price_history(item_id);
CREATE INDEX idx_ph_supplier ON price_history(supplier_id);

CREATE TABLE purchase_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  title        VARCHAR(200) NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'draft',
  notes        TEXT,
  created_by   INT NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMP NULL,
  CONSTRAINT fk_preq_user FOREIGN KEY (created_by) REFERENCES users(id),
  CHECK (status IN ('draft','submitted','allocated','ordered','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_preq_status ON purchase_requests(status);
CREATE INDEX idx_preq_created_by ON purchase_requests(created_by);

CREATE TABLE orders (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id         INT NOT NULL,
  quotation_id        INT,
  purchase_request_id INT,
  status              VARCHAR(30) NOT NULL DEFAULT 'draft',
  total_amount        DECIMAL(14,2),
  notes               TEXT,
  created_by          INT NOT NULL,
  approved_by         INT,
  approved_at         TIMESTAMP NULL,
  sent_at             TIMESTAMP NULL,
  received_at         TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_orders_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id),
  CONSTRAINT fk_orders_preq FOREIGN KEY (purchase_request_id) REFERENCES purchase_requests(id),
  CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_orders_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  CHECK (status IN ('draft','pending_approval','approved','sent','received','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_orders_supplier ON orders(supplier_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_by ON orders(created_by);
CREATE INDEX idx_orders_preq ON orders(purchase_request_id);

CREATE TABLE purchase_request_items (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  request_id        INT NOT NULL,
  product_id        INT,
  free_text         VARCHAR(200),
  quantity          DECIMAL(10,3) NOT NULL,
  unit              VARCHAR(30) NOT NULL DEFAULT 'un',
  notes             TEXT,
  alloc_supplier_id INT,
  alloc_item_id     INT,
  alloc_name        VARCHAR(200),
  alloc_unit        VARCHAR(30),
  alloc_price       DECIMAL(12,2),
  CONSTRAINT fk_preq_items_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_preq_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_preq_items_supplier FOREIGN KEY (alloc_supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_preq_items_item FOREIGN KEY (alloc_item_id) REFERENCES items(id),
  CHECK (product_id IS NOT NULL OR free_text IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_preq_items_request ON purchase_request_items(request_id);

CREATE TABLE order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  item_id    INT NOT NULL,
  quantity   DECIMAL(10,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  subtotal   DECIMAL(14,2) AS (quantity * unit_price) STORED,
  notes      TEXT,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_items_item FOREIGN KEY (item_id) REFERENCES items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_approvals (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  action     VARCHAR(20) NOT NULL,
  user_id    INT NOT NULL,
  comment    TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_approvals_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_approvals_user FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (action IN ('approved','rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_approvals_order ON order_approvals(order_id);

CREATE TABLE imports (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  filename      VARCHAR(255) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  total_rows    INT,
  imported_rows INT,
  error_rows    INT,
  error_log     JSON,
  created_by    INT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_imports_user FOREIGN KEY (created_by) REFERENCES users(id),
  CHECK (status IN ('pending','processing','done','error'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inbox_prices (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  message_key VARCHAR(128) NOT NULL,
  raw_message TEXT,
  item_name   VARCHAR(200) NOT NULL,
  unit        VARCHAR(30) NOT NULL DEFAULT 'un',
  price       DECIMAL(12,2),
  quantity    DECIMAL(10,3),
  notes       TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',
  received_at TIMESTAMP NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  reviewed_by INT,
  CONSTRAINT fk_inbox_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_inbox_user FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CHECK (status IN ('pending','approved','discarded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX idx_inbox_status ON inbox_prices(status, supplier_id);
CREATE INDEX idx_inbox_msgkey ON inbox_prices(message_key);

SET FOREIGN_KEY_CHECKS = 1;
