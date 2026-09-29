import os
import uvicorn
import logging
import threading
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.config import settings
from app.database.connection import engine
from app.database import models

# Import routers
from app.auth.routes import router as auth_router, _prewarm_google_certs_cache
from app.courses.routes import router as courses_router
from app.enrollment.routes import router as enrollment_router
from app.upload.routes import router as upload_router
from app.knowledge_graph.routes import router as graph_router
from app.notifications.routes import router as notifications_router
from app.announcements.routes import router as announcements_router
from app.assignments.routes import router as assignments_router
from app.programs.routes import router as programs_router
from app.materials.routes import router as materials_router
from app.meetings.routes import router as meetings_router
from app.stream.routes import router as stream_router
from app.students.routes import router as students_router
from app.notification_preferences.routes import router as notification_preferences_router
from app.assistant.routes import router as assistant_router
from app.calendar.routes import router as calendar_router
from app.contact.routes import router as contact_router
from app.comments.routes import router as comments_router
from app.analytics.routes import router as analytics_router
from app.content_processing.routes import router as content_processing_router
from app.schedule.routes import router as schedule_router
from app.mastery.routes import router as mastery_router
from app.content_generation.routes import router as content_generation_router
from app.gamification.routes import router as gamification_router, catalog_router as gamification_catalog_router
from app.gamification.game_routes import router as games_router
from app.study.routes import router as study_router
from app.question_bank.routes import router as question_bank_router
from app.exams.routes import router as exams_router
from app.practice.routes import router as practice_router
from app.live.routes import router as live_router
from app.adaptive_engine.routes import router as adaptive_engine_router
from app.outcomes.routes import router as outcomes_router

logger = logging.getLogger("conceptintel")

# Sentry - error/crash monitoring. No-op if SENTRY_DSN isn't set (same pattern as
# every other optional integration in this codebase).
if settings.SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.2, send_default_pii=False)
    logger.info("Sentry error monitoring enabled.")
else:
    logger.info("SENTRY_DSN not set - Sentry error monitoring disabled.")

if settings.JWT_SECRET_WAS_GENERATED:
    logger.error(
        "JWT_SECRET is not set - a random secret was generated for this process "
        "only. Every existing login session will be invalidated the next time this "
        "process restarts (deploy, crash, reload), forcing everyone to sign in "
        "again. Set a real JWT_SECRET in production so sessions survive restarts."
    )

if not (settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY and settings.AWS_S3_BUCKET) \
        and not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
    logger.warning(
        "No S3 or Supabase storage configured - uploaded files (course materials, "
        "assignment attachments/submissions) will be written to local disk. On "
        "Render's free tier this disk is ephemeral and is wiped on every restart "
        "or redeploy. Set SUPABASE_URL+SUPABASE_KEY (or AWS_*) before going live."
    )

# Automatically create PostgreSQL tables on startup
# Wrapped in try-except so app can still boot even if DB is temporarily unavailable
try:
    # ContentChunk.embedding is a pgvector column - the `vector` type must exist in
    # this Postgres database before create_all() can create that table. Supabase
    # ships the extension but it must be enabled per-project; this makes that
    # explicit/automatic rather than requiring a separate manual dashboard step.
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    models.Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified successfully.")
except Exception as e:
    logger.error(f"WARNING: Could not create database tables: {e}")
    logger.error("Ensure PostgreSQL is running and DATABASE_URL in .env is correct.")


def seed_course_catalog():
    """Idempotently seed the predefined course catalog (only 3 offerings are ever
    selectable when creating a course instance). Only inserts if the table is empty.

    PF -> OOP -> (independent) Calculus: Programming Fundamentals is the
    prerequisite for Object-Oriented Programming (you cannot design classes
    before you can write a function), and Calculus stands on its own as the
    third subject - matching a first-year CS semester line-up. A full demo
    concept graph + CLO/PLO/GA structure for these three lives in
    scripts/seed_pf_oop_calculus_demo.py, run separately since it needs a live
    Neo4j connection this startup-time seed does not require."""
    from app.database.connection import SessionLocal
    from app.database.models import CourseCatalog

    db = SessionLocal()
    try:
        if db.query(CourseCatalog).count() > 0:
            return

        pf = CourseCatalog(name="Programming Fundamentals", code="PF101")
        db.add(pf)
        db.flush()

        # Object-Oriented Programming requires Programming Fundamentals as a prerequisite.
        oop = CourseCatalog(name="Object-Oriented Programming", code="OOP201", prerequisite_catalog_id=pf.id)
        db.add(oop)
        db.flush()

        calculus = CourseCatalog(name="Calculus", code="MTH101")
        db.add(calculus)
        db.flush()

        db.commit()
        logger.info("Seeded predefined course catalog (Programming Fundamentals, Object-Oriented Programming, Calculus).")
    except Exception as e:
        logger.error(f"WARNING: Could not seed course catalog: {e}")
        db.rollback()
    finally:
        db.close()


