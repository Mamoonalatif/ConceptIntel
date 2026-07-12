-- ConceptIntel — Course Creation Module schema
-- Mirrors src/app/types/course.ts. Run this once against a fresh database
-- (see backend/db/README.md for pgAdmin4 steps).

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- Roles, from narrowest to broadest authority:
--   student     — enrolls in courses
--   teacher     — creates/manages their own course offerings ("classes")
--   coordinator — supervises ONE assigned course across all teachers' offerings of it
--   hod         — Head of Department / Program Coordinator: decides whether the
--                 degree/department's catalog should grow (adds new courses)
--   admin       — system-wide superuser
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'coordinator', 'hod', 'admin');

-- Authentication itself lives in a different module, but the role that
-- drives course-creation permissions is persisted here so this module
-- doesn't depend on how that module is implemented.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    role user_role NOT NULL DEFAULT 'student',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The 3 in-scope courses (Applied Physics, Digital Logic Design,
-- Calculus & Analytical Geometry) seed this table. Only HOD/Admin decide
-- whether new courses are added; Coordinators/Admins may edit existing entries
-- (name/code/prerequisite mapping).
CREATE TABLE course_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    prerequisite_id UUID REFERENCES course_catalog(id),
    -- The single Course Coordinator supervising this course across all
    -- teachers' offerings of it. Metadata only for now — enforcing that a
    -- Coordinator can only act on their assigned course is a later module.
    coordinator_id UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per scheduled offering of a catalog course (e.g. "Applied Physics,
-- Fall 2026, Dr. Smith"). Course status is NOT a column — it's derived from
-- the enrollment window (see course_status view below), so it never goes stale.
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID NOT NULL REFERENCES course_catalog(id),
    teacher_id UUID NOT NULL REFERENCES users(id),
    semester VARCHAR(20) NOT NULL,
    description VARCHAR(100) NOT NULL,
    max_students INT,
    course_start_date DATE NOT NULL,
    course_duration_months SMALLINT NOT NULL,
    course_end_date DATE NOT NULL, -- start + duration, computed by the app on write
    enrollment_start_date DATE NOT NULL,
    enrollment_end_date DATE NOT NULL,
    enrollment_code VARCHAR(20) UNIQUE NOT NULL,
    invite_link VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_description_length CHECK (char_length(description) BETWEEN 20 AND 100),
    CONSTRAINT chk_max_students CHECK (max_students IS NULL OR max_students > 0),
    CONSTRAINT chk_course_duration CHECK (course_duration_months > 0),
    CONSTRAINT chk_course_dates CHECK (course_end_date > course_start_date),
    CONSTRAINT chk_enrollment_window CHECK (
        enrollment_end_date > enrollment_start_date
        AND enrollment_end_date <= course_end_date
    )
);

CREATE INDEX idx_courses_teacher ON courses(teacher_id);
CREATE INDEX idx_courses_catalog ON courses(catalog_id);

-- Live status derived from today's date vs. the enrollment window:
--   draft  -> before enrollment_start_date
--   open   -> between enrollment_start_date and enrollment_end_date
--   closed -> after enrollment_end_date
CREATE VIEW course_status AS
SELECT
    id AS course_id,
    CASE
        WHEN CURRENT_DATE < enrollment_start_date THEN 'draft'
        WHEN CURRENT_DATE <= enrollment_end_date THEN 'open'
        ELSE 'closed'
    END AS status
FROM courses;

-- Students join a course using its enrollment_code (Google-Classroom-style).
CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES users(id),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (course_id, student_id)
);

-- Seed the 3 courses in the FYP scope (Scope Document §2).
INSERT INTO course_catalog (id, name, code, prerequisite_id) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Applied Physics', 'PHY101', NULL),
    ('33333333-3333-3333-3333-333333333333', 'Calculus & Analytical Geometry', 'MATH101', NULL);

INSERT INTO course_catalog (id, name, code, prerequisite_id) VALUES
    ('22222222-2222-2222-2222-222222222222', 'Digital Logic Design', 'PHY102', '11111111-1111-1111-1111-111111111111');
