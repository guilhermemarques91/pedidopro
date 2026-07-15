-- PedidoPro — Mapa de pedidos Delivery + relatório de distância.
-- store_settings: endereço/coordenadas do próprio estabelecimento (linha única, id=1).
-- geocode_cache: cache de geocodificação (Nominatim/OSM) — respeita o limite de uso
-- (~1 req/seg) evitando repetir a mesma consulta.
-- Idempotente via CREATE TABLE IF NOT EXISTS (não dropa: protege dados em produção).
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS store_settings (
  id                INT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  name              VARCHAR(150) NULL,
  street            VARCHAR(180) NULL,
  number            VARCHAR(20) NULL,
  complement        VARCHAR(120) NULL,
  neighborhood      VARCHAR(120) NULL,
  city              VARCHAR(120) NULL,
  state             CHAR(2) NULL,
  postal_code       VARCHAR(12) NULL,
  formatted_address VARCHAR(255) NULL,
  lat               DECIMAL(10,7) NULL,
  lng               DECIMAL(10,7) NULL,
  geocoded_at       TIMESTAMP NULL,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO store_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS geocode_cache (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  query_key    VARCHAR(255) NOT NULL,          -- endereço normalizado (forward) ou "lat,lng" arredondado (reverse)
  kind         ENUM('forward','reverse') NOT NULL DEFAULT 'forward',
  lat          DECIMAL(10,7) NULL,
  lng          DECIMAL(10,7) NULL,
  neighborhood VARCHAR(120) NULL,
  city         VARCHAR(120) NULL,
  state        VARCHAR(60) NULL,
  display_name VARCHAR(255) NULL,
  raw          JSON NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_geocode_cache (query_key, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
