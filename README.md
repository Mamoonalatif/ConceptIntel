# ConceptIntel — Implementation Phase 1

AI-powered educational intelligence platform (FYP). Phase 1 delivers the **Course Generation Module** with a full React frontend and FastAPI backend scaffold.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, Vite, Tailwind CSS, Radix UI |
| Backend | FastAPI (Python) |
| Database | PostgreSQL |
| Graph DB | Neo4j *(planned)* |
| AI | OpenAI GPT models *(integration point ready)* |

## Project Structure

```
├── frontend/               # React frontend
│   ├── src/
│   │   └── app/
│   │       ├── components/     # UI + course creation wizard
│   │       ├── config/         # Navigation config
│   │       ├── layouts/        # Role-based dashboard layouts
│   │       ├── pages/          # Route pages
│   │       ├── services/       # Course API / localStorage
│   │       └── types/          # TypeScript types
│   ├── package.json
│   └── vite.config.ts
├── backend/                # FastAPI backend
│   ├── main.py
│   └── app/
│       ├── routers/        # API routes
│       ├── schemas/        # Pydantic models
│       └── services/       # AI course generator
├── docs/                   # Documentation
│   ├── Guidelines.md
│   └── Scope_Document (3).pdf
└── README.md
```

## Getting Started

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

**Teacher flow:** Login → `/teacher/dashboard` → **Create Course** (6-step wizard)

## Authentication

ConceptIntel includes JWT-based authentication with role-based access control.

### Roles

| Role | Access |
|------|--------|
| **Student** | `/student/*` routes |
| **Teacher** | `/teacher/*` routes + AI course generation API |
| **Admin** | `/admin/*` and `/coordinator/*` routes + admin-only API |

### Auth API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/register` | POST | Public | Register a new user |
| `/api/auth/login` | POST | Public | Login and receive JWT |
| `/api/auth/me` | GET | Bearer token | Get current user profile |
| `/api/auth/logout` | POST | Bearer token | Logout (client clears token) |
| `/api/auth/admin-only` | GET | Admin only | Role test endpoint |
| `/api/courses/generate-structure` | POST | Teacher/Admin | Protected course AI endpoint |

### Run backend + frontend together

**Terminal 1 — Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
# Ensure PostgreSQL is running and DATABASE_URL is set in .env
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
npm run dev
```

### Run authentication tests

```bash
cd backend
venv\Scripts\activate
pytest tests/ -v
```

Copy `backend/.env.example` to `backend/.env` and configure the following:

```env
JWT_SECRET_KEY=your-strong-secret-key
DATABASE_URL=postgresql://user:password@localhost:5432/conceptintel
```

## PostgreSQL Setup

### Local PostgreSQL Installation

1. Install PostgreSQL 17 from [postgresql.org](https://www.postgresql.org/download/)
2. During installation, set a password for the `postgres` user
3. Use pgAdmin 4 (included with installation) to create the database:
   - Open pgAdmin 4
   - Connect to your PostgreSQL server
   - Right-click on "Databases" → Create → Database
   - Name: `conceptintel`
4. Update `backend/.env` with your connection string:
   ```
   DATABASE_URL=postgresql://postgres:your-password@localhost:5432/conceptintel
   ```

### Cloud PostgreSQL (Alternative)

You can use a cloud PostgreSQL service like Supabase, Railway, or Neon:

1. Create a PostgreSQL database on your chosen platform
2. Get the connection string from the platform
3. Update `backend/.env` with the provided connection string

### Environment Variables

The backend reads the following from `.env`:

- `DATABASE_URL`: Full PostgreSQL connection string (recommended)
- `JWT_SECRET_KEY`: Secret key for JWT token signing

---

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## Course Generation Module

The course creation wizard includes:

1. **Basic Info** — title, subject, semester, description, thumbnail
2. **Outcomes** — prerequisites, CLOs, PLOs
3. **Schedule** — dates, sessions, preferred days
4. **Enrollment** — visibility (draft/open/closed), enrollment code, invite link
5. **AI & Roadmap** — GPT-powered module generation + editable roadmap preview
6. **Review** — validation checklist and publish

Courses are persisted in the PostgreSQL database.

## Navigation

Role-based sidebar navigation is available for Teacher, Student, Coordinator, and Admin portals. Theme toggle (dark/light) is included in the sidebar.

## Build

```bash
cd frontend
npm run build
```

## License

FYP Project — University use.
