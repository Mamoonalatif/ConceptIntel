"""The ConceptIntel chatbot: turns recent chat history plus a new user message into
a prose reply, via whichever provider settings.AI_PROVIDER names.

Why keep three provider branches at all, rather than collapsing to the one provider
that currently works? Because AI_PROVIDER is an operator-facing switch and the
alternatives are cheap to keep - the OpenAI and Gemini branches are a dozen lines
each and cost nothing when not selected. What was NOT acceptable was the previous
behaviour of treating the configured provider as the only possible answer.

That is the design change here. Previously a misconfigured or unreachable provider
meant the chatbot returned FALLBACK_MESSAGE to every user, forever, with the real
cause visible only in a log line - and this deployment hit exactly that: it is
configured for Gemini, and Google's API is geo-blocked from this region, returning
"400 FAILED_PRECONDITION: User location is not supported for the API use" for every
call despite a valid key. So provider selection is now a CASCADE: try the configured
provider, and on either "not configured" or a runtime failure, fall through to the
OpenRouter branch, which shares its credentials with concept extraction,
grading and content generation and is therefore configured whenever the rest of the
platform works. FALLBACK_MESSAGE is the last resort, not the first casualty.

The rejected alternative was retrying the configured provider (the hand-rolled
3-attempt loop used in `app/content_processing/generation_service.py`). The failures this
guards against - a geo-block, a wrong key, an unset key - are permanent, so retrying
would just make a user-facing chat turn three times slower before failing anyway.
Falling sideways to a provider that works is strictly better here. The pipeline's
retry loop is the right tool for its own transient JSON/timeout failures; it isn't
the right tool for this.
"""
import logging
from typing import List, Optional
from openai import OpenAI
from google import genai
from google.genai import types as genai_types
from sqlalchemy.orm import Session
from app.config import settings
from app.courses.access import ACTIVE_ENROLLMENT_STATUSES, OVERSIGHT_ROLES
from app.database.models import ChatMessage, Course, Enrollment, User
from app.observability import trace_ai_call
from app.rag.retrieval import format_excerpts, retrieve

logger = logging.getLogger("conceptintel.assistant")

FALLBACK_MESSAGE = "The AI assistant isn't configured right now - ask your instructor or check back later."

SYSTEM_PROMPT = """You are the AI assistant built into ConceptIntel, a knowledge-graph based
concept intelligence platform for university courses. You help students and teachers with:
- Explaining course concepts and answering study questions in plain language.
- Helping users navigate and understand the platform's features (courses, class stream,
  assignments, materials, meetings, concept graphs, notifications).
- General study guidance (how to approach a topic, breaking down a concept, exam prep tips).

Some questions arrive with a "Course material excerpts" block attached below them - that
material was pulled from the uploaded course content of courses this user teaches or is
enrolled in, because it looked relevant to their question. When it's there, ground your
answer in it and say which excerpt you used; when a question comes with no such block, or
the block doesn't actually cover it, answer from general knowledge and say plainly that this
isn't something you found in their course material.

Keep answers clear, concise, and encouraging.

Formatting: the chat UI renders your reply as plain text, not markdown - it does not turn
**text** into bold or - into bullet points, it just shows those characters literally. So write
in plain prose: no markdown bold/italics/headers, no asterisk or dash bullet lists. For a short
list, use numbered lines ("1. ...") or separate sentences instead. A sparing, relevant emoji is
fine for warmth, but don't overuse them."""

# How many of the most recent messages (across both roles) to include as
# conversation context when calling the model - keeps the prompt small and cheap.
HISTORY_WINDOW = 20


OPENROUTER_PROVIDER = "openrouter"


def _provider() -> str:
    return (settings.AI_PROVIDER or "openai").strip().lower()


def _key_is_usable(key: Optional[str]) -> bool:
    """The project-wide convention for "is this credential real?" - a key left at
    its .env.example placeholder is present but useless, and treating it as
    configured is what makes a feature fail one call at a time instead of
    degrading up front."""
    return bool(key) and not key.startswith("your_")


