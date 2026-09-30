# AI concept extraction: builds the system prompt, calls the LLM (OpenRouter, or Google directly
# under GEMINI_DIRECT) on each text chunk, sanitizes the JSON result (clean names, drop junk,
# merge duplicates) and caches it. Also hosts the shared OpenAI-client factory used by RAG.
import json
import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.config import settings
from app.core.cache import cache, content_hash
from app.observability import trace_ai_call
from app.rag.chunking import chunk_document

logger = logging.getLogger("conceptintel.generation")

# Back-compat alias for the concurrency-budget message specifically - some
# callers import this name directly. Prefer openrouter_payment_error_message()
# in new code, which also covers the separate "actually out of credits" case.
BUDGET_EXHAUSTED_MESSAGE = (
    "The AI provider is temporarily over its concurrent-request budget for this "
    "account. This clears on its own within a couple of minutes as other requests "
    "finish - please try again shortly, or add credits at "
    "https://openrouter.ai/settings/credits to raise the limit."
)

INSUFFICIENT_CREDITS_MESSAGE = (
    "This AI account is out of OpenRouter credit (or its remaining balance can't "
    "cover this request). Add credits at https://openrouter.ai/settings/credits, "
    "switch GENERATION_MODEL to a free OpenRouter model, or set GEMINI_DIRECT=true "
    "in backend/.env to use Google's free tier instead."
)


def is_budget_exhausted_error(e: Exception) -> bool:
    """True for OpenRouter's 402 'in-flight budget exhausted' response
    specifically - the transient concurrency ceiling, not a genuinely empty
    balance (see openrouter_payment_error_message for both cases together).
    Kept for existing callers; prefer openrouter_payment_error_message() below
    in new code, since it also catches the "actually out of credits" 402."""
    status_code = getattr(e, "status_code", None)
    return status_code == 402 and "in_flight_budget_exhausted" in str(e)


def openrouter_payment_error_message(e: Exception) -> Optional[str]:
    """Returns a clear, actionable message for either of OpenRouter's 402
    payment errors, or None if `e` is something else. Both are permanent for
    the current request - retrying immediately (a retry loop's default
    behavior for any exception) just burns the user's wait time on a
    guaranteed-identical failure, so every AI call site's retry loop should
    check this in its except block and raise the message immediately instead
    of looping again:

      - 'in_flight_budget_exhausted': a transient per-account concurrency
        ceiling. Clears on its own in a couple of minutes.
      - 'openrouter_credits' / 'requires more credits': the account's actual
        balance can't cover this request. Needs credits added, a smaller
        max_tokens, or a free model - won't resolve by waiting.
    """
    if getattr(e, "status_code", None) != 402:
        return None
    text = str(e)
    if "in_flight_budget_exhausted" in text:
        return BUDGET_EXHAUSTED_MESSAGE
    if "openrouter_credits" in text or "requires more credits" in text:
        return INSUFFICIENT_CREDITS_MESSAGE
    return None


