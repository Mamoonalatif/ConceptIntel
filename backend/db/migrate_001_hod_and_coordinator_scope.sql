-- Migration for databases that already ran the original schema.sql/seed_users.sql.
-- Adds the 'hod' role and the coordinator_id assignment on course_catalog.
-- Safe to re-run.
--
-- Run each statement individually in pgAdmin4's Query Tool if your Postgres
-- version complains about ALTER TYPE ... ADD VALUE inside a transaction block
-- (older versions require it to run outside one — pgAdmin4's default
-- autocommit-per-statement mode handles this fine for a single script).

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hod';

ALTER TABLE course_catalog
    ADD COLUMN IF NOT EXISTS coordinator_id UUID REFERENCES users(id);

INSERT INTO users (id, name, email, role) VALUES
    ('00000000-0000-0000-0000-000000000005', 'Head of Department', 'hod@conceptintel.edu', 'hod')
ON CONFLICT (id) DO NOTHING;

UPDATE course_catalog
SET coordinator_id = '00000000-0000-0000-0000-000000000003'
WHERE coordinator_id IS NULL;
