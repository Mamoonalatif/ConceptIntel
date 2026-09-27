# Container image for the ConceptIntel backend - built for Hugging Face Spaces
# (Docker SDK, listens on $PORT/7860 by default) but works anywhere a plain
# Docker host runs it (Cloud Run, a bare VM, etc.) since $PORT just falls back.
FROM python:3.11-slim

# libgl1/libglib2.0-0: opencv-python-headless (an easyocr dependency) needs these
# even in headless mode - omitting them fails at import time with "libGL.so.1:
# cannot open shared object file", not at pip install time.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces' Docker SDK always sends traffic to port 7860 - $PORT
# falls back to that so the same image also runs correctly on Cloud Run/Render/
# Railway/plain `docker run -p 8000:8000 -e PORT=8000 ...` without a rebuild.
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
