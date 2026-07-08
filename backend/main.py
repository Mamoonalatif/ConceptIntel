from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.routers import auth, courses

Base.metadata.create_all(bind=engine)

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