# Instructions for the extraction model; {placeholders} are filled in by _build_system_prompt.
SYSTEM_PROMPT_TEMPLATE = """You are a senior academic curriculum architect and learning engineer.

You are extracting concepts for the course: "{course_name}"{course_code_suffix}.
Only extract concepts that are core subject matter for THIS specific course/subject -
you are told the course name precisely so you have a scope to judge against.

The text you receive may come from OCR (scanned pages/images) and can contain garbled
words, broken line breaks, or misrecognized characters. Silently clean and correct
obvious OCR/typo errors before extracting concepts - do not mention the cleaning in
your output, just use the corrected version internally.

=== WHAT IS NOT A CONCEPT ===

Returning an EMPTY concepts list is a CORRECT and expected answer for any chunk that
contains no teachable subject matter. Never invent concepts to avoid returning an
empty list. Title pages, syllabus tables, grading policies, reading lists and lab
rubrics all legitimately yield zero concepts.

Do NOT extract, under any circumstances:

1. Administrative or bibliographic fields. These are the single most common error.
   Real examples that were wrongly extracted from a syllabus and must never appear:
     "Credit Hours", "Code PHY", "Semester No", "TEXT AND MATERIAL", "Textbook",
     "Halliday" (a textbook author's surname), "Prerequisite Course", "Contact Hours"
   Author surnames, publisher names, edition numbers, course codes, semester labels
   and section headings from a syllabus are metadata, not knowledge.

2. Assessment and rubric vocabulary. Real examples that were wrongly extracted from a
   lab marking scheme and must never appear:
     "Group Participation", "Individual Performance", "Methodology", "Accuracy",
     "Precision", "Critical Analysis", "Results", "Equipment Handling", "Viva"
   How students are graded is not something they learn. NOTE the trap: "Accuracy" and
   "Precision" ARE genuine concepts in a measurement chapter - extract them only when
   the text actually teaches what they mean, never when it is listing marking criteria.

3. Bare discipline names or content-free abstractions. Real examples that were wrongly
   extracted and must never appear:
     "Physics", "Fundamental", "Core Concepts", "Introduction", "Overview", "Basics",
     "Chapter", "Modulus Chap"
   A concept must be narrower than the course itself. "Physics" inside an Applied
   Physics course carries no information.

4. Structural or filler text: page/slide numbers, "Example", "Note", "Figure",
   "Summary", office hours, dates, university names.

5. Passing mentions of other subjects that are not part of THIS course's curriculum.

A valid concept must be something a student would need to learn and be tested on as
part of "{course_name}" specifically. Apply this test to every candidate: can you
write a genuine 1-2 sentence academic explanation of what it MEANS, without merely
restating its own name? "Credit Hours" fails. "Bernoulli's Principle" passes. If it
fails, drop it.

=== NAMING AND GRANULARITY ===

6. Names must be canonical, self-contained noun phrases in Title Case:
   - Exactly ONE line. Never include a newline, tab, bullet, colon or numbering.
   - No course codes, chapter numbers or slide references inside the name.
   - Prefer the standard textbook term over the wording that happens to appear in
     this chunk.
   - Use the singular form for a named principle ("Newton's Second Law"), the plural
     only where the field's own convention is plural ("Maxwell's Equations").

7. ONE concept, ONE name. If this chunk discusses what is really a single idea under
   several surface forms, emit it EXACTLY ONCE under its canonical name. Merge, do not
   list variants. For example "Function", "Functions", "Functions in C", "Defining
   Functions" and "Function Definition" are ONE concept, named "Functions". Emitting
   two entries whose descriptions would be substantially the same is an error.

   This applies just as much when the wording is completely different, not just when
   it's a surface variant of the same words. "Derivative" and "Differentiation" are
   ONE concept. "Loop" and "Iteration" are ONE concept (in most courses - only split
   them if the text is genuinely teaching them as distinct ideas). Judge by MEANING,
   not by string similarity: two names that share no words at all can still be the
   same concept, and two names that look almost identical can still be genuinely
   different concepts (e.g. "Derivative" vs "Partial Derivative" are NOT the same).

8. Granularity: a concept should be roughly one lecture segment or one textbook
   section - big enough to have prerequisites and learning outcomes, small enough to
   be assessed by a few questions.

=== PREREQUISITES ===

This is the part most often got wrong. Read it carefully.

9. A prerequisite edge means STRICT CONCEPTUAL DEPENDENCY: "a student genuinely cannot
   understand B without already understanding A". It does NOT mean:
   - that A was taught before B,
   - that A appeared earlier in this document,
   - that A and B are related, similar, or in the same chapter.

10. NEVER chain concepts together just because they appeared consecutively in the
    text. This is the most common failure. Real example of what NOT to produce:
      "Charles's Law" -> "Gay-Lussac's Law" -> "Dalton's Law"
    Those are three sibling gas laws. None is a prerequisite of another. They should
    each instead depend on a shared foundation such as "Ideal Gas Law". Likewise
      "Measurement" -> "SI Units" -> "Scalars" -> "Vectors" -> "Accuracy"
    is a table of contents rendered as a chain, not a dependency structure.

11. Foundational concepts should be shared parents, not links in a chain. If several
    concepts all build on the same foundation, EVERY ONE of them must list that
    foundation as a prerequisite. A course teaching "Functions", "Function Parameters",
    "Return Values", "Recursion" and "Function Scope" must give all four dependents
    "Functions" as a prerequisite - producing a wide, shallow tree, not a line.

12. Zero prerequisites is common and correct. Foundational and sibling concepts have
    none. An empty list is far better than an invented edge.

13. No cycles, and never list a concept as its own prerequisite.

14. Prerequisites must ONLY reference other concepts extracted in this same response,
    OR one of the "already existing concepts" listed below. Spell the referenced name
    EXACTLY as it appears there.

=== OTHER RULES ===

15. Assign importance_score from 1 (minor) to 10 (foundational/critical) based on how
    central the concept is. A concept that many others depend on scores high.
16. difficulty is the difficulty FOR A STUDENT of this course: Easy, Medium or Hard.
17. If teacher-provided context/instructions are given, follow them (e.g. "these are
    CLOs, treat as authoritative outcomes" or "focus only on chapters 3-5").
{course_outline_block}{existing_concepts_block}
=== FINAL SELF-CHECK - DO THIS BEFORE YOU RESPOND ===

You are about to output a list of concepts. Before you do, compare EVERY concept in
your draft list against EVERY OTHER one in it, and separately against the "already
existing concepts" list above (if given). For each pair, ask: do these refer to the
same underlying idea, even if the wording, terminology or grammar is completely
different? ("Derivative" / "Rate of Change" / "Differentiation" is one idea spoken
three ways.) If yes, merge them into a single entry under whichever name is the
clearer, more standard term - combine their descriptions/learning outcomes rather
than picking one arbitrarily, and redirect any prerequisite that pointed at the
dropped name to point at the surviving one instead. Only after this pass is your
list ready to output. A response with two entries that a subject-matter expert would
recognize as "the same thing" is a failed response, exactly the same failure as a
mangled name or an invented prerequisite.

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
}}

If this chunk contains no teachable subject matter, respond with exactly:
{{"concepts": []}}"""


