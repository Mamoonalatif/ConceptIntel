from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.security import hash_password
from app.database import Base, engine, get_db
from app.models.user import User, UserRole
from app.routers import auth, courses

Base.metadata.create_all(bind=engine)


def init_db():
    """Initialize database with default admin account"""
    db = next(get_db())
    try:
        # Check if admin already exists
        admin = db.query(User).filter(User.email == "admin@conceptintel.edu").first()
        if not admin:
            # Create default admin account
            admin = User(
                id="admin-001",
                email="admin@conceptintel.edu",
                full_name="System Administrator",
                hashed_password=hash_password("Admin@1234"),
                role=UserRole.admin,
                password_pending=False,
            )
            db.add(admin)
            db.commit()
            print("✅ Default admin account created: admin@conceptintel.edu / Admin@1234")
        else:
            print("ℹ️  Admin account already exists")
    finally:
        db.close()


init_db()  # Initialize default admin account

app = FastAPI(
    title="ConceptIntel API",
    description="Backend API for ConceptIntel — AI-powered educational intelligence platform",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(courses.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "conceptintel-api"}
