-- ============================================================================
-- Migration : tokens « partenaire » limités (20/11/2026)
--
-- Ajoute une colonne FACULTATIVE à qogym_auth_tokens :
--   scope = NULL              → token normal (site, appli QoGym) : RIEN NE CHANGE
--   scope = 'partner:recomp'  → token délivré à une appli partenaire, limité
--                               aux amis / fil / profils / confidentialité
--
-- Aucune donnée existante n'est modifiée : tous les tokens actuels ont
-- scope = NULL et continuent de fonctionner exactement comme avant.
--
-- À exécuter AVANT d'envoyer partner_tokens.php / config.php / auth.php.
-- (Si elle n'est pas jouée, les tokens normaux marchent quand même ; seule la
-- connexion partenaire répond "migration_needed".)
-- Si on la rejoue par erreur : MySQL répond "Duplicate column name 'scope'",
-- sans rien casser.
-- ============================================================================

ALTER TABLE qogym_auth_tokens
  ADD COLUMN scope VARCHAR(40) NULL DEFAULT NULL;

ALTER TABLE qogym_auth_tokens
  ADD INDEX idx_auth_tokens_user_scope (user_id, scope);
