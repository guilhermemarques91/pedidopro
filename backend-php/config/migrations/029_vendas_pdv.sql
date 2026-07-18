-- PedidoPro ERP — Vendas PDV: pagamento dividido, observações de preparo por item
-- (com remoção de insumos da ficha) e variações de ficha técnica (ex.: Executivo
-- muda só a proteína). Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

-- Pagamento dividido: uma venda pode ser recebida em várias formas (parte dinheiro,
-- parte cartão...). sales.payment_method vira um resumo ('multi' quando 2+ formas).
CREATE TABLE IF NOT EXISTS sale_payments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  sale_id    INT NOT NULL,
  method     VARCHAR(20) NOT NULL,      -- dinheiro|debito|credito|pix|outro
  amount     DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_salepay_sale (sale_id),
  CONSTRAINT fk_salepay_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Observações de preparo por item: texto livre + snapshot dos insumos removidos da
-- ficha e da variação escolhida (JSON) — usados na baixa/estorno de estoque.
ALTER TABLE sale_items
  ADD COLUMN notes VARCHAR(255) NULL AFTER subtotal,
  ADD COLUMN removed_json TEXT NULL AFTER notes,
  ADD COLUMN variation_json TEXT NULL AFTER removed_json;

-- Variações de ficha técnica: grupos de escolha por produto (ex.: "Proteína" do
-- Executivo) com opções que apontam para o produto consumido (explode pela ficha).
CREATE TABLE IF NOT EXISTS product_variation_groups (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  product_id INT NOT NULL,
  name       VARCHAR(80) NOT NULL,
  required   TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_pvg_product (product_id),
  CONSTRAINT fk_pvg_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_pvg_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_variation_options (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  group_id    INT NOT NULL,
  name        VARCHAR(80) NOT NULL,
  component_id INT NULL,                          -- produto consumido na baixa (opcional)
  quantity    DECIMAL(12,3) NOT NULL DEFAULT 1,   -- qtd do componente por unidade vendida
  price_delta DECIMAL(12,2) NOT NULL DEFAULT 0,   -- acréscimo/desconto no preço de venda
  sort_order  INT NOT NULL DEFAULT 0,
  KEY idx_pvo_group (group_id),
  CONSTRAINT fk_pvo_group FOREIGN KEY (group_id) REFERENCES product_variation_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_pvo_component FOREIGN KEY (component_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
