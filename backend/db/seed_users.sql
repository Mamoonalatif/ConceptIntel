-- Mock users until the auth module is wired up. Fixed, well-known UUIDs so
-- the frontend (src/app/config/mockUsers.ts) and backend agree on who
-- "the current teacher/student" is without a real login.
-- Safe to re-run: ON CONFLICT DO NOTHING skips rows that already exist.

INSERT INTO users (id, name, email, role) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Dr. Smith', 'teacher@conceptintel.edu', 'teacher'),
    ('00000000-0000-0000-0000-000000000002', 'Student One', 'student@conceptintel.edu', 'student'),
    ('00000000-0000-0000-0000-000000000003', 'Course Coordinator', 'coordinator@conceptintel.edu', 'coordinator'),
    ('00000000-0000-0000-0000-000000000004', 'System Admin', 'admin@conceptintel.edu', 'admin'),
    ('00000000-0000-0000-0000-000000000005', 'Head of Department', 'hod@conceptintel.edu', 'hod')
ON CONFLICT (id) DO NOTHING;

-- Assign the mock Coordinator as supervisor of all 3 seeded courses for now
-- (in a real rollout each course would get its own coordinator).
UPDATE course_catalog
SET coordinator_id = '00000000-0000-0000-0000-000000000003'
WHERE coordinator_id IS NULL;
