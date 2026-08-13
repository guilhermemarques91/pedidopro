-- Registra QUAL recorte o usuario pediu ao abrir a folha de contagem.
--
-- Motivacao concreta: a folha "Descartaveis" nasceu com 202 linhas (o catalogo
-- comprável inteiro) porque o filtro da criacao so oferecia Categoria, que esta
-- preenchida em 1 de 105 produtos. A sub-classe, preenchida em 105 de 105, e o
-- recorte que corresponde a prateleira (EMBALAGENS, LIMPEZA, NAO ALCOOLICAS...).
--
-- Estas colunas sao o registro do PEDIDO, nao um vinculo vivo: por isso nao levam
-- chave estrangeira. Se uma sub-classe for apagada depois, o historico da folha
-- deve continuar dizendo o que foi contado — um ON DELETE SET NULL reescreveria
-- esse passado em silencio.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e so descarta
-- comentarios de LINHA INTEIRA — nada de comentario depois do ponto e virgula.
SET NAMES utf8mb4;

ALTER TABLE stock_counts
  ADD COLUMN scope_sub_classe_id INT NULL AFTER coverage_days,
  ADD COLUMN scope_type_id       INT NULL AFTER scope_sub_classe_id,
  ADD COLUMN scope_category_id   INT NULL AFTER scope_type_id,
  ADD COLUMN scope_tipo          VARCHAR(30) NULL AFTER scope_category_id;

CREATE INDEX idx_stock_counts_scope ON stock_counts (org_id, scope_sub_classe_id);