def _is_configured(provider: Optional[str] = None) -> bool:
    """Whether the given provider (default: the configured one) has a usable key."""
    provider = provider or _provider()
    if provider == "gemini":
        return _key_is_usable(settings.GEMINI_API_KEY)
    if provider == OPENROUTER_PROVIDER:
        return _key_is_usable(settings.OPENROUTER_API_KEY)
    return _key_is_usable(settings.OPENAI_API_KEY)


def _accessible_course_ids(db: Session, user: User) -> List[int]:
    """Which courses' uploaded material this user may be grounded against: every
    course they teach, every course they're actively enrolled in as a student, or
    (for admin/coordinator oversight roles) every course on the platform.

    Mirrors the same access rule as app.courses.access.assert_course_access, just
    resolved as a set of ids up front rather than checked one course at a time -
    the assistant has no single course_id to check against."""
    if user.role.lower() in OVERSIGHT_ROLES or user.is_program_coordinator or user.is_course_coordinator:
        return [c.id for c in db.query(Course.id).all()]

    ids = {c.id for c in db.query(Course.id).filter(Course.teacher_id == user.id).all()}
    if user.role.lower() == "student":
        ids |= {
            e.course_id for e in db.query(Enrollment.course_id).filter(
                Enrollment.student_id == user.id,
                Enrollment.status.in_(ACTIVE_ENROLLMENT_STATUSES),
            ).all()
        }
    return list(ids)


def _grounded_content(db: Session, user: User, new_user_content: str) -> str:
    """Appends relevant excerpts from this user's own course material to their
    message, for the model to see - the stored ChatMessage keeps the original text
    (see assistant/routes.py), only the copy sent to the provider carries this.

    Retrieval spans every course the user can see at once (RAG_TOP_K best chunks
    across all of them) rather than looping per course, since this is one chat
    question, not a per-course report."""
    course_ids = _accessible_course_ids(db, user)
    if not course_ids:
        return new_user_content
    try:
        retrieved = retrieve(db, course_ids=course_ids, query=new_user_content)
    except Exception as e:
        logger.warning("Assistant RAG retrieval failed, answering ungrounded: %s: %s", type(e).__name__, str(e))
        return new_user_content
    if not retrieved:
        return new_user_content
    return f"{new_user_content}\n\nCourse material excerpts:\n\n{format_excerpts(retrieved)}"


