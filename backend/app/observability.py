"""Langfuse tracing for AI/LLM calls - prompt, response, latency, and cost logged
for every call, so a teacher/supervisor can review exactly what the AI generated and
why (transparency requirement from the proposal).

Configured via LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY (free tier at
https://cloud.langfuse.com, or self-hosted - set LANGFUSE_HOST accordingly). If
unset, tracing is a no-op - no call site needs to know or care whether it's
configured, matching every other optional integration in this codebase (email,
Google sign-in, image captioning).
"""
import logging

from app.config import settings

logger = logging.getLogger("conceptintel")

LANGFUSE_PUBLIC_KEY = settings.LANGFUSE_PUBLIC_KEY
LANGFUSE_SECRET_KEY = settings.LANGFUSE_SECRET_KEY
LANGFUSE_HOST = settings.LANGFUSE_HOST

is_configured = bool(LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY)

if not is_configured:
    logger.info("Langfuse not configured (LANGFUSE_PUBLIC_KEY/SECRET_KEY unset) - AI call tracing disabled.")


def trace_ai_call(name: str, as_type: str = "generation"):
    """Decorator for any function that makes an LLM/embedding call. No-ops entirely
    if Langfuse isn't configured, so this is always safe to apply."""
    if not is_configured:
        def noop_decorator(fn):
            return fn
        return noop_decorator

    # Correct import path for this SDK version (2.x) - `from langfuse import observe`
    # doesn't exist here despite appearing in some docs/examples; that's what was
    # crashing the whole backend on startup.
    from langfuse.decorators import observe
    return observe(name=name, as_type=as_type)
