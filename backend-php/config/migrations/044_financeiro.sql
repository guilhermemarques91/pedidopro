-- Módulo Financeiro: relatórios e análises sobre planilhas importadas.
--
-- O DRE, o contas a pagar e a ficha técnica continuam sendo lançados no AllFood;
-- os dados de faturamento/comissão vêm das planilhas do 99Food e do iFood. Este
-- módulo NÃO calcula receita/custo a partir das vendas do ERP — ele normaliza os
-- arquivos, classifica por plano de contas e entrega DRE, margens e gráficos.
--
-- Reimportar o mesmo período SUBSTITUI os dados (as chaves UNIQUE abaixo são a
-- rede de segurança; o controller apaga o período antes de inserir).
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

-- Um registro por arquivo processado (rastreabilidade e histórico na tela).
-- source: allfood_dre | allfood_ap | allfood_ficha | 99food_daily
--         | ifood_quality | ifood_settlement
CREATE TABLE IF NOT EXISTS fin_imports (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  source        VARCHAR(32) NOT NULL,
  filename      VARCHAR(255) NOT NULL,
  ref_month     CHAR(7) NULL,
  period_start  DATE NULL,
  period_end    DATE NULL,
  total_rows    INT NOT NULL DEFAULT 0,
  imported_rows INT NOT NULL DEFAULT 0,
  error_rows    INT NOT NULL DEFAULT 0,
  error_log     TEXT NULL,
  created_by    INT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fin_imports_org (org_id, source, ref_month),
  KEY idx_fin_imports_created (org_id, created_at),
  CONSTRAINT fk_fin_imports_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_imports_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Plano de contas, descoberto automaticamente na importação do DRE / contas a pagar.
--   dre_group     = bucket do DRE (pré-preenchido por prefixo, editável na tela)
--   cost_behavior = fixo | variavel | nao_classificado  (alimenta o ponto de equilíbrio)
--   include_in_dre= 0 exclui a conta do "DRE gerencial", sem apagar o dado importado.
--                   Serve para contas de trânsito que o AllFood lança como receita
--                   (ex.: 3.02.04.01 RECEITAS EXTRAS NO RECEBIMENTO DE CREDITOS A
--                   RECEBER = recebimento de cartão/PIX, que duplica a venda).
CREATE TABLE IF NOT EXISTS fin_accounts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL DEFAULT 1,
  code           VARCHAR(64) NOT NULL,
  name           VARCHAR(180) NOT NULL,
  parent_code    VARCHAR(64) NULL,
  level          TINYINT NOT NULL DEFAULT 1,
  dre_group      VARCHAR(24) NULL,
  cost_behavior  VARCHAR(20) NOT NULL DEFAULT 'nao_classificado',
  include_in_dre TINYINT(1) NOT NULL DEFAULT 1,
  auto_group     TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fin_accounts_code (org_id, code),
  KEY idx_fin_accounts_group (org_id, dre_group),
  CONSTRAINT fk_fin_accounts_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Linhas do DRE mensal exportado do AllFood.
--   sign      = (+) | (-) | (=) conforme a coluna A da planilha
--   line_type = account (tem código) | subtotal (LUCRO BRUTO, LUCRO OPERACIONAL...)
--   Subtotais recebem um código sintético (@lucro_bruto) para manter a chave única.
--   pct_gross vem da planilha como fração (0.2995 = 29,95% da venda bruta).
CREATE TABLE IF NOT EXISTS fin_dre_lines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  org_id       INT NOT NULL DEFAULT 1,
  import_id    INT NULL,
  ref_month    CHAR(7) NOT NULL,
  account_code VARCHAR(64) NOT NULL,
  account_name VARCHAR(180) NOT NULL,
  line_type    VARCHAR(12) NOT NULL DEFAULT 'account',
  sign         CHAR(3) NULL,
  level        TINYINT NOT NULL DEFAULT 1,
  amount       DECIMAL(14,2) NOT NULL DEFAULT 0,
  pct_gross    DECIMAL(9,6) NULL,
  sort_order   INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_fin_dre_line (org_id, ref_month, account_code),
  KEY idx_fin_dre_month (org_id, ref_month, sort_order),
  CONSTRAINT fk_fin_dre_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_dre_import FOREIGN KEY (import_id) REFERENCES fin_imports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contas a pagar exportadas do AllFood (lançamento continua lá).
-- ext_id + parcela é a chave do sistema de origem: períodos exportados que se
-- sobrepõem não duplicam.
CREATE TABLE IF NOT EXISTS fin_expenses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org_id          INT NOT NULL DEFAULT 1,
  import_id       INT NULL,
  ext_id          VARCHAR(32) NOT NULL,
  installment     VARCHAR(16) NOT NULL DEFAULT '',
  kind            VARCHAR(16) NULL,
  supplier_name   VARCHAR(180) NULL,
  account_code    VARCHAR(64) NULL,
  account_name    VARCHAR(180) NULL,
  description     VARCHAR(255) NULL,
  competence_date DATE NULL,
  amount_original DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount_paid     DECIMAL(14,2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NULL,
  UNIQUE KEY uq_fin_expense (org_id, ext_id, installment),
  KEY idx_fin_expenses_comp (org_id, competence_date),
  KEY idx_fin_expenses_account (org_id, account_code),
  CONSTRAINT fk_fin_expenses_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_expenses_import FOREIGN KEY (import_id) REFERENCES fin_imports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Métricas diárias por plataforma. O relatório de QUALIDADE do iFood e o
-- EXTRATO financeiro preenchem colunas diferentes da MESMA linha, por isso a
-- gravação é um UPSERT coluna a coluna (COALESCE no ON DUPLICATE KEY UPDATE).
-- extra_json guarda a cauda longa de colunas que não vale a pena normalizar.
CREATE TABLE IF NOT EXISTS fin_platform_daily (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  org_id              INT NOT NULL DEFAULT 1,
  platform            VARCHAR(16) NOT NULL,
  stat_date           DATE NOT NULL,
  import_id           INT NULL,
  orders              INT NULL,
  cancelled_orders    INT NULL,
  gross_revenue       DECIMAL(14,2) NULL,
  avg_ticket          DECIMAL(12,2) NULL,
  offers_cost         DECIMAL(14,2) NULL,
  commission          DECIMAL(14,2) NULL,
  payment_fee         DECIMAL(14,2) NULL,
  platform_rewards    DECIMAL(14,2) NULL,
  delivery_fee        DECIMAL(14,2) NULL,
  net_revenue         DECIMAL(14,2) NULL,
  cancelled_value     DECIMAL(14,2) NULL,
  rating              DECIMAL(4,2) NULL,
  prep_time_avg       DECIMAL(8,2) NULL,
  visitors            INT NULL,
  new_customers       INT NULL,
  returning_customers INT NULL,
  extra_json          JSON NULL,
  UNIQUE KEY uq_fin_platform_day (org_id, platform, stat_date),
  KEY idx_fin_platform_date (org_id, stat_date),
  CONSTRAINT fk_fin_platform_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_platform_import FOREIGN KEY (import_id) REFERENCES fin_imports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ficha técnica: cada importação é um SNAPSHOT datado. Comparar dois snapshots
-- é o que dá a evolução de custo (ex.: arroz de R$ 5,00 para R$ 13,89/kg).
CREATE TABLE IF NOT EXISTS fin_product_costs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  import_id     INT NULL,
  snapshot_date DATE NOT NULL,
  classe        VARCHAR(80) NULL,
  item_name     VARCHAR(180) NOT NULL,
  unit          VARCHAR(20) NULL,
  cost_total    DECIMAL(12,4) NOT NULL DEFAULT 0,
  sale_price    DECIMAL(12,2) NULL,
  UNIQUE KEY uq_fin_prod_cost (org_id, snapshot_date, item_name),
  KEY idx_fin_prod_cost_item (org_id, item_name, snapshot_date),
  CONSTRAINT fk_fin_prod_cost_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_prod_cost_import FOREIGN KEY (import_id) REFERENCES fin_imports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Composição da ficha técnica. O índice por component_key alimenta a curva de
-- evolução de custo por insumo.
--
-- component_key = component_name normalizado (maiúsculas, sem acento, espaços
-- colapsados). É por ele que os snapshots são cruzados: o AllFood não padroniza
-- a grafia entre exportações — o mesmo arroz sai "Arroz Branco" em abril e
-- "ARROZ BRANCO" em maio, e sem a chave normalizada viram dois insumos
-- diferentes, escondendo a variação de custo.
CREATE TABLE IF NOT EXISTS fin_product_components (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  org_id         INT NOT NULL DEFAULT 1,
  import_id      INT NULL,
  snapshot_date  DATE NOT NULL,
  item_name      VARCHAR(180) NOT NULL,
  component_name VARCHAR(180) NOT NULL,
  component_key  VARCHAR(180) NOT NULL,
  unit           VARCHAR(20) NULL,
  quantity       DECIMAL(12,4) NOT NULL DEFAULT 0,
  unit_cost      DECIMAL(12,4) NULL,
  cost_total     DECIMAL(12,4) NULL,
  KEY idx_fin_comp_component (org_id, component_key, snapshot_date),
  KEY idx_fin_comp_item (org_id, snapshot_date, item_name),
  CONSTRAINT fk_fin_comp_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_comp_import FOREIGN KEY (import_id) REFERENCES fin_imports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Configurações do módulo (meta de margem, alíquota, comissão padrão por canal).
CREATE TABLE IF NOT EXISTS fin_settings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  skey       VARCHAR(60) NOT NULL,
  value_json TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fin_settings (org_id, skey),
  CONSTRAINT fk_fin_settings_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
