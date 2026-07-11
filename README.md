# ConceptIntel — Implementation Phase 1

AI-powered educational intelligence platform (FYP). Phase 1 delivers the **Course Generation Module** with a full React frontend and FastAPI backend scaffold.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, Vite, Tailwind CSS, Radix UI |
| Backend | FastAPI (Python) |
| Database | PostgreSQL / Supabase *(planned)* |
| Graph DB | Neo4j *(planned)* |
| AI | OpenAI GPT models *(integration point ready)* |

## Project Structure

```
├── src/                    # React frontend
│   └── app/
│       ├── components/     # UI + course creation wizard
│       ├── config/         # Navigation config
│       ├── layouts/        # Role-based dashboard layouts
│       ├── pages/          # Route pages
│       ├── services/       # Course API / localStorage
│       └── types/          # TypeScript types
├── backend/                # FastAPI backend
│   ├── main.py
│   └── app/
│       ├── routers/        # API routes
│       ├── schemas/        # Pydantic models
│       └── services/       # AI course generator
└── package.json
```

## Getting Started

### Frontend

```bash
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
| **Student** | `/student/*` routes — approved AI content only |
| **Teacher** | `/teacher/*` routes + AI supervision + course generation |
| **Coordinator** | `/coordinator/*` routes — curriculum oversight + cross-teacher AI review |
| **Admin** | `/admin/*` routes + admin-only API |

### Auth API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/register` | POST | Public | Register a new user |
| `/api/auth/login` | POST | Public | Login and receive JWT |
| `/api/auth/me` | GET | Bearer token | Get current user profile |
| `/api/auth/logout` | POST | Bearer token | Logout (client clears token) |
| `/api/auth/admin-only` | GET | Admin only | Role test endpoint |
| `/api/courses/generate-structure` | POST | Teacher/Coordinator/Admin | Protected course AI endpoint |

## Teacher Supervision Module

Teachers and coordinators can review, edit, approve, reject, and regenerate AI-generated educational content. Students only see **approved** content.

### Features

- Display AI-generated content awaiting review (quizzes, assignments, flashcards, study guides, concept maps)
- Edit AI-generated materials with revision history
- Approve or reject content with comments
- Regenerate AI outputs with custom instructions
- Approval history and audit logs for all supervision actions
- Coordinator role can review content across all teachers

### Supervision API Endpoints

| Endpoint | Method | Access | Description |
|----------|--------|--------|-------------|
| `/api/supervision/stats` | GET | Teacher/Coordinator/Admin | Pending/approved/rejected counts |
| `/api/supervision/content` | GET | Teacher/Coordinator/Admin | List AI content (filter by status/type) |
| `/api/supervision/content/{id}` | GET | Teacher/Coordinator/Admin | Content detail + revision + approval history |
| `/api/supervision/content/{id}` | PUT | Teacher/Coordinator/Admin | Edit content (creates revision) |
| `/api/supervision/content/{id}/approve` | POST | Teacher/Coordinator/Admin | Approve for student access |
| `/api/supervision/content/{id}/reject` | POST | Teacher/Coordinator/Admin | Reject with reason |
| `/api/supervision/content/{id}/regenerate` | POST | Teacher/Coordinator/Admin | Regenerate AI output |
| `/api/supervision/audit-logs` | GET | Teacher/Coordinator/Admin | Teacher/coordinator action audit trail |
| `/api/supervision/student/content` | GET | Student | **Approved content only** |
| `/api/supervision/seed` | POST | Teacher/Coordinator/Admin | Load demo AI content |

### UI Routes

| Role | Supervision queue | Content review |
|------|-------------------|----------------|
| Teacher | `/teacher/supervision` | `/teacher/supervision/:contentId` |
| Coordinator | `/coordinator/supervision` | `/coordinator/supervision/:contentId` |

### Demo workflow

1. Register as **Teacher** → go to **AI Supervision** → click **Load Demo Content**
2. Open any pending item → edit, approve, reject, or regenerate
3. Register as **Student** → **My Learning** → only approved materials are visible
4. Register as **Coordinator** → **AI Supervision** → review content from all teachers

### Run all tests (auth + supervision)

```powershell
cd backend
.\venv\Scripts\Activate.ps1
python -m pytest tests/ -v
```

Expected: **26 passed**

**Terminal 1 — Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
npm install
npm run dev
```

### Run authentication tests

```bash
cd backend
venv\Scripts\activate
pytest tests/ -v
```

Copy `backend/.env.example` to `backend/.env` and set a strong `JWT_SECRET_KEY` for production.

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

Courses are persisted in `localStorage` (frontend) until Supabase/PostgreSQL is connected.

## Navigation

Role-based sidebar navigation is available for Teacher, Student, Coordinator, and Admin portals. Theme toggle (dark/light) is included in the sidebar.

## Build

```bash
npm run build
```

## License

FYP Project — University use.
