import json
import logging
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.config import settings
from app.core.cache import cache, content_hash
from app.observability import trace_ai_call
from app.rag.chunking import chunk_document

logger = logging.getLogger("conceptintel.kimi")

SYSTEM_PROMPT_TEMPLATE = """You are a senior academic curriculum architect and learning engineer.

You are extracting concepts for the course: "{course_name}"{course_code_suffix}.
Only extract concepts that are core subject matter for THIS specific course/subject -
you are told the course name precisely so you have a scope to judge against.

The text you receive may come from OCR (scanned pages/images) and can contain garbled
words, broken line breaks, or misrecognized characters. Silently clean and correct
obvious OCR/typo errors before extracting concepts - do not mention the cleaning in
your output, just use the corrected version internally.

Do NOT extract:
- Course/document metadata (course title, code, instructor name, semester, dates,
  university name)
- Structural or administrative text (section headers like "Introduction"/"Summary",
  page/slide numbers, grading policy, office hours, references/citations)
- Passing mentions of other subjects that are not part of THIS course's own curriculum
- Generic filler nouns that aren't actual teachable subject knowledge (e.g. "Example",
  "Note", "Figure")

A valid concept must be something a student would need to learn and be tested on as
part of "{course_name}" specifically. If you can't write a genuine 1-2 sentence
academic explanation of why it belongs in this course, it isn't a concept.

IMPORTANT RULES:
1. Avoid near-duplicate concepts - if two concepts are closely related, merge them into
   the more descriptive one.
2. Each concept must be a complete, learnable unit of knowledge.
3. Prerequisites must ONLY reference other concepts extracted in this same response,
   OR one of the "already existing concepts" listed below.
4. Assign importance_score from 1 (minor) to 10 (foundational/critical) based on how
   central the concept is.
5. If teacher-provided context/instructions are given, follow them (e.g. "these are
   CLOs, treat as authoritative outcomes" or "focus only on chapters 3-5").
{existing_concepts_block}
Respond ONLY with valid JSON in this exact format:
{{
  "concepts": [
    {{
      "name": "Concept Name",
      "description": "Precise 1-2 sentence explanation of what this concept covers",
      "difficulty": "Easy|Medium|Hard",
      "importance_score": 7,
      "learning_outcomes": "After studying this, students will be able to...",
      "prerequisites": ["Prerequisite Concept Name 1"]
    }}
  ]
}}"""


def _build_system_prompt(course_name: str, course_code: Optional[str], existing_concept_names: Optional[List[str]]) -> str:
    course_code_suffix = f" ({course_code})" if course_code else ""

    existing_concepts_block = ""
    if existing_concept_names:
        # Grounding: telling Kimi what's already in this course's shared graph lets it
        # recognize "this is the same concept, just reworded" up front, instead of
        # relying entirely on the post-hoc string-matching dedup in
        # knowledge_graph/revision_service.py. Capped to keep the prompt bounded for
        # courses with a very large existing graph.
        names_list = "\n".join(f"- {n}" for n in existing_concept_names[:150])
        existing_concepts_block = (
            f"\nConcepts that already exist in this course's graph - do NOT re-propose "
            f"these as new, only reference them as prerequisites if relevant:\n{names_list}\n"
        )

    return SYSTEM_PROMPT_TEMPLATE.format(
        course_name=course_name,
        course_code_suffix=course_code_suffix,
        existing_concepts_block=existing_concepts_block,
    )


def _get_client() -> Optional[OpenAI]:
    if not settings.OPENROUTER_API_KEY or settings.OPENROUTER_API_KEY.startswith("your_"):
        return None
    # Explicit timeout - the openai SDK's default (600s) means a slow/hung free-tier
    # model can stall a pipeline run for ten minutes before anything notices. 60s is
    # generous for a single chunk's completion while still failing fast enough that
    # the retry loop below actually gets a chance to try again.
    return OpenAI(api_key=settings.OPENROUTER_API_KEY, base_url=settings.OPENROUTER_BASE_URL, timeout=60.0)


@trace_ai_call("kimi-concept-extraction")
def clean_and_structure_chunk(
    chunk: str,
    course_name: str,
    course_code: Optional[str] = None,
    teacher_notes: Optional[str] = None,
    existing_concept_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Calls Kimi K2 (via OpenRouter) to clean OCR/typo noise and extract structured
    concepts from one text chunk, scoped to a specific course and grounded against
    that course's already-existing concepts. Results are cached by content hash so
    retrying a failed pipeline run, or re-uploading the same material, doesn't
    re-spend tokens.
    """
    cache_key = f"kimi:extract:{content_hash(chunk, course_name, teacher_notes or '', ','.join(existing_concept_names or []))}"
    cached = cache.get_json(cache_key)
    if cached is not None:
        logger.info("Kimi extraction cache hit for chunk (len=%d)", len(chunk))
        return cached

    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to run the "
            "content processing pipeline. See https://openrouter.ai/keys."
        )

    system_prompt = _build_system_prompt(course_name, course_code, existing_concept_names)

    user_content = f"Analyze this educational content and extract concepts:\n\n{chunk}"
    if teacher_notes:
        user_content += f"\n\nTeacher-provided context/instructions:\n{teacher_notes}"

    # Free-tier OpenRouter models have been observed occasionally returning
    # malformed/truncated JSON despite response_format={"type": "json_object"} -
    # that's a request hint, not a hard guarantee on every provider. Retry a few
    # times before giving up, since a repeat call with the same input frequently
    # succeeds where the first one didn't.
    import time
    last_error = None
    for attempt in range(3):
        try:
            started = time.monotonic()
            logger.warning("Kimi request starting (attempt %d/3, model=%s)", attempt + 1, settings.KIMI_MODEL)
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.15,
                # 2000 was too small - confirmed via finish_reason="length" cutting
                # JSON off mid-string on real chunks with this model. 4000 gives
                # enough headroom for a full concepts array without truncating.
                max_tokens=4000,
                timeout=60.0,
            )
            logger.warning("Kimi request finished in %.1fs", time.monotonic() - started)
            raw_content = response.choices[0].message.content
            data = json.loads(raw_content)
            cache.set_json(cache_key, data)
            return data
        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(
                "Kimi returned malformed JSON on attempt %d/3 (finish_reason=%s): %s",
                attempt + 1, response.choices[0].finish_reason, str(e)
            )
        except Exception as e:
            # Covers timeouts and other transient API/network errors - same
            # rationale as the JSON case: a repeat call frequently succeeds.
            last_error = e
            logger.warning("Kimi API call failed on attempt %d/3: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Kimi call failed after 3 attempts: {last_error}")


def structure_full_text(
    text: str,
    course_name: str,
    course_code: Optional[str] = None,
    teacher_notes: Optional[str] = None,
    existing_concept_names: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Chunks the full extracted text (token-aware, via app/rag/chunking.py - the same
    chunker used for RAG, better boundaries than a naive char-count split) and runs
    clean_and_structure_chunk over each chunk, returning the raw list of per-chunk
    extraction results (concepts may repeat/overlap across chunks - deduplication
    happens later, when diffing against the existing catalog graph).
    """
    if not text.strip():
        return []

    chunks = chunk_document(text)
    logger.info("Structuring %d chunk(s) via Kimi K2 for course '%s'", len(chunks), course_name)

    results = []
    for i, chunk in enumerate(chunks):
        try:
            results.append(clean_and_structure_chunk(
                chunk.text, course_name, course_code, teacher_notes, existing_concept_names
            ))
        except Exception as e:
            logger.error("Kimi extraction failed for chunk %d/%d: %s", i + 1, len(chunks), str(e))
            raise
    return results
