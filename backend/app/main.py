import uvicorn
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from app.config import settings
from app.database.connection import engine
from app.database import models

# Import routers
from app.auth.routes import router as auth_router
from app.courses.routes import router as courses_router
from app.enrollment.routes import router as enrollment_router
from app.upload.routes import router as upload_router
from app.knowledge_graph.routes import router as graph_router
from app.content_processing.routes import router as content_processing_router

logger = logging.getLogger("conceptintel")

# Sentry - error/crash monitoring. No-op if SENTRY_DSN isn't set (same pattern as
# every other optional integration in this codebase).
if settings.SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(dsn=settings.SENTRY_DSN, traces_sample_rate=0.2, send_default_pii=False)
    logger.info("Sentry error monitoring enabled.")
else:
    logger.info("SENTRY_DSN not set - Sentry error monitoring disabled.")

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
    selectable when creating a course instance). Only inserts if the table is empty."""
    from app.database.connection import SessionLocal
    from app.database.models import CourseCatalog

    db = SessionLocal()
    try:
        if db.query(CourseCatalog).count() > 0:
            return

        physics = CourseCatalog(name="Applied Physics", code="PHY101")
        db.add(physics)
        db.flush()

        # Digital Logic Design requires Applied Physics as a prerequisite.
        dld = CourseCatalog(name="Digital Logic Design", code="DLD201", prerequisite_catalog_id=physics.id)
        db.add(dld)
        db.flush()

        calculus = CourseCatalog(name="Calculus & Analytical Geometry", code="MTH101")
        db.add(calculus)
        db.flush()

        db.commit()
        logger.info("Seeded predefined course catalog (Applied Physics, Digital Logic Design, Calculus & Analytical Geometry).")
    except Exception as e:
        logger.error(f"WARNING: Could not seed course catalog: {e}")
        db.rollback()
    finally:
        db.close()


try:
    seed_course_catalog()
except Exception as e:
    logger.error(f"WARNING: Course catalog seeding failed: {e}")

app = FastAPI(
    title="ConceptIntel API",
    description="Knowledge Graph-Based Concept Intelligence Platform — Air University, Islamabad",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for frontend API calls
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
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
app.include_router(content_processing_router, prefix="/api")


@app.get("/")
def read_root():
    return {
        "name": "ConceptIntel API",
        "status": "healthy",
        "version": "1.0.0",
        "description": "AI-powered Knowledge Graph Concept Intelligence Platform",
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
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
