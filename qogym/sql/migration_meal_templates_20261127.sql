-- ============================================================================
-- Migration : repas types (repas prédéfinis réutilisables)
-- (27/11/2026)
--
-- Un "repas type" est une liste d'aliments avec leurs quantités (ex.
-- « Pâtes poulet » = 200 g de pâtes + 400 g de poulet). En un clic, il ajoute
-- tous ses aliments à une journée, dans un nouveau repas ou un repas existant.
-- Les aliments ajoutés sont des entrées normales : on peut ensuite les
-- modifier / supprimer comme d'habitude.
--
-- 1. Deux NOUVELLES tables.
-- 2. Une colonne FACULTATIVE ajoutée à qogym_food_meals : `name`, le nom du
--    repas type d'origine (affiché « Repas 2 · Pâtes poulet »). NULL pour
--    les repas existants et ceux créés à la main : rien ne change pour eux.
--    Les anciennes versions de l'appli ignorent ce champ.
--
-- Sans cette migration, la page Nutrition marche comme avant ; seules les
-- actions "repas types" répondent "migration_needed".
-- À jouer une seule fois (l'ALTER TABLE échoue si la colonne existe déjà).
-- ============================================================================

CREATE TABLE IF NOT EXISTS qogym_meal_templates (
  id          INT           NOT NULL AUTO_INCREMENT,
  user_id     INT           NOT NULL,
  name        VARCHAR(80)   NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meal_template_name (user_id, name),
  CONSTRAINT fk_meal_templates_user
    FOREIGN KEY (user_id) REFERENCES qogym_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Aliments d'un repas type. Les valeurs nutritionnelles sont copiées (comme
-- pour qogym_food_entries) : si l'aliment est encore dans la bibliothèque
-- (food_item_id), ce sont ses valeurs ACTUELLES qui sont utilisées à l'ajout ;
-- sinon (aliment supprimé ou saisie rapide) on utilise la copie.
CREATE TABLE IF NOT EXISTS qogym_meal_template_items (
  id                INT            NOT NULL AUTO_INCREMENT,
  template_id       INT            NOT NULL,
  position          INT            NOT NULL DEFAULT 0,
  food_item_id      INT            NULL DEFAULT NULL,
  name              VARCHAR(120)   NOT NULL,
  unit_label        VARCHAR(40)    NULL DEFAULT NULL,
  grams_per_unit    DECIMAL(8,2)   NULL DEFAULT NULL,
  quantity_g        DECIMAL(8,2)   NOT NULL,
  quantity_units    DECIMAL(8,2)   NULL DEFAULT NULL,
  kcal_per_100g     DECIMAL(7,2)   NOT NULL DEFAULT 0,
  protein_per_100g  DECIMAL(6,2)   NOT NULL DEFAULT 0,
  carbs_per_100g    DECIMAL(6,2)   NOT NULL DEFAULT 0,
  fat_per_100g      DECIMAL(6,2)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_meal_template_items_template (template_id, position),
  CONSTRAINT fk_meal_template_items_template
    FOREIGN KEY (template_id) REFERENCES qogym_meal_templates (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE qogym_food_meals
  ADD COLUMN name VARCHAR(80) NULL DEFAULT NULL;
