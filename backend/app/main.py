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

logger = logging.getLogger("conceptintel")

# Automatically create PostgreSQL tables on startup
# Wrapped in try-except so app can still boot even if DB is temporarily unavailable
try:
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
