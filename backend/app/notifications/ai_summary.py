"""AI-generated, student-facing summaries for course posting notifications.

Mirrors the OpenAI call pattern already used in `app/knowledge_graph/services.py`
(`extract_concepts_from_chunk_ai`): same client construction
(`OpenAI(api_key=settings.OPENAI_API_KEY)`), same `settings.OPENAI_MODEL`, and
the same graceful offline fallback when the key is unset or the call fails.

This module is invoked from best-effort notification paths (announcements,
assignments, materials, meetings post-create) - `generate_posting_summary`
must NEVER raise, since a summarization hiccup should never stop a
notification (or the surrounding request) from completing.
"""
import logging
from openai import OpenAI
from app.config import settings

logger = logging.getLogger(__name__)

_POST_TYPE_LABELS = {
    "announcement": "announcement",
    "assignment": "assignment",
    "material": "material",
    "meeting": "meeting",
}


def _offline_summary(post_type: str, title: str, content: str) -> str:
    """Plain truncated fallback string built from title + content, used when
    the OpenAI key isn't configured or the API call fails."""
    label = _POST_TYPE_LABELS.get(post_type, "post")
    text = f"New {label}: {title}."
    if content:
        remaining = 140 - len(text) - 1
        if remaining > 0:
            snippet = content.strip()
            if len(snippet) > remaining:
                snippet = snippet[:remaining].rstrip() + "..."
            if snippet:
                text = f"{text} {snippet}"
    return text


def generate_posting_summary(post_type: str, title: str, content: str) -> str:
    """Generates a single short student-facing sentence summarizing a course
    posting (announcement/assignment/material/meeting), e.g. "New assignment
    'Lab 3' due Friday, worth 20 points." Falls back to a plain truncated
    string built from title+content if `OPENAI_API_KEY` is unset or the API
    call raises any exception. This function must never raise - it's called
    from a best-effort notification path, so everything is wrapped in a
    top-level try/except as a final safety net even though the inner logic
    already handles the expected failure modes.
    """
    try:
        if not settings.OPENAI_API_KEY or settings.OPENAI_API_KEY.startswith("your_"):
            logger.warning("OpenAI API Key not configured. Using offline fallback summary.")
            return _offline_summary(post_type, title, content)

        try:
            client = OpenAI(api_key=settings.OPENAI_API_KEY)

            label = _POST_TYPE_LABELS.get(post_type, "post")
            system_prompt = (
                "You write short, natural, student-facing notification blurbs for a "
                "learning management system. Given the type, title, and content of a "
                "newly posted course item, respond with exactly ONE short sentence "
                "(no more than 25 words) summarizing it for a student notification feed. "
                "Be concrete and natural, e.g. \"New assignment 'Lab 3' due Friday, worth "
                "20 points\" or \"New material 'Chapter 4 Slides' has been posted.\" "
                "Do not add quotation marks around the whole sentence, do not add a "
                "preamble, and respond with the sentence only."
            )
            user_prompt = (
                f"Type: {label}\n"
                f"Title: {title}\n"
                f"Content: {content or '(no additional content)'}"
            )

            response = client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.4,
                max_tokens=60,
            )

            summary = (response.choices[0].message.content or "").strip()
            if not summary:
                logger.warning("OpenAI returned an empty posting summary. Falling back to offline summary.")
                return _offline_summary(post_type, title, content)
            return summary

        except Exception as e:
            logger.error(f"OpenAI API call failed: {str(e)}. Falling back to offline posting summary.")
            return _offline_summary(post_type, title, content)

    except Exception as e:
        logger.error(f"generate_posting_summary failed unexpectedly: {str(e)}. Using minimal fallback.")
        try:
            return _offline_summary(post_type, title, content)
        except Exception:
            return f"New {post_type} posted: {title}"
