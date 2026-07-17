import os
from pathlib import Path
from dotenv import load_dotenv


# Load environment variables from .env file
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

class Settings:
    # PostgreSQL Configuration
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "postgresql://postgres:postgres@localhost:5432/postgres"
    )

    # JWT Authentication
    JWT_SECRET: str = os.getenv("JWT_SECRET", "super_secret_conceptintel_token_signing_key_2026")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Google Sign-In (OAuth 2.0 client ID from Google Cloud Console, "Web application" type)
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")

    # Outbound email (Gmail SMTP with an App Password - free, no third-party signup).
    # Leave unset to skip email delivery; credentials are still shown in the API
    # response either way, so nothing breaks if this isn't configured.
    SMTP_EMAIL: str = os.getenv("SMTP_EMAIL", "")
    SMTP_APP_PASSWORD: str = os.getenv("SMTP_APP_PASSWORD", "")

    # Neo4j Graph DB Configuration

    NEO4J_URI: str = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    NEO4J_USERNAME: str = os.getenv("NEO4J_USERNAME", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "password")
    print("NEO4J_URI =", os.getenv("NEO4J_URI"))

    # OpenAI API Key & Model Configuration
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Supabase File Storage (Optional)
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    SUPABASE_BUCKET: str = os.getenv("SUPABASE_BUCKET", "conceptintel-files")
    
    # Local Storage Upload Folder
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "uploads")
    
    @property
    def upload_path(self) -> Path:
        path = BASE_DIR / self.UPLOAD_DIR
        path.mkdir(parents=True, exist_ok=True)
        return path

settings = Settings()
