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

### Backend (optional — enables AI structure API)

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
