import logging
from typing import List
from openai import OpenAI
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


def _is_configured() -> bool:
    return bool(settings.OPENAI_API_KEY) and not settings.OPENAI_API_KEY.startswith("your_")


def generate_assistant_reply(history: List[ChatMessage], new_user_content: str) -> str:
    """Calls OpenAI chat completion with recent conversation history plus the new
    user message. Mirrors the graceful-fallback pattern used for concept extraction
    in app/knowledge_graph/services.py - never raises, always returns a string the
    caller can show to the user."""
    if not _is_configured():
        logger.warning("OpenAI API Key not configured. Returning offline fallback assistant reply.")
        return FALLBACK_MESSAGE

    try:
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

    except Exception as e:
        logger.error(f"OpenAI assistant call failed: {str(e)}. Falling back to offline message.")
        return FALLBACK_MESSAGE
