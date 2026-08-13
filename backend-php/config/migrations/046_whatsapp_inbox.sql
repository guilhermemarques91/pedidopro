-- Caixa de entrada do WhatsApp dentro do ERP (janela flutuante da barra superior).
--
-- Por que espelhar num banco nosso em vez de consultar a Evolution a cada clique:
--  1. O painel pergunta "tem novidade?" a cada poucos segundos. Isso contra a
--     Evolution seria uma tempestade de chamadas num serviço que também sustenta
--     o marmitex e o outbox.
--  2. A Evolution devolve o chat com pushName/unreadCount/profilePicUrl SEMPRE
--     nulos (verificado na instância real). Quem sabe o que é "não lido" e qual é
--     o nome do contato tem que ser a gente.
--  3. Webhook perdido não pode virar mensagem perdida. Tendo espelho local, a
--     varredura periódica reconcilia; sem ele, não haveria com o que comparar.
--
-- Identidade (a parte traiçoeira): o WhatsApp endereça o mesmo contato ora pelo
-- número (`<num>@s.whatsapp.net`), ora por um identificador de privacidade
-- (`<id>@lid`) — na instância real, 21 de 26 chats chegam como @lid. Quando é LID,
-- o número real vem em `key.remoteJidAlt`. Guardamos o número como chave canônica
-- (`remote_jid`) e o LID como apelido (`lid_jid`), os dois com índice único: sem
-- isso o mesmo contato viraria duas conversas, cada uma com metade do histórico.
-- Grupo (`@g.us`) não tem LID e é canônico por si.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS wa_chats (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org_id          INT NOT NULL,
  remote_jid      VARCHAR(80) NOT NULL,
  lid_jid         VARCHAR(80) NULL,
  name            VARCHAR(150) NULL,
  is_group        TINYINT(1) NOT NULL DEFAULT 0,
  profile_pic_url VARCHAR(500) NULL,
  last_message_at TIMESTAMP NULL,
  last_preview    VARCHAR(255) NULL,
  last_from_me    TINYINT(1) NOT NULL DEFAULT 0,
  unread_count    INT NOT NULL DEFAULT 0,
  pinned          TINYINT(1) NOT NULL DEFAULT 0,
  archived        TINYINT(1) NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wa_chat (org_id, remote_jid),
  UNIQUE KEY uq_wa_chat_lid (org_id, lid_jid),
  KEY idx_wa_chat_recent (org_id, last_message_at),
  CONSTRAINT fk_wa_chat_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wa_messages (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  org_id       INT NOT NULL,
  chat_id      INT NOT NULL,
  message_key  VARCHAR(160) NOT NULL,
  from_me      TINYINT(1) NOT NULL DEFAULT 0,
  sender_jid   VARCHAR(80) NULL,
  sender_name  VARCHAR(150) NULL,
  type         VARCHAR(20) NOT NULL DEFAULT 'text',
  body         TEXT NULL,
  message_ts   TIMESTAMP NULL,
  payload      JSON NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_wa_inbox_msg (message_key),
  KEY idx_wa_inbox_thread (chat_id, id),
  KEY idx_wa_inbox_delta (org_id, id),
  CONSTRAINT fk_wa_inbox_chat FOREIGN KEY (chat_id) REFERENCES wa_chats(id) ON DELETE CASCADE,
  CONSTRAINT fk_wa_inbox_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
