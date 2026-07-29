-- Compras baseadas no estoque: contagem (inventário) + parâmetros de reposição.
--
-- Fluxo: o funcionário abre uma FOLHA DE CONTAGEM (snapshot do saldo do sistema),
-- lança o que contou de verdade, e ao concluir a folha o saldo é corrigido
-- (movimento `adjust` com ref `count:N`). Com o saldo real em mãos, o sistema
-- sugere a quantidade a comprar de cada item e gera uma lista de compras
-- (purchase_requests), que segue o fluxo já existente: alocar fornecedor →
-- gerar pedidos.
--
-- A sugestão é HÍBRIDA (ver App\Services\Replenishment):
--   - se o produto tem max_stock cadastrado, o alvo é ele;
--   - senão, o alvo é o consumo médio diário (saídas dos últimos 30 dias)
--     multiplicado pelos dias de cobertura da folha.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

-- Parâmetros de reposição por produto (todos opcionais — sem eles o cálculo cai
-- no consumo histórico):
--   min_stock = ponto de pedido (abaixo disso o item é crítico)
--   max_stock = alvo de reposição (a compra repõe até aqui)
--   pack_size = múltiplo de compra (caixa/fardo); arredonda a sugestão pra cima
ALTER TABLE products
  ADD COLUMN min_stock DECIMAL(12,3) NULL AFTER sale_price,
  ADD COLUMN max_stock DECIMAL(12,3) NULL AFTER min_stock,
  ADD COLUMN pack_size DECIMAL(12,3) NULL AFTER max_stock;

-- Folha de contagem. status: draft | applied | cancelled.
-- coverage_days = por quantos dias a compra sugerida deve durar.
-- request_id = lista de compras gerada a partir desta contagem.
CREATE TABLE IF NOT EXISTS stock_counts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  title         VARCHAR(200) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'draft',
  coverage_days INT NOT NULL DEFAULT 7,
  notes         TEXT NULL,
  request_id    INT NULL,
  created_by    INT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at    TIMESTAMP NULL,
  applied_by    INT NULL,
  KEY idx_stock_counts_org (org_id, created_at),
  KEY idx_stock_counts_status (status),
  CONSTRAINT fk_stock_counts_user FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_stock_counts_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Linhas da folha.
--   system_qty  = saldo do sistema quando a folha foi aberta (snapshot)
--   counted_qty = o que o funcionário contou (NULL = ainda não contou)
--   order_qty   = quantidade de compra decidida (NULL = usa a sugestão calculada)
CREATE TABLE IF NOT EXISTS stock_count_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  count_id    INT NOT NULL,
  product_id  INT NOT NULL,
  system_qty  DECIMAL(12,3) NOT NULL DEFAULT 0,
  counted_qty DECIMAL(12,3) NULL,
  order_qty   DECIMAL(12,3) NULL,
  unit        VARCHAR(30) NULL,
  UNIQUE KEY uq_count_product (count_id, product_id),
  KEY idx_count_items_count (count_id),
  CONSTRAINT fk_count_items_count FOREIGN KEY (count_id) REFERENCES stock_counts(id) ON DELETE CASCADE,
  CONSTRAINT fk_count_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
