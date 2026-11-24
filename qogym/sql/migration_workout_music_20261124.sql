-- ============================================================================
-- Migration : musique d'un entraînement (façon "notes Instagram")
-- (24/11/2026)
--
-- Une NOUVELLE table, aucune table existante n'est modifiée.
-- Le propriétaire d'un entraînement terminé peut lui associer un titre
-- Deezer (facultatif, un seul titre par entraînement). À l'ouverture du
-- détail, l'extrait officiel de 30 s fourni par Deezer est joué en boucle.
--
-- On ne stocke QUE l'id Deezer + titre / artiste / pochette pour l'affichage.
-- Jamais l'URL de l'extrait : elle est signée et expire (~15 min), elle est
-- redemandée à Deezer à chaque lecture (music.php?preview=ID).
--
-- Sans cette migration, le fil et le détail marchent comme avant (pas de
-- musique) ; seul l'ajout d'un son répond "migration_needed".
-- ============================================================================

CREATE TABLE IF NOT EXISTS qogym_workout_music (
  completed_workout_id  INT           NOT NULL,
  provider              VARCHAR(20)   NOT NULL DEFAULT 'deezer',
  track_id              VARCHAR(40)   NOT NULL,
  title                 VARCHAR(255)  NOT NULL,
  artist                VARCHAR(255)  NOT NULL,
  cover_url             VARCHAR(500)  NULL DEFAULT NULL,
  link                  VARCHAR(500)  NULL DEFAULT NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (completed_workout_id),
  CONSTRAINT fk_workout_music_workout
    FOREIGN KEY (completed_workout_id) REFERENCES qogym_completed_workouts (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
