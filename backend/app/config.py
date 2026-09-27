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
    # A long-lived companion to the access token, issued alongside it at login and
    # exchanged for a fresh access token via POST /auth/refresh - lets a session
    # outlive ACCESS_TOKEN_EXPIRE_MINUTES without forcing a full re-login.
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

    # Google Sign-In (OAuth 2.0 client ID from Google Cloud Console, "Web application" type)
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")

    # Public URL of the deployed frontend (e.g. https://conceptintel.vercel.app, no
    # trailing slash needed) - used to build links in outbound emails/notifications
    # (password reset, grade notifications). Defaults to the local Vite dev server.
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

    # Comma-separated list of origins allowed to call this API (e.g.
    # "https://conceptintel.vercel.app,https://www.mydomain.com"). Defaults cover
    # local dev only - set this in production instead of relying on "*".
    ALLOWED_ORIGINS: str = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000")

    # Outbound email (Gmail SMTP with an App Password - free, no third-party signup).
    # Leave unset to skip email delivery; credentials are still shown in the API
    # response either way, so nothing breaks if this isn't configured.
    SMTP_EMAIL: str = os.getenv("SMTP_EMAIL", "")
    SMTP_APP_PASSWORD: str = os.getenv("SMTP_APP_PASSWORD", "")
    # Display name shown as the sender in a recipient's inbox (e.g. "ConceptIntel"
    # instead of the raw Gmail address itself) - see app/email_service.py. Gmail
    # SMTP still shows the real SMTP_EMAIL address alongside this name in most
    # mail clients; only a custom-domain transactional provider can hide it
    # entirely, which this app does not use.
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME", "ConceptIntel")

    # Neo4j Graph DB Configuration - remote (e.g. Neo4j AuraDB) by default, since a
    # driver connection string works the same whether it's local (bolt://) or
    # remote/TLS (neo4j+s://) - only the .env value changes, no code does.
    NEO4J_URI: str = os.getenv("NEO4J_URI", "neo4j+s://xxxxxx.databases.neo4j.io")
    NEO4J_USERNAME: str = os.getenv("NEO4J_USERNAME", "neo4j")
    NEO4J_PASSWORD: str = os.getenv("NEO4J_PASSWORD", "password")

    # OpenAI API Key & Model Configuration - only used directly by the AI Assistant
    # chatbot (app/assistant/services.py) when AI_PROVIDER=openai. Every other AI
    # call in this project (content processing, concept extraction/knowledge graph
    # building, grading, question/content generation, embeddings, image captioning)
    # goes through Kimi K2 / OpenRouter instead - see OPENROUTER_API_KEY below.
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

    # ---------------------------------------------------------------------
    # RAG / embeddings
    #
    # Embeddings go through OpenRouter (same key and same OpenAI-compatible
    # endpoint as every other AI call in this project) rather than a second
    # provider. Google's Generative Language API - the other candidate - is
    # geo-blocked from this deployment's region and returns
    # "400 FAILED_PRECONDITION: User location is not supported for the API use"
    # for BOTH embed_content and generate_content, so it is not a usable
    # embedding backend here regardless of the key being valid.
    #
    # EMBEDDING_DIM MUST match the declared width of ContentChunk.embedding
    # (app/database/models.py). Postgres cannot change a pgvector column's
    # dimension in place while rows exist, and this project has no Alembic -
    # Base.metadata.create_all() never alters an existing column. So changing
    # either of these two values requires running
    # `scripts/reembed_content_chunks.py`, which rebuilds the column and
    # re-embeds every chunk from the text already stored on uploaded_files.
    # Nothing needs re-uploading.
    # Default is "local": fully offline via fastembed, no API key and no per-token
    # cost. BAAI/bge-base-en-v1.5 (768-dim) is the best-quality model that still
    # runs comfortably in-process - bge-small (384-dim) is smaller but retrieves
    # measurably worse. Set EMBEDDING_PROVIDER=openrouter to use a hosted model
    # (e.g. openai/text-embedding-3-small) instead, at a small per-token cost.
    EMBEDDING_PROVIDER: str = os.getenv("EMBEDDING_PROVIDER", "local")  # "openrouter" | "local"
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")
    EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "768"))
    EMBEDDING_BATCH_SIZE: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "64"))
    # Used only when EMBEDDING_PROVIDER=local. Must also match EMBEDDING_DIM -
    # bge-small is 384, bge-base and nomic are 768.
    EMBEDDING_LOCAL_MODEL: str = os.getenv("EMBEDDING_LOCAL_MODEL", "BAAI/bge-base-en-v1.5")

    # Retrieval tuning. RAG_CANDIDATE_MULTIPLIER controls how many rows the SQL
    # nearest-neighbour query fetches before the similarity threshold is applied
    # in Python - without it, a strict threshold silently shrinks the result set
    # instead of searching deeper (see app/rag/retrieval.py).
    # The threshold is model-specific: on openai/text-embedding-3-small a directly
    # on-topic passage scores ~0.62, a related-but-different one ~0.34, and an
    # unrelated one ~0.13 (0.30 was the right cutoff there). BGE models (the
    # default local embedder above) score much higher across the board, so the
    # default here is 0.45 to match. Re-measure if EMBEDDING_MODEL/EMBEDDING_LOCAL_MODEL
    # changes to a different family.
    RAG_TOP_K: int = int(os.getenv("RAG_TOP_K", "5"))
    RAG_SIMILARITY_THRESHOLD: float = float(os.getenv("RAG_SIMILARITY_THRESHOLD", "0.45"))
    RAG_CANDIDATE_MULTIPLIER: int = int(os.getenv("RAG_CANDIDATE_MULTIPLIER", "4"))

    # Cosine-similarity floor for concept-graph semantic dedup (name+description
    # embeddings) - see knowledge_graph/revision_service.py compute_diff. Higher
    # than RAG_SIMILARITY_THRESHOLD on purpose: these are short, literal name+
    # description pairs (not long passages), and merging two genuinely distinct
    # concepts (e.g. "Derivative" and "Integral") is a worse failure than
    # occasionally missing a true paraphrase duplicate.
    CONCEPT_SEMANTIC_DEDUP_THRESHOLD: float = float(os.getenv("CONCEPT_SEMANTIC_DEDUP_THRESHOLD", "0.86"))

    # Vision model for image captioning during RAG ingestion. Routed through
    # OpenRouter for the same reason as embeddings.
    VISION_MODEL: str = os.getenv("VISION_MODEL", "openai/gpt-4o-mini")

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
