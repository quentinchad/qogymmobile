-- ============================================================================
-- BASE DE TEST LOCALE UNIQUEMENT (MariaDB jetable sur 127.0.0.1:3399).
-- Ce script SUPPRIME et recrée la base qogym_test. Ne jamais le lancer
-- sur le serveur de prod.
-- ============================================================================
DROP DATABASE IF EXISTS qogym_test; CREATE DATABASE qogym_test CHARACTER SET utf8mb4; USE qogym_test;
CREATE TABLE qogym_users (id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(190), username VARCHAR(50), password_hash VARCHAR(255), is_admin TINYINT DEFAULT 0, email_verified TINYINT DEFAULT 1, verification_token VARCHAR(255) NULL, verification_expires_at DATETIME NULL, default_workout_privacy VARCHAR(10) DEFAULT 'public', pdp VARCHAR(255) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE qogym_auth_tokens (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, token VARCHAR(255), expires_at DATETIME, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE qogym_friendships (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, friend_id INT, status VARCHAR(10), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE qogym_session_types (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50));
CREATE TABLE qogym_workout_sessions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, name VARCHAR(100), image_url VARCHAR(255) NULL, session_type_id INT, is_qojim_session TINYINT DEFAULT 0, is_archived TINYINT DEFAULT 0);
CREATE TABLE qogym_exercises (id INT AUTO_INCREMENT PRIMARY KEY, workout_session_id INT, name VARCHAR(100), sets INT, reps_min INT, reps_max INT, rest_time INT, exercise_order INT, superset_group INT NULL, is_workout_custom TINYINT DEFAULT 0, removed_from_template TINYINT DEFAULT 0);
CREATE TABLE qogym_completed_workouts (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, workout_session_id INT, started_at DATETIME, completed_at DATETIME NULL, notes TEXT, exercise_order_snapshot TEXT NULL);
CREATE TABLE qogym_completed_sets (id INT AUTO_INCREMENT PRIMARY KEY, completed_workout_id INT, exercise_id INT, set_number INT, weight DECIMAL(6,2) NULL, reps INT, completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(completed_workout_id, exercise_id, set_number));
CREATE TABLE qogym_workout_likes (id INT AUTO_INCREMENT PRIMARY KEY, completed_workout_id INT, user_id INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE qogym_workout_comments (id INT AUTO_INCREMENT PRIMARY KEY, completed_workout_id INT, user_id INT, comment TEXT, parent_comment_id INT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NULL);
CREATE TABLE qogym_workout_participants (id INT AUTO_INCREMENT PRIMARY KEY, completed_workout_id INT, user_id INT);
INSERT INTO qogym_users (id,email,username,default_workout_privacy,pdp) VALUES (1,'a@test.local','alice','public','a.jpg'),(2,'b@test.local','bob','public',NULL),(3,'c@test.local','carol','private',NULL),(4,'d@test.local','dave','public',NULL);
INSERT INTO qogym_auth_tokens (user_id,token,expires_at) VALUES (1,'tokA','2099-01-01'),(2,'tokB','2099-01-01'),(3,'tokC','2099-01-01');
INSERT INTO qogym_friendships (user_id,friend_id,status) VALUES (1,2,'accepted'),(3,1,'accepted'),(4,2,'pending');
INSERT INTO qogym_session_types VALUES (1,'Push');
INSERT INTO qogym_workout_sessions (id,user_id,name,image_url,session_type_id) VALUES (1,1,'Pecs A','pecs.jpg',1),(2,2,'Dos B',NULL,1),(3,3,'Jambes C',NULL,1),(4,4,'Full D',NULL,1);
INSERT INTO qogym_exercises (id,workout_session_id,name,sets,reps_min,reps_max,rest_time,exercise_order) VALUES (1,1,'Développé couché',3,8,12,90,0),(2,2,'Rowing',3,8,12,90,0),(3,3,'Squat',3,8,12,90,0);
INSERT INTO qogym_completed_workouts (id,user_id,workout_session_id,started_at,completed_at,notes) VALUES (1,1,1,'2026-11-18 09:00:00','2026-11-18 10:00:00',''),(2,2,2,'2026-11-19 09:00:00','2026-11-19 10:00:00',''),(3,3,3,'2026-11-17 09:00:00','2026-11-17 10:00:00',''),(4,4,4,'2026-11-16 09:00:00','2026-11-16 10:00:00','');
INSERT INTO qogym_completed_sets (completed_workout_id,exercise_id,set_number,weight,reps) VALUES (1,1,1,80,10),(2,2,1,60,10),(3,3,1,100,5);