def _build_system_prompt(
    course_name: str,
    course_code: Optional[str],
    existing_concept_names: Optional[List[str]],
    course_outline: Optional[str] = None,
) -> str:
    """Fills the prompt template with course name/code, known concepts (to avoid duplicates) and the outline (scope)."""
    course_code_suffix = f" ({course_code})" if course_code else ""

    existing_concepts_block = ""
    if existing_concept_names:
        # Grounding: telling the model what's already in this course's shared graph lets it
        # recognize "this is the same concept, just reworded" up front, instead of
        # relying entirely on the post-hoc string-matching dedup in
        # knowledge_graph/revision_service.py. Capped to keep the prompt bounded for
        # courses with a very large existing graph.
        names_list = "\n".join(f"- {n}" for n in existing_concept_names[:150])
        existing_concepts_block = (
            f"\nConcepts that already exist in this course's graph - do NOT re-propose "
            f"these as new, only reference them as prerequisites if relevant:\n{names_list}\n"
        )

    course_outline_block = ""
    if course_outline and course_outline.strip():
        # The outline is scope, not source material. It is deliberately NOT chunked and
        # extracted from (doing so produced concepts like "Credit Hours" and "Halliday");
        # it is shown here so the model can judge whether a candidate concept is actually
        # part of this course, and can use the outline's own topic wording as the
        # canonical name - which is also what keeps naming stable across chunks.
        course_outline_block = (
            "\n=== COURSE OUTLINE (scope reference - do NOT extract concepts from this "
            "text itself) ===\n"
            "This is the official outline for the course. Use it to decide whether a "
            "candidate concept is in scope, and prefer its topic wording when naming "
            "concepts so names stay consistent. It is a table of contents and an "
            "administrative document: its headings, credit hours, book lists and "
            "assessment breakdowns are NOT concepts.\n"
            f"{course_outline.strip()}\n"
        )

    return SYSTEM_PROMPT_TEMPLATE.format(
        course_name=course_name,
        course_code_suffix=course_code_suffix,
        existing_concepts_block=existing_concepts_block,
        course_outline_block=course_outline_block,
    )


