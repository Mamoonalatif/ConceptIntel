# Database engine, session factory and the get_db dependency used by every route.
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

# Create engine
# pool_size=5/max_overflow=10 (SQLAlchemy's defaults, previously left unset here)
# cap this process at 15 concurrent DB connections - confirmed live: "QueuePool
# limit of size 5 overflow 10 reached, connection timed out". A single page like
# course details now fires 3-4 concurrent requests on its own (see
# frontend/src/pages/CourseDetail.tsx's Promise.all), the sidebar/notifications
# poll independently, and DATABASE_URL already points at Supabase's own pooler
# (pgbouncer) - which is designed to multiplex far more than 15 connections.
# Raising the ceiling here doesn't fix a slow network, but it stops ordinary
# concurrent page loads from exhausting the pool and timing out real requests.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,  # Automatically checks connections and reconnects if dropped
    pool_size=15,
    max_overflow=15,
    # How long a request waits for a pool slot before giving up - the default
    # (30s) is what turned pool exhaustion into a request hanging for 30s and
    # then failing outright, instead of failing fast with a clear error.
    pool_timeout=10,
)

# Session factory (each request gets its own session; commits are explicit)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative base: every ORM model in models.py inherits from this
Base = declarative_base()

def get_db():
    """FastAPI dependency to yield database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