def _build_messages(history: List[ChatMessage], new_user_content: str) -> List[dict]:
    """OpenAI-shaped message list, shared by the OpenAI and OpenRouter branches - both
    speak the same chat-completions schema, so building it twice was only ever an
    opportunity for the two to drift."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history[-HISTORY_WINDOW:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": new_user_content})
    return messages


def _require_content(response) -> str:
    """Empty content is an error, not a reply. These branches used to return
    `... or FALLBACK_MESSAGE`, which turned a truncated or reasoning-starved
    response into a user-facing "the assistant isn't configured" message and
    hid it from the cascade below. Raising instead lets the next provider try,
    and puts finish_reason in the log where it can be diagnosed."""
    choice = response.choices[0]
    content = (choice.message.content or "").strip()
    if not content:
        raise ValueError(f"Model returned empty content (finish_reason={choice.finish_reason})")
    return content


def _generate_openai_reply(history: List[ChatMessage], new_user_content: str) -> str:
    client = OpenAI(api_key=settings.OPENAI_API_KEY, timeout=60.0)

    response = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=_build_messages(history, new_user_content),
        temperature=0.5,
        max_tokens=800,
        timeout=60.0,
    )
    return _require_content(response)


def _generate_openrouter_reply(history: List[ChatMessage], new_user_content: str) -> str:
    """Reuses the same OpenRouter credentials already configured for concept
    extraction, assignment grading, and content generation - lets the assistant
    work without provisioning a separate OpenAI or Gemini key at all, and is what
    every other branch falls back to.

    Goes through the project's one shared client factory rather than constructing
    its own OpenAI(...) - same key, same base_url, same 60s timeout, one place to
    change. Note there is deliberately NO response_format={"type": "json_object"}
    here: the assistant returns prose for a chat bubble, not a parsed structure.
    """
    from app.content_processing.generation_service import _get_client, _reasoning_extra_body

    client = _get_client()
    if client is None:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")

    response = client.chat.completions.create(
        model=settings.GENERATION_MODEL,
        messages=_build_messages(history, new_user_content),
        temperature=0.5,
        max_tokens=800,
        timeout=60.0,
        # Without this a reasoning model spends the whole max_tokens budget on
        # hidden thinking and hands back message.content=None - which here would
        # look exactly like the provider being down.
        extra_body=_reasoning_extra_body(),
    )
    return _require_content(response)


def _generate_gemini_reply(history: List[ChatMessage], new_user_content: str) -> str:
    """Kept as a selectable option, but note that Google's Generative Language API
    is geo-blocked from this deployment's region and answers every request with
    "400 FAILED_PRECONDITION: User location is not supported for the API use",
    valid key or not. That is precisely the runtime failure the cascade in
    `generate_assistant_reply` exists to absorb."""
    # Gemini has no "system" role - the system prompt goes in `system_instruction`
    # instead, and prior turns become `contents` (Gemini uses "model" where
    # OpenAI/this app use "assistant").
    client = genai.Client(api_key=settings.GEMINI_API_KEY)

    contents = [
        genai_types.Content(role="model" if msg.role == "assistant" else "user", parts=[genai_types.Part(text=msg.content)])
        for msg in history[-HISTORY_WINDOW:]
    ]
    contents.append(genai_types.Content(role="user", parts=[genai_types.Part(text=new_user_content)]))

    response = client.models.generate_content(
        model=settings.GEMINI_MODEL,
        contents=contents,
        config=genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT, temperature=0.5, max_output_tokens=800,
        ),
    )
    text = (response.text or "").strip()
    if not text:
        raise ValueError("Gemini returned empty content")
    return text


def _dispatch(provider: str, history: List[ChatMessage], new_user_content: str) -> str:
    """Route to one provider's branch. Raises on failure - the caller decides
    whether that means try the next provider or give up."""
    if provider == "gemini":
        return _generate_gemini_reply(history, new_user_content)
    if provider == OPENROUTER_PROVIDER:
        return _generate_openrouter_reply(history, new_user_content)
    return _generate_openai_reply(history, new_user_content)


@trace_ai_call("assistant-reply")
def generate_assistant_reply(db: Session, user: User, history: List[ChatMessage], new_user_content: str) -> str:
    """Calls an AI provider with recent conversation history plus the new user
    message and returns its prose reply.

    Before dispatching, the new message is checked against this user's own course
    material (every course they teach or are enrolled in) via RAG - see
    _grounded_content. If anything relevant turns up it's appended for the model to
    see; the ChatMessage stored in the database keeps the original, un-grounded
    text (assistant/routes.py stores payload.content, not this).

    Tries settings.AI_PROVIDER first, then cascades to the OpenRouter branch if
    that provider is unconfigured or fails at runtime - see the module docstring for
    why a cascade rather than a retry. Never raises: like concept extraction in
    app/knowledge_graph/services.py, it always returns a string the caller can show
    to the user, falling back to FALLBACK_MESSAGE only when no provider at all
    could answer.
    """
    provider = _provider()
    effective_content = _grounded_content(db, user, new_user_content)

    # Ordered attempt list, deduplicated: when OpenRouter IS the configured provider
    # there is nothing to fall back to, and retrying it would just be the retry
    # loop this design deliberately rejected.
    candidates = [provider] + ([OPENROUTER_PROVIDER] if provider != OPENROUTER_PROVIDER else [])

    last_error: Optional[Exception] = None
    for candidate in candidates:
        is_fallback = candidate != provider
        if not _is_configured(candidate):
            role = "fallback" if is_fallback else "configured"
            logger.warning("Assistant %s provider '%s' has no usable API key.", role, candidate)
            continue
        try:
            if is_fallback:
                logger.warning("Assistant falling back from '%s' to '%s'.", provider, candidate)
            return _dispatch(candidate, history, effective_content)
        except Exception as e:
            last_error = e
            logger.warning(
                "Assistant provider '%s' call failed: %s: %s", candidate, type(e).__name__, str(e),
            )

    logger.error(
        "No assistant provider could answer (configured='%s', tried=%s). Last error: %s. "
        "Returning offline fallback message.",
        provider, candidates, last_error,
    )
    return FALLBACK_MESSAGE