# Google's OpenAI-compatible endpoint (see
# https://ai.google.dev/gemini-api/docs/openai) - the ONLY base_url that actually
# draws against Google AI Studio's free-tier quota; OpenRouter serves the same
# Gemini models but always at its own paid per-token rate. Fixed, not deployment-
# specific, so it isn't an env var like OPENROUTER_BASE_URL.
GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _get_client() -> Optional[OpenAI]:
    # See config.py GEMINI_DIRECT - calls Google directly (and its free tier) when
    # enabled, instead of OpenRouter's paid rate for the same model.
    """Returns an OpenAI-SDK client for the active provider, or None if no usable API key is configured."""
    if settings.GEMINI_DIRECT:
        if not settings.GEMINI_API_KEY or settings.GEMINI_API_KEY.startswith("your_"):
            return None
        return OpenAI(api_key=settings.GEMINI_API_KEY, base_url=GEMINI_OPENAI_BASE_URL, timeout=60.0)
    if not settings.OPENROUTER_API_KEY or settings.OPENROUTER_API_KEY.startswith("your_"):
        return None
    # Explicit timeout - the openai SDK's default (600s) means a slow/hung free-tier
    # model can stall a pipeline run for ten minutes before anything notices. 60s is
    # generous for a single chunk's completion while still failing fast enough that
    # the retry loop below actually gets a chance to try again.
    return OpenAI(api_key=settings.OPENROUTER_API_KEY, base_url=settings.OPENROUTER_BASE_URL, timeout=60.0)


def _reasoning_extra_body() -> dict:
    """The `reasoning` field (used everywhere in this codebase to turn off a
    reasoning model's chain-of-thought token spend, since every call here wants a
    direct answer, not visible thinking) is an OpenRouter-specific extension, not a
    real OpenAI or Gemini API field. Google's OpenAI-compatible endpoint validates
    the request body strictly and 400s on any field it doesn't recognize
    ('Unknown name "reasoning": Cannot find field') - confirmed by an actual call,
    not assumed. Every call site must build extra_body through this helper instead
    of hardcoding the literal dict, so GEMINI_DIRECT doesn't break every single one
    of them at once."""
    if settings.GEMINI_DIRECT:
        return {}
    return {"reasoning": {"exclude": True}}


# Google AI Studio's free tier caps gemini-3.5-flash-lite at 15 requests/minute
# PER PROJECT (confirmed live: "Quota exceeded ... limit: 15 ... Please retry in
# 4.65s"). Nothing before this enforced any spacing between calls - a multi-chunk
# job (knowledge-graph extraction is the worst case: one call per chunk, fired
# back-to-back with zero delay, plus its own 3 retries with no backoff either)
# could burn through 15 requests in a couple of seconds and then fail outright.
# 4.5s between calls keeps 60s/4.5s ≈ 13 requests/minute - under the cap with
# margin, rather than exactly at it. Only applies under GEMINI_DIRECT; OpenRouter
# has its own, much higher limits this app hasn't hit.
_GEMINI_FREE_TIER_MIN_INTERVAL_SECONDS = 4.5
_last_gemini_call_lock = threading.Lock()
_last_gemini_call_at = 0.0


