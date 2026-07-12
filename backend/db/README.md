# Course Module — Postgres Setup (pgAdmin4)

This directory holds the Postgres schema for the course-creation module. The
backend (FastAPI) now reads/writes this database directly — there is no
localStorage fallback for course data anymore.

## 1. Create the database (if you haven't already)

1. Open pgAdmin4 → expand **Servers** → your local Postgres server.
2. Right-click **Databases** → **Create** → **Database...** → name it
   `conceptintel` → **Save**.

## 2. Run the schema + seed data

In the Query Tool for the `conceptintel` database, run these **in order**
(use `File → Open...` to load each file's actual contents — don't type the
filename itself into the query box):

1. `backend/db/schema.sql` — creates `users`, `course_catalog`, `courses`,
   `enrollments`, the `course_status` view, and seeds the 3 in-scope courses.
2. `backend/db/seed_users.sql` — seeds 4 mock users (teacher/student/
   coordinator/admin) with fixed UUIDs. The frontend and backend both use
   these same fixed IDs until the real auth module is wired up.

Confirm it worked: refresh `conceptintel` → Schemas → public → Tables — you
should see 4 tables plus the `course_status` view, with `course_catalog`
already containing Applied Physics / Digital Logic Design / Calculus &
Analytical Geometry, and `users` containing 4 rows.

## 3. Finding/resetting your Postgres password

pgAdmin4 is just the GUI client — the actual password belongs to the
Postgres **server**, set when you installed it. If you don't remember it and
you're already connected in pgAdmin4 (which you must be, since you ran the
schema), you can reset it right now:

1. Open the Query Tool against any database (e.g. `postgres` or
   `conceptintel`).
2. Run:
   ```sql
   ALTER USER postgres WITH PASSWORD 'choose_a_new_password';
   ```
3. Use that password in `backend/.env` (step 4).

## 4. Point the backend at your database

1. Copy `backend/.env.example` to `backend/.env`.
2. Edit `DATABASE_URL` with your actual username/password:
   ```
   DATABASE_URL=postgresql://postgres:choose_a_new_password@localhost:5432/conceptintel
   ```
3. Install the new Python dependencies and run the server:
   ```
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload --port 8000
   ```
4. Check it's talking to the database: open
   `http://localhost:8000/api/catalog` in a browser — you should get back
   JSON for the 3 seeded courses.

The frontend expects the API at `http://localhost:8000/api` by default
(override with `VITE_API_URL` in a `.env` file at the project root if you run
the backend elsewhere).
