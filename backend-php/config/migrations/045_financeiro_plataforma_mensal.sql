-- Dados de plataforma com granularidade MENSAL.
--
-- O 99Food exporta um relatorio diario, mas o "Relatorio de vendas" do iFood so
-- sai agregado no periodo: uma linha por servico/logistica com o total do mes.
-- Nao da para espalhar isso pelos dias sem inventar numero, entao o mes tem
-- tabela propria e os totais sao mesclados na leitura (ver PlatformTotals).
--
-- Regra da mescla: para cada plataforma e cada metrica, o diario vence quando
-- existe; o mensal cobre o que o diario nao traz. E assim que o iFood soma
-- pedidos/nota do relatorio de qualidade (diario) com o faturamento do
-- relatorio de vendas (mensal) sem contar nada duas vezes.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e so descarta
-- comentarios de LINHA INTEIRA — nada de comentario depois do ponto e virgula.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS fin_platform_monthly (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  org_id        INT NOT NULL DEFAULT 1,
  platform      VARCHAR(16) NOT NULL,
  ref_month     CHAR(7) NOT NULL,
  import_id     INT NULL,
  orders        INT NULL,
  gross_revenue DECIMAL(14,2) NULL,
  delivery_fee  DECIMAL(14,2) NULL,
  commission    DECIMAL(14,2) NULL,
  offers_cost   DECIMAL(14,2) NULL,
  payment_fee   DECIMAL(14,2) NULL,
  net_revenue   DECIMAL(14,2) NULL,
  avg_ticket    DECIMAL(12,2) NULL,
  new_customers INT NULL,
  extra_json    JSON NULL,
  UNIQUE KEY uq_fin_platform_month (org_id, platform, ref_month),
  KEY idx_fin_platform_month_ref (org_id, ref_month),
  CONSTRAINT fk_fin_pmonth_org FOREIGN KEY (org_id) REFERENCES organizations(id),
  CONSTRAINT fk_fin_pmonth_import FOREIGN KEY (import_id) REFERENCES fin_imports(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
