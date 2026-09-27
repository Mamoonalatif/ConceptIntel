"""AI-generated, student-facing summaries for course posting notifications.

Routed through the project's one shared LLM client factory
(`app.content_processing.kimi_service._get_client` -> OpenRouter) on
`settings.KIMI_MODEL`, the same path as concept extraction, grading and content
generation. The rejected alternative - and what this module used to do - was to
build its own `OpenAI(api_key=settings.OPENAI_API_KEY)` client on
`settings.OPENAI_MODEL`, copying the pattern from
`app/knowledge_graph/services.py`. That gave one more feature its own private
credential, and when OPENAI_API_KEY turned out to hold a Google "AIza..." value
this module silently served the offline fallback for every notification with
nothing but a log line to say so. Sharing the factory means there is exactly one
provider to configure and one place to change it.

The offline fallback is deliberately untouched. It is not dead code waiting on a
key: it is the correct output whenever OpenRouter is unconfigured or the call
fails, and it is what guarantees the no-raise contract below.

This module is invoked from best-effort notification paths (announcements,
assignments, materials, meetings post-create) - `generate_posting_summary`
must NEVER raise, since a summarization hiccup should never stop a
notification (or the surrounding request) from completing.
"""
import logging

from app.config import settings
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.notifications.ai_summary")

_POST_TYPE_LABELS = {
    "announcement": "announcement",
    "assignment": "assignment",
    "material": "material",
    "meeting": "meeting",
}

SUMMARY_SYSTEM_PROMPT = """You write short, natural, student-facing notification blurbs for a \
learning management system. Given the type, title, and content of a newly posted course item, \
respond with exactly ONE short sentence (no more than 25 words) summarizing it for a student \
notification feed. Be concrete and natural, e.g. "New assignment 'Lab 3' due Friday, worth 20 \
points" or "New material 'Chapter 4 Slides' has been posted." Do not add quotation marks around \
the whole sentence, do not add a preamble, and respond with the sentence only."""

SUMMARY_USER_PROMPT_TEMPLATE = """Type: {label}
Title: {title}
Content: {content}"""


def _offline_summary(post_type: str, title: str, content: str) -> str:
    """Plain truncated fallback string built from title + content, used when
    OpenRouter isn't configured or the API call fails."""
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


@trace_ai_call("notification-posting-summary")
def _summarize_via_openrouter(post_type: str, title: str, content: str) -> str:
    """The actual model call. Raises on any failure; the caller owns the fallback.

    Single-shot, with no retry loop - unlike the content pipeline in
    `kimi_service.clean_and_structure_chunk`. That call produces the graph and has
    no acceptable substitute, so retrying is worth the latency; this one has a
    perfectly good offline fallback available immediately, and it runs inline on a
    post-create request, so two extra round trips would be paid in user-visible
    latency to improve a one-line blurb. Prose out, so no response_format.
    """
    from app.content_processing.kimi_service import _get_client

    client = _get_client()
    if client is None:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")

    label = _POST_TYPE_LABELS.get(post_type, "post")
    response = client.chat.completions.create(
        model=settings.KIMI_MODEL,
        messages=[
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": SUMMARY_USER_PROMPT_TEMPLATE.format(
                    label=label, title=title, content=content or "(no additional content)"
                ),
            },
        ],
        temperature=0.4,
        # One sentence needs ~40 tokens; the headroom over that is margin for a
        # provider that ignores the reasoning-exclude hint and spends tokens
        # thinking first, which would otherwise return finish_reason="length"
        # and message.content=None.
        max_tokens=200,
        timeout=60.0,
        extra_body={"reasoning": {"exclude": True}},
    )

    summary = (response.choices[0].message.content or "").strip()
    if not summary:
        raise ValueError(
            f"Model returned empty content (finish_reason={response.choices[0].finish_reason})"
        )
    return summary


def generate_posting_summary(post_type: str, title: str, content: str) -> str:
    """Generates a single short student-facing sentence summarizing a course
    posting (announcement/assignment/material/meeting), e.g. "New assignment
    'Lab 3' due Friday, worth 20 points." Falls back to a plain truncated
    string built from title+content if `OPENROUTER_API_KEY` is unset or the API
    call raises any exception. This function must never raise - it's called
    from a best-effort notification path, so everything is wrapped in a
    top-level try/except as a final safety net even though the inner logic
    already handles the expected failure modes.
    """
    try:
        if not settings.OPENROUTER_API_KEY or settings.OPENROUTER_API_KEY.startswith("your_"):
            logger.warning("OpenRouter API key not configured. Using offline fallback summary.")
            return _offline_summary(post_type, title, content)

        try:
            return _summarize_via_openrouter(post_type, title, content)
        except Exception as e:
            logger.error(
                "OpenRouter posting-summary call failed: %s: %s. Falling back to offline posting summary.",
                type(e).__name__, str(e),
            )
            return _offline_summary(post_type, title, content)

    except Exception as e:
        logger.error(f"generate_posting_summary failed unexpectedly: {str(e)}. Using minimal fallback.")
        try:
            return _offline_summary(post_type, title, content)
        except Exception:
            return f"New {post_type} posted: {title}"