def _throttle_for_free_tier() -> None:
    """Blocks just long enough to keep this process's Gemini calls under the
    free-tier per-minute cap. Call this immediately before every
    client.chat.completions.create() that might hit GEMINI_DIRECT. A no-op when
    GEMINI_DIRECT is off."""
    if not settings.GEMINI_DIRECT:
        return
    global _last_gemini_call_at
    with _last_gemini_call_lock:
        wait = _GEMINI_FREE_TIER_MIN_INTERVAL_SECONDS - (time.monotonic() - _last_gemini_call_at)
        if wait > 0:
            time.sleep(wait)
        _last_gemini_call_at = time.monotonic()


def _extract_retry_delay_seconds(error: Exception, default: float = 20.0) -> float:
    """Pulls the server-suggested wait out of a 429's error body (Gemini's
    RetryInfo.retryDelay, e.g. "4s") instead of guessing - falls back to a
    conservative fixed delay when the shape doesn't match (a different provider,
    a changed error format, etc.). Used only when a 429 actually happens - the
    pacing in _throttle_for_free_tier above is what avoids needing this most of
    the time."""
    match = re.search(r"retryDelay['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)s?", str(error))
    if match:
        try:
            return max(float(match.group(1)), 1.0) + 1.0  # +1s safety margin
        except ValueError:
            pass
    return default


# Names that are never concepts no matter how confidently the model proposes them.
# Compared against the normalized (lowercased, whitespace-collapsed) name. This is a
# backstop for the prompt, not a replacement for it - every entry here was actually
# observed in this project's own Neo4j graph.
_NEVER_A_CONCEPT = {
    # syllabus / bibliographic metadata
    "credit hours", "contact hours", "code", "course code", "semester", "semester no",
    "text and material", "textbook", "text book", "reference book", "reference books",
    "prerequisite", "prerequisite course", "instructor", "office hours", "grading policy",
    "marks distribution", "course title", "edition", "publisher", "author",
    # rubric / assessment vocabulary
    "group participation", "individual performance", "equipment handling", "viva",
    "presentation", "attendance", "assignment", "quiz", "midterm", "final exam",
    # content-free abstractions
    "introduction", "overview", "basics", "fundamental", "fundamentals", "core concepts",
    "summary", "conclusion", "chapter", "topics", "contents", "objectives", "example",
    "note", "figure", "table", "results", "methodology",
    # Discourse/transition words - a poorly-OCR'd or garbled source can hand the
    # extractor a sentence fragment starting with one of these, and it gets proposed
    # as a "concept" verbatim. All observed live in this project's own Neo4j graph
    # (a Digital Logic Design catalog had 20+ of these as top-level nodes): they are
    # connectives, never topics, in any subject.
    "however", "therefore", "nevertheless", "nonetheless", "although", "because",
    "before", "during", "finally", "furthermore", "indeed", "instead", "likewise",
    "obviously", "otherwise", "rather", "similarly", "suppose", "assuming", "assume",
    "unfortunately", "unlike", "whatever", "conversely", "consequently", "moreover",
    "meanwhile", "regardless", "besides", "additionally", "accordingly", "consider",
    "another", "except", "possible", "typically", "verbally", "actually", "formally",
    "equivalently", "essential", "important", "luckily", "theoretically",
}

