-- Migração: taxa de comissão (%) por canal — usada para estimar margem nos relatórios
-- enquanto não integramos a API Financeira. Rode UMA VEZ (phpMyAdmin).
ALTER TABLE channels ADD COLUMN commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER auto_confirm;
