-- ============================================================================
-- Migration : suivi du poids corporel (20/11/2026)
--
-- 1. Table qogym_body_weights : une pesée par utilisateur et par jour.
--    La contrainte UNIQUE (user_id, day) permet l'upsert côté API
--    (saisir à nouveau un jour = corriger la valeur).
-- 2. Colonne qogym_users.target_weight_kg : objectif de poids (optionnel).
--
-- À exécuter AVANT de déployer qogym-api/weight.php et le front.
-- (Si elle n'est pas jouée, l'API répond proprement "migration_needed"
-- et la carte Poids du profil affiche un message au lieu de planter.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS qogym_body_weights (
  id          INT           NOT NULL AUTO_INCREMENT,
  user_id     INT           NOT NULL,
  day         DATE          NOT NULL,
  weight_kg   DECIMAL(5,2)  NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_body_weight_user_day (user_id, day),
  KEY idx_body_weight_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE qogym_users
  ADD COLUMN target_weight_kg DECIMAL(5,2) NULL DEFAULT NULL;

-- Optionnel : suppression en cascade des pesées quand un utilisateur est
-- supprimé. Si cette requête échoue (type de qogym_users.id différent, ex.
-- INT UNSIGNED), adapte le type de user_id ci-dessus ou ignore-la : l'appli
-- fonctionne sans.
ALTER TABLE qogym_body_weights
  ADD CONSTRAINT fk_body_weight_user
  FOREIGN KEY (user_id) REFERENCES qogym_users(id) ON DELETE CASCADE;
