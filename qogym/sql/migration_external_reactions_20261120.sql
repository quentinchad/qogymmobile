-- ============================================================================
-- Migration : likes et commentaires sur les séances externes (Recomp)
-- (20/11/2026)
--
-- Deux NOUVELLES tables, aucune table existante n'est modifiée.
-- Les séances Recomp ne sont pas copiées chez QoGym : on ne stocke que les
-- réactions des utilisateurs QoGym, repérées par l'id externe "recomp:…".
--
-- owner_id = id QoGym du propriétaire de la séance (pour les notifications
-- et une éventuelle suppression de compte).
--
-- Sans cette migration, le fil fusionné marche quand même (compteurs à 0) ;
-- seuls like / commentaire sur une séance Recomp répondent "migration_needed".
-- ============================================================================

CREATE TABLE IF NOT EXISTS qogym_external_likes (
  id           INT          NOT NULL AUTO_INCREMENT,
  source       VARCHAR(20)  NOT NULL,
  external_id  VARCHAR(80)  NOT NULL,
  owner_id     INT          NOT NULL,
  user_id      INT          NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_external_like (external_id, user_id),
  KEY idx_external_likes_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS qogym_external_comments (
  id                 INT          NOT NULL AUTO_INCREMENT,
  source             VARCHAR(20)  NOT NULL,
  external_id        VARCHAR(80)  NOT NULL,
  owner_id           INT          NOT NULL,
  user_id            INT          NOT NULL,
  comment            TEXT         NOT NULL,
  parent_comment_id  INT          NULL DEFAULT NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_external_comments_workout (external_id, created_at),
  KEY idx_external_comments_parent (parent_comment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