try:
    seed_course_catalog()
except Exception as e:
    logger.error(f"WARNING: Course catalog seeding failed: {e}")

try:
    from app.database.connection import SessionLocal as _SessionLocal
    from app.gamification.seed import seed_badges
    _db = _SessionLocal()
    try:
        seed_badges(_db)
        logger.info("Seeded/verified gamification badge catalog.")
    finally:
        _db.close()
except Exception as e:
    logger.error(f"WARNING: Badge catalog seeding failed: {e}")

app = FastAPI(
    title="ConceptIntel API",
    description="Concept Graph-Based Concept Intelligence Platform — Air University, Islamabad",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for frontend API calls - origins come from ALLOWED_ORIGINS (comma-
# separated), defaulting to the local Vite dev server. Auth here is a Bearer
# token, not cookies, so this deliberately does not mix allow_credentials with a
# wildcard origin (CORS's browsers reject that combination anyway).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(auth_router, prefix="/api")
app.include_router(courses_router, prefix="/api")
app.include_router(enrollment_router, prefix="/api")
app.include_router(upload_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(announcements_router, prefix="/api")
app.include_router(assignments_router, prefix="/api")
app.include_router(programs_router, prefix="/api")
app.include_router(materials_router, prefix="/api")
app.include_router(meetings_router, prefix="/api")
app.include_router(stream_router, prefix="/api")
app.include_router(students_router, prefix="/api")
app.include_router(notification_preferences_router, prefix="/api")
app.include_router(assistant_router, prefix="/api")
app.include_router(calendar_router, prefix="/api")
app.include_router(contact_router, prefix="/api")
app.include_router(comments_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(content_processing_router, prefix="/api")
app.include_router(schedule_router, prefix="/api")
app.include_router(mastery_router, prefix="/api")
app.include_router(content_generation_router, prefix="/api")
app.include_router(gamification_router, prefix="/api")
app.include_router(gamification_catalog_router, prefix="/api")
app.include_router(games_router, prefix="/api")
app.include_router(study_router, prefix="/api")
app.include_router(question_bank_router, prefix="/api")
app.include_router(exams_router, prefix="/api")
app.include_router(practice_router, prefix="/api")
app.include_router(live_router, prefix="/api")
app.include_router(adaptive_engine_router, prefix="/api")
app.include_router(outcomes_router, prefix="/api")


def _keep_db_pool_warm():
    """Pings the database on a fixed interval so pooled connections never sit idle
    long enough for the hosted Postgres's own connection pooler (Supabase) to drop
    them server-side. Without this, the connection warmed once at startup (above)
    goes stale during any real gap between requests - a user reading a page,
    completing Google's OAuth popup, simply pausing - and pool_pre_ping then pays a
    full reconnect (observed ~2.7s) synchronously on THAT request. That is what
    made sign-in (and any other "first request after a pause") feel randomly slow:
    not the request itself, but a cold reconnect hidden inside it. A cheap
    heartbeat well under any idle-connection timeout keeps the pool warm instead.

    The first ping used to happen only after the initial `time.sleep(40)` below -
    which meant every dev-server restart (very frequent with --reload) left a
    ~40s window, right after boot, where the pool was still genuinely cold. A
    user signing in during that window (extremely likely right after any code
    change - it is exactly when a developer re-tests) paid the full reconnect
    cost on their real request instead of on this background thread. Pinging
    once immediately, before entering the wait loop, closes that window."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        logger.warning(f"Initial DB keep-alive ping failed: {e}")
    while True:
        time.sleep(40)
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception as e:
            logger.warning(f"DB keep-alive ping failed: {e}")


@app.on_event("startup")
def _start_db_keepalive() -> None:
    threading.Thread(target=_keep_db_pool_warm, daemon=True).start()
    # Same cold-start problem, different resource: see _prewarm_google_certs_cache's
    # own docstring (app/auth/routes.py) for why this also needs to happen at boot
    # rather than on the first real Google sign-in.
    threading.Thread(target=_prewarm_google_certs_cache, daemon=True).start()


@app.get("/")
def read_root():
    return {
        "name": "ConceptIntel API",
        "status": "healthy",
        "version": "1.0.0",
        "description": "AI-powered Concept Graph Concept Intelligence Platform",
        "docs": "/docs"
    }


@app.get("/health")
def health_check():
    """Quick health-check endpoint for monitoring."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "connected"
    except Exception:
        db_status = "disconnected"
    return {"status": "ok", "database": db_status}


if __name__ == "__main__":
    # Render (and most PaaS hosts) inject the port to bind via $PORT rather than
    # letting the app choose one - falls back to 8000 for local `python app/main.py`.
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