# Patterns for administrative junk that an exact blacklist can't catch, because the
# noise words appear inside a longer string. All observed in the live graph:
# "Code \nPHY", "Applied Physics \nSemester No", "Modulus Chap".
# Regex patterns for junk names that cannot be listed literally.
_NEVER_A_CONCEPT_PATTERNS = [
    re.compile(r"^(course\s+)?code\b", re.I),          # "Code PHY"
    re.compile(r"\bsemester\s*(no|number)?\b", re.I),  # "Applied Physics Semester No"
    re.compile(r"\bcredit\s+hours?\b", re.I),
    re.compile(r"\bcontact\s+hours?\b", re.I),
    # \d+ not \d* on purpose: with \d* this also matched any concept whose name merely
    # ENDS in one of these words, silently deleting legitimate concepts like
    # "Cross Section", "Conic Section" or "Control Unit".
    re.compile(r"\b(chap|chapter|sec|section|unit|week|lecture)\s*\.?\s*\d+$", re.I),
    re.compile(r"^(page|slide)\s*\d+", re.I),
    re.compile(r"^[A-Z]{2,4}[\s\-]?\d{3,4}$"),         # bare course codes: "PHY 101", "CS-101"
    re.compile(r"^\W+$"),                              # punctuation-only
    # OCR/extraction noise: the same letter repeated 3+ times in a row is
    # essentially never a real word in any language this app targets - observed
    # live as "EEEEEEEE FFFFFFFFFFFFFFFFFFFFFFF" and similar garbage proposed as
    # a concept name from a badly-scanned source.
    re.compile(r"(.)\1{2,}", re.I),
]

# Collapses any run of whitespace (including the literal newlines that put 52 broken
# names like "Code \nPHY" into the live graph) into single spaces.
_WS_RUN = re.compile(r"\s+")

# Everything that is not a letter, digit or space. Removed when building the dedup
# key so "Bernoulli's Principle" and "Bernoullis Principle" collapse to one concept.
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")


def _dedup_key(name: str) -> str:
    """Aggressive comparison key for 'is this the same concept?'.

    Punctuation is stripped and a trailing plural 's' is removed from each word, so
    all of these collapse to one key: "Function", "Functions", "function's".
    This is the check that stops the graph accumulating several rows for what a
    teacher considers a single topic - the specific complaint that motivated it was
    a course carrying multiple separate "Functions" nodes.

    Used ONLY for comparison; the displayed name is always the canonical one.
    """
    base = _NON_ALNUM.sub("", _WS_RUN.sub(" ", (name or "").lower())).strip()
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in base.split()]
    return " ".join(words)


def _is_never_a_concept(name: str) -> bool:
    """True if the name is on the blacklist or matches a junk pattern (administrative/filler text)."""
    key = (name or "").strip().lower()
    if key in _NEVER_A_CONCEPT:
        return True
    if _dedup_key(name) in {_dedup_key(n) for n in _NEVER_A_CONCEPT}:
        return True
    return any(p.search(name or "") for p in _NEVER_A_CONCEPT_PATTERNS)


def normalize_concept_name(name: str) -> str:
    """Canonical form of a concept name: single line, no leading list markers or
    numbering, no surrounding punctuation, whitespace collapsed.

    Applied to every extracted name AND every prerequisite reference, because the
    Neo4j node id is derived from the name (knowledge_graph/services.build_node_id)
    and MERGE keys on it - so "Functions" and "Functions " are two different nodes.
    """
    if not name:
        return ""
    cleaned = _WS_RUN.sub(" ", str(name)).strip()
    cleaned = re.sub(r"^[\-\*•–—]+\s*", "", cleaned)   # leading bullets/dashes
    cleaned = re.sub(r"^\d+[\.\)]\s*", "", cleaned)                     # leading "3." / "3)"
    return cleaned.strip(" .;:,-").strip()


