-- PedidoPro ERP — Etapa 0: trilha de auditoria (audit_log).
-- Registra as MUTAÇÕES autenticadas (POST/PUT/PATCH/DELETE): quem, o quê, quando,
-- em qual entidade e com qual resultado. Sem FK para o log sobreviver à exclusão
-- do usuário (guarda snapshot do username). Preenchido automaticamente pelo Router.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  org_id     INT NOT NULL DEFAULT 1,
  user_id    INT NULL,
  username   VARCHAR(80) NULL,            -- snapshot (sobrevive à exclusão do usuário)
  method     VARCHAR(10) NOT NULL,        -- POST | PUT | PATCH | DELETE
  path       VARCHAR(255) NOT NULL,       -- rota da API (sem /api)
  entity     VARCHAR(60) NULL,            -- 1º segmento da rota (ex.: suppliers)
  entity_id  VARCHAR(60) NULL,            -- id do recurso, quando houver
  status     INT NULL,                    -- código HTTP da resposta
  ip         VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_org_created (org_id, created_at),
  KEY idx_audit_user (user_id),
  KEY idx_audit_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
