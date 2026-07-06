-- Personalização do sistema por organização: nome exibido, slogan, logo
-- (data URL base64, tamanho limitado na aplicação) e cor primária (#hex).
SET NAMES utf8mb4;
ALTER TABLE organizations
  ADD COLUMN brand_name    VARCHAR(120) NULL,
  ADD COLUMN tagline       VARCHAR(200) NULL,
  ADD COLUMN logo          MEDIUMTEXT NULL,
  ADD COLUMN primary_color VARCHAR(9) NULL;