def _sanitize_extraction(data: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize, filter and de-duplicate one chunk's extraction result.

    The prompt does the real work; this guarantees the invariants the graph layer
    depends on regardless of what the model returns:
      * every name is a single clean line (Neo4j ids are built from names)
      * no blacklisted administrative/rubric junk survives
      * a chunk never yields the same concept twice under different spellings
      * no concept is its own prerequisite, and prerequisite names are normalized
        so they actually match the concept names they refer to
    """
    concepts = data.get("concepts")
    if not isinstance(concepts, list):
        return {"concepts": []}

    kept: List[Dict[str, Any]] = []
    seen: Dict[str, Dict[str, Any]] = {}
    for c in concepts:
        if not isinstance(c, dict):
            continue
        name = normalize_concept_name(c.get("name", ""))
        if not name or len(name) < 2:
            continue
        key = _dedup_key(name)
        if not key:
            continue
        if _is_never_a_concept(name):
            logger.info("Dropped non-concept %r (administrative/rubric/filler)", name)
            continue
        # Prerequisites are normalized BEFORE the duplicate check, because the merge
        # branch below has to be able to combine two already-clean lists. Doing it
        # afterwards meant a merged duplicate copied the raw, unnormalized
        # prerequisites straight over the cleaned ones - reintroducing exactly the
        # newline-laden names and self-loops this function exists to remove.
        prereqs = c.get("prerequisites") or []
        if not isinstance(prereqs, list):
            prereqs = []
        normalized_prereqs = []
        for p in prereqs:
            pn = normalize_concept_name(p if isinstance(p, str) else "")
            if not pn or _dedup_key(pn) == key:      # drop self-loops (observed: Equilibrium -> Equilibrium)
                continue
            if _is_never_a_concept(pn):
                continue
            if pn not in normalized_prereqs:
                normalized_prereqs.append(pn)

        if key in seen:
            # Same concept twice in one response. Keep the richer description, and
            # UNION the prerequisites rather than letting one copy's list win - each
            # mention may legitimately name a different dependency.
            existing = seen[key]
            if len(c.get("description") or "") > len(existing.get("description") or ""):
                existing["description"] = c.get("description")
                for field in ("difficulty", "importance_score", "learning_outcomes"):
                    if c.get(field):
                        existing[field] = c[field]
            for pn in normalized_prereqs:
                if pn not in existing["prerequisites"]:
                    existing["prerequisites"].append(pn)
            continue

        entry = dict(c)
        entry["name"] = name
        entry["prerequisites"] = normalized_prereqs
        seen[key] = entry
        kept.append(entry)

    return {"concepts": kept}


@trace_ai_call("concept-extraction")
def clean_and_structure_chunk(
    chunk: str,
    course_name: str,
    course_code: Optional[str] = None,
    teacher_notes: Optional[str] = None,
    existing_concept_names: Optional[List[str]] = None,
    course_outline: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Calls the configured generation model (settings.GENERATION_MODEL, via OpenRouter
    or Google directly under GEMINI_DIRECT) to clean OCR/typo noise and extract
    structured concepts from one text chunk, scoped to a specific course and
    grounded against that course's already-existing concepts. Results are cached by
    content hash so retrying a failed pipeline run, or re-uploading the same
    material, doesn't re-spend tokens.
    """
    # course_code and course_outline are part of the key because both change the
    # system prompt - omitting course_code previously meant editing a course's code
    # returned a stale extraction.
    cache_key = (
        "genai:extract:"
        + content_hash(
            chunk,
            course_name,
            course_code or "",
            teacher_notes or "",
            ",".join(existing_concept_names or []),
            course_outline or "",
        )
    )
    cached = cache.get_json(cache_key)
    if cached is not None:
        logger.info("Concept extraction cache hit for chunk (len=%d)", len(chunk))
        return cached

    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to run the "
            "content processing pipeline. See https://openrouter.ai/keys."
        )

    system_prompt = _build_system_prompt(course_name, course_code, existing_concept_names, course_outline)

    user_content = f"Analyze this educational content and extract concepts:\n\n{chunk}"
    if teacher_notes:
        user_content += f"\n\nTeacher-provided context/instructions:\n{teacher_notes}"

    # Free-tier OpenRouter models have been observed occasionally returning
    # malformed/truncated JSON despite response_format={"type": "json_object"} -
    # that's a request hint, not a hard guarantee on every provider. Retry a few
    # times before giving up, since a repeat call with the same input frequently
    # succeeds where the first one didn't.
    last_error = None
    for attempt in range(3):
        try:
            _throttle_for_free_tier()
            started = time.monotonic()
            logger.warning("Generation request starting (attempt %d/3, model=%s)", attempt + 1, settings.GENERATION_MODEL)
            response = client.chat.completions.create(
                model=settings.GENERATION_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.15,
                # A reasoning model (Kimi's k2.5 was the one that surfaced this)
                # spends tokens on internal "thinking" (reasoning_details) BEFORE
                # the actual answer. With max_tokens=4000 (tuned for an older,
                # non-reasoning model), a long chunk's reasoning alone could consume the whole budget,
                # leaving finish_reason="length" and message.content=None - the
                # exact "JSON object must be str... not NoneType" crash this was
                # hitting on every single attempt (not a transient fluke, so all 3
                # retries failed identically and burned tokens for nothing).
                # extra_body excludes reasoning tokens entirely for this call
                # (concept extraction needs a direct JSON answer, not chain-of-
                # thought) - max_tokens is also raised as a safety margin in case
                # a provider ignores that hint.
                max_tokens=8000,
                timeout=60.0,
                extra_body=_reasoning_extra_body(),
            )
            logger.warning("Generation request finished in %.1fs", time.monotonic() - started)
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(
                    f"Model returned empty content (finish_reason={response.choices[0].finish_reason}) - "
                    "likely ran out of tokens before producing an answer."
                )
            data = _sanitize_extraction(json.loads(raw_content))
            cache.set_json(cache_key, data)
            return data
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Generation model returned malformed/empty content on attempt %d/3: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            if getattr(e, "status_code", None) == 429:
                # A genuine 429 means the per-minute quota is already blown for
                # this window - retrying immediately (the previous behavior) just
                # burns the attempt on the same still-exhausted quota. Sleep for
                # what the server actually told us to wait (RetryInfo.retryDelay)
                # instead of guessing, then retry for real.
                delay = _extract_retry_delay_seconds(e)
                logger.warning(
                    "Generation API call rate-limited on attempt %d/3, waiting %.1fs before retry: %s",
                    attempt + 1, delay, str(e),
                )
                if attempt < 2:
                    time.sleep(delay)
            else:
                # Covers timeouts and other transient API/network errors - same
                # rationale as the JSON case: a repeat call frequently succeeds.
                logger.warning("Generation API call failed on attempt %d/3: %s: %s", attempt + 1, type(e).__name__, str(e))

    raise RuntimeError(f"Generation call failed after 3 attempts: {last_error}")


