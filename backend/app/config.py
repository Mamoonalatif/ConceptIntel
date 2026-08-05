import os
from pathlib import Path
from dotenv import load_dotenv


# Load environment variables from .env file
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

class Settings:
    # Postgres Configuration - hosted on Supabase (Project Settings -> Database ->
    # Connection string, Session/Transaction pooler URI). No local Postgres install
    # is part of this project anymore - DATABASE_URL must be set in .env.
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

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

    # Neo4j Graph DB Configuration - remote (e.g. Neo4j AuraDB) by default, since a
    # driver connection string works the same whether it's local (bolt://) or
    # remote/TLS (neo4j+s://) - only the .env value changes, no code does.
    NEO4J_URI: str = os.getenv("NEO4J_URI", "neo4j+s://xxxxxx.databases.neo4j.io")
    NEO4J_USERNAME: str = os.getenv("NEO4J_USERNAME", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "password")

    # OpenAI API Key & Model Configuration (still used by the legacy direct-build path
    # in knowledge_graph/services.py)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # Gemini API Key & Model Configuration - an alternative provider for the AI
    # Assistant chatbot (app/assistant/services.py). AI_PROVIDER picks which one
    # is actually called; the other's key can stay blank.
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "openai")  # "openai" | "gemini"
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

    # Kimi K2 via OpenRouter (OpenAI-compatible endpoint) - used by the new
    # content_processing pipeline for cleaning/structuring OCR'd + uploaded text.
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    OPENROUTER_BASE_URL: str = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    KIMI_MODEL: str = os.getenv("KIMI_MODEL", "moonshotai/kimi-k2")

    # Redis (app-level cache: Kimi extraction results keyed by content hash, and
    # short-TTL caching of read-heavy graph endpoints). Not used by Airflow itself.
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    REDIS_CACHE_TTL_SECONDS: int = int(os.getenv("REDIS_CACHE_TTL_SECONDS", "3600"))

    # Airflow REST API (LocalExecutor, running via Docker Compose - see infra/airflow/).
    # Used to trigger the content_graph_pipeline DAG when a teacher requests graph
    # generation. If unreachable, the pipeline runs inline via FastAPI BackgroundTasks
    # instead, so the feature still works before Airflow is set up.
    AIRFLOW_BASE_URL: str = os.getenv("AIRFLOW_BASE_URL", "http://localhost:8080/api/v1")
    AIRFLOW_USERNAME: str = os.getenv("AIRFLOW_USERNAME", "airflow")
    AIRFLOW_PASSWORD: str = os.getenv("AIRFLOW_PASSWORD", "airflow")
    AIRFLOW_DAG_ID: str = os.getenv("AIRFLOW_DAG_ID", "content_graph_pipeline")

    # OCR (EasyOCR) - used as a fallback only when a page/file has no extractable
    # text layer (scanned PDFs, or plain images).
    OCR_LANGUAGES: str = os.getenv("OCR_LANGUAGES", "en")  # comma-separated EasyOCR language codes
    OCR_MIN_TEXT_LENGTH: int = int(os.getenv("OCR_MIN_TEXT_LENGTH", "20"))  # below this, treat page as "no text layer"

    # Supabase File Storage (Optional) - also the same project used for Auth (GoTrue)
    # and Postgres above, and now pgvector-based content_chunks for semantic search.
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    SUPABASE_BUCKET: str = os.getenv("SUPABASE_BUCKET", "conceptintel-files")

    # AWS S3 File Storage (Optional - takes priority over Supabase/local when set).
    # Bucket is expected to be PRIVATE - files are read/written via authenticated
    # boto3 calls, never a public URL (see app/upload/services.py).
    AWS_ACCESS_KEY_ID: str = os.getenv("AWS_ACCESS_KEY_ID", "")
    AWS_SECRET_ACCESS_KEY: str = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    AWS_REGION: str = os.getenv("AWS_REGION", "us-east-1")
    AWS_S3_BUCKET: str = os.getenv("AWS_S3_BUCKET", "")

    # Langfuse - AI/LLM call tracing (prompt, response, latency, cost). No-op if unset.
    LANGFUSE_PUBLIC_KEY: str = os.getenv("LANGFUSE_PUBLIC_KEY", "")
    LANGFUSE_SECRET_KEY: str = os.getenv("LANGFUSE_SECRET_KEY", "")
    LANGFUSE_HOST: str = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    # Sentry - error/crash monitoring for the backend. No-op if unset.
    SENTRY_DSN: str = os.getenv("SENTRY_DSN", "")

    # Local Storage Upload Folder
    UPLOAD_DIR: str = os.getenv("UPLOAD_DIR", "uploads")

    @property
    def upload_path(self) -> Path:
        path = BASE_DIR / self.UPLOAD_DIR
        path.mkdir(parents=True, exist_ok=True)
        return path

settings = Settings()
