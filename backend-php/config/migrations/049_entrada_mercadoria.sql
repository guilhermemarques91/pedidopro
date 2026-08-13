-- Entrada de mercadoria: o documento que confirma o recebimento.
--
-- Motivacao concreta: o recebimento era um botao de tudo-ou-nada
-- (OrdersController::receive dava entrada da quantidade PEDIDA pelo preco PEDIDO,
-- sem dialogo). Quando o fornecedor mandava 8 das 10 caixas, ou cobrava outro
-- preco, o conferente nao tinha onde dizer isso — entao nao clicava. O banco
-- mostra o resultado: 505 saidas de delivery contra 16 entradas de compra, 32
-- produtos com saldo negativo e avg_cost NULL nos 248 produtos.
--
-- O desenho agora e o do Purchase Receipt: o pedido gera uma entrada AGUARDANDO
-- (o que esperamos receber) e e a NOTA — fiscal ou do fornecedor — que confirma
-- e sobrescreve. A entrada tambem existe sem pedido: muita compra de restaurante
-- chega direto, e barrar isso so faria o operador deixar de lancar.
--
-- qty_expected/price_expected guardam o que o PEDIDO dizia e qty_received/
-- price_received o que a NOTA diz. Manter os dois lados e o que permite mostrar a
-- divergencia em vez de sobrescrever em silencio.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e so descarta
-- comentarios de LINHA INTEIRA — nada de comentario depois do ponto e virgula.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS stock_receipts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  supplier_id   INT NULL,
  order_id      INT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'aguardando',
  source        VARCHAR(20) NOT NULL DEFAULT 'pedido',
  doc_number    VARCHAR(60) NULL,
  doc_key       VARCHAR(44) NULL,
  doc_date      DATE NULL,
  doc_total     DECIMAL(14,2) NULL,
  nfe_import_id INT NULL,
  notes         TEXT NULL,
  created_by    INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_by  INT NULL,
  confirmed_at  TIMESTAMP NULL,
  KEY idx_stock_receipts_org (org_id, status, id),
  KEY idx_stock_receipts_order (order_id),
  KEY idx_stock_receipts_supplier (supplier_id),
  CONSTRAINT fk_stock_receipts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  CONSTRAINT fk_stock_receipts_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_receipt_items (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  receipt_id     INT NOT NULL,
  order_item_id  INT NULL,
  item_id        INT NULL,
  product_id     INT NULL,
  doc_code       VARCHAR(60) NULL,
  doc_name       VARCHAR(200) NULL,
  doc_unit       VARCHAR(30) NULL,
  qty_expected   DECIMAL(12,3) NULL,
  price_expected DECIMAL(12,4) NULL,
  qty_received   DECIMAL(12,3) NULL,
  price_received DECIMAL(12,4) NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'ok',
  sort_order     INT NOT NULL DEFAULT 0,
  KEY idx_stock_receipt_items_receipt (receipt_id, sort_order, id),
  KEY idx_stock_receipt_items_product (product_id),
  CONSTRAINT fk_sri_receipt FOREIGN KEY (receipt_id) REFERENCES stock_receipts(id) ON DELETE CASCADE,
  CONSTRAINT fk_sri_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL,
  CONSTRAINT fk_sri_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL,
  CONSTRAINT fk_sri_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE stock_moves
  ADD COLUMN reason VARCHAR(30) NULL AFTER ref;

CREATE INDEX idx_stock_moves_reason ON stock_moves (org_id, reason, created_at);
