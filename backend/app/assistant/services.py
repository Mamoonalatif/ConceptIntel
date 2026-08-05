import logging
from typing import List
from openai import OpenAI
from google import genai
from google.genai import types as genai_types
from app.config import settings
from app.database.models import ChatMessage

logger = logging.getLogger("conceptintel")

FALLBACK_MESSAGE = "The AI assistant isn't configured right now - ask your instructor or check back later."

SYSTEM_PROMPT = """You are the AI assistant built into ConceptIntel, a knowledge-graph based
concept intelligence platform for university courses. You help students and teachers with:
- Explaining course concepts and answering study questions in plain language.
- Helping users navigate and understand the platform's features (courses, class stream,
  assignments, materials, meetings, knowledge graphs, notifications).
- General study guidance (how to approach a topic, breaking down a concept, exam prep tips).

Keep answers clear, concise, and encouraging. You do not have access to a specific course's
live content, roster, or grades in this conversation - if asked something that requires that,
say so plainly and suggest checking the relevant page or asking the instructor."""

# How many of the most recent messages (across both roles) to include as
# conversation context when calling the model - keeps the prompt small and cheap.
HISTORY_WINDOW = 20


def _provider() -> str:
    return (settings.AI_PROVIDER or "openai").strip().lower()


def _is_configured() -> bool:
    if _provider() == "gemini":
        return bool(settings.GEMINI_API_KEY) and not settings.GEMINI_API_KEY.startswith("your_")
    return bool(settings.OPENAI_API_KEY) and not settings.OPENAI_API_KEY.startswith("your_")


def _generate_openai_reply(history: List[ChatMessage], new_user_content: str) -> str:
    client = OpenAI(api_key=settings.OPENAI_API_KEY)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in history[-HISTORY_WINDOW:]:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": new_user_content})

    response = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=messages,
        temperature=0.5,
        max_tokens=800,
    )
    return response.choices[0].message.content or FALLBACK_MESSAGE


def _generate_gemini_reply(history: List[ChatMessage], new_user_content: str) -> str:
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
    return response.text or FALLBACK_MESSAGE


def generate_assistant_reply(history: List[ChatMessage], new_user_content: str) -> str:
    """Calls the configured AI provider (OpenAI or Gemini, per settings.AI_PROVIDER)
    with recent conversation history plus the new user message. Mirrors the
    graceful-fallback pattern used for concept extraction in
    app/knowledge_graph/services.py - never raises, always returns a string the
    caller can show to the user."""
    provider = _provider()
    if not _is_configured():
        logger.warning(f"{provider} API key not configured. Returning offline fallback assistant reply.")
        return FALLBACK_MESSAGE

    try:
        if provider == "gemini":
            return _generate_gemini_reply(history, new_user_content)
        return _generate_openai_reply(history, new_user_content)
    except Exception as e:
        logger.error(f"{provider} assistant call failed: {str(e)}. Falling back to offline message.")
        return FALLBACK_MESSAGE
