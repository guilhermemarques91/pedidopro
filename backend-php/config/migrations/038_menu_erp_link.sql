-- Vínculo do cardápio com o ERP para baixa de estoque — agora também nos COMPLEMENTOS.
--
-- O prato principal (executivo, feijoada) já apontava para um produto do ERP via
-- menu_items.erp_product_id. Mas o que de fato varia o consumo é o complemento
-- escolhido (proteína, acompanhamento): sem vínculo, a proteína do pedido nunca
-- saía do estoque. Aqui menu_options ganha o mesmo de-para.
--
-- erp_qty = quanto do produto vinculado uma unidade consome. Existe porque o
-- complemento costuma apontar direto para a MATÉRIA-PRIMA (ex.: "Frango grelhado"
-- → produto "Filé de frango", 0,15 kg por porção). Quando o vínculo é com um
-- produto que tem ficha técnica, deixe 1 — a explosão da ficha faz o resto.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

ALTER TABLE menu_options
  ADD COLUMN erp_product_id INT NULL AFTER price,
  ADD COLUMN erp_qty DECIMAL(12,4) NOT NULL DEFAULT 1 AFTER erp_product_id;

ALTER TABLE menu_items
  ADD COLUMN erp_qty DECIMAL(12,4) NOT NULL DEFAULT 1 AFTER erp_product_id;