def structure_full_text(
    text: str,
    course_name: str,
    course_code: Optional[str] = None,
    teacher_notes: Optional[str] = None,
    existing_concept_names: Optional[List[str]] = None,
    course_outline: Optional[str] = None,
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
    logger.info("Structuring %d chunk(s) via %s for course '%s'", len(chunks), settings.GENERATION_MODEL, course_name)

    # Names accumulate across chunks. Each chunk used to be extracted blind to every
    # other chunk, so a concept spanning three chunks came back three times under
    # three spellings ("Functions", "Functions in C", "Defining Functions") and all
    # three survived into the graph as separate nodes. Feeding names discovered so far
    # back in as "already existing" makes the model reuse the canonical name and
    # reference it as a prerequisite instead of re-proposing it.
    known_names: List[str] = list(existing_concept_names or [])
    known_lower = {n.strip().lower() for n in known_names}

    results = []
    for i, chunk in enumerate(chunks):
        try:
            result = clean_and_structure_chunk(
                chunk.text, course_name, course_code, teacher_notes, known_names, course_outline
            )
        except Exception as e:
            logger.error("Concept extraction failed for chunk %d/%d: %s", i + 1, len(chunks), str(e))
            raise

        for c in result.get("concepts", []):
            name = (c.get("name") or "").strip()
            if name and name.lower() not in known_lower:
                known_names.append(name)
                known_lower.add(name.lower())
        results.append(result)

    logger.info(
        "Extraction produced %d distinct concept name(s) across %d chunk(s)",
        len(known_names) - len(existing_concept_names or []), len(chunks),
    )
    return results
