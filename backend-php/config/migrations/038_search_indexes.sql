-- Indices de apoio a busca global (Ctrl+K).
--
-- A busca casa por PREFIXO (`termo%`) justamente para poder usar indice; o
-- fallback por trecho no meio (`%termo%`) continua existindo no SQL, mas so e
-- alcancado quando o prefixo nao traz nada, e no volume atual (centenas de
-- linhas) custa microssegundos.
--
-- Sem isso, toda busca por nome era varredura de tabela: funciona hoje, mas nao
-- e o que se quer deixar plantado num cadastro que so cresce.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e so descarta
-- comentarios de LINHA INTEIRA — nada de comentario depois do ponto e virgula.
SET NAMES utf8mb4;

CREATE INDEX idx_products_name ON products (name);

CREATE INDEX idx_suppliers_name ON suppliers (name);

CREATE INDEX idx_items_name ON items (name);

CREATE INDEX idx_marmitex_companies_name ON marmitex_companies (name);

-- Delivery: o operador procura por nome do cliente ou pelo localizador do pedido.
CREATE INDEX idx_delivery_orders_customer_name ON delivery_orders (customer_name);

CREATE INDEX idx_delivery_orders_locator ON delivery_orders (locator);
