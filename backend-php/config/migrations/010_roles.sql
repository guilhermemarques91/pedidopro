-- PedidoPro ERP — Etapa 0: papéis customizáveis + permissões por usuário
-- Os papéis deixam de ser fixos no código e viram DADOS (tabela roles), para o
-- admin criar papéis novos (caixa, garçom, gerente...) marcando permissões.
-- Cada usuário pode ainda ter um override individual (users.permissions_json):
-- quando preenchido, é o conjunto efetivo; quando NULL, herda do papel.
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  org_id      INT NOT NULL DEFAULT 1,
  `key`       VARCHAR(40) NOT NULL,          -- slug estável (users.role aponta p/ cá)
  label       VARCHAR(80) NOT NULL,          -- nome exibido
  permissions JSON NOT NULL,                 -- lista de permissões (modulo:acao)
  is_system   TINYINT(1) NOT NULL DEFAULT 0, -- papéis embutidos: não excluíveis
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_org_key (org_id, `key`),
  KEY idx_roles_org (org_id),
  CONSTRAINT fk_roles_org FOREIGN KEY (org_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Papéis do sistema (espelham a matriz que estava no código). admin = superusuário.
INSERT INTO roles (org_id, `key`, label, permissions, is_system) VALUES
  (1, 'admin', 'Administrador',
     JSON_ARRAY('compras:read','compras:write','compras:approve','compras:requests','compras:admin',
                'delivery:operate','delivery:admin','marmitex:order','marmitex:admin','users:manage','system:admin'), 1),
  (1, 'buyer', 'Comprador',
     JSON_ARRAY('compras:read','compras:write','compras:requests','delivery:operate'), 1),
  (1, 'approver', 'Aprovador',
     JSON_ARRAY('compras:read','compras:approve','delivery:operate'), 1),
  (1, 'requester', 'Funcionário',
     JSON_ARRAY('compras:read','compras:requests'), 1),
  (1, 'company', 'Empresa (Marmitex)',
     JSON_ARRAY('marmitex:order'), 1)
ON DUPLICATE KEY UPDATE label = VALUES(label), is_system = 1;

-- Override individual: NULL = usa as permissões do papel.
ALTER TABLE users ADD COLUMN permissions_json JSON NULL;
