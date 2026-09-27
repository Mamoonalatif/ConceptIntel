"""AI authoring of playable, self-contained HTML mini-games for a single
knowledge-graph concept - the interactive half of the Gamification module. A
student picks a concept, this module asks the model to write an ENTIRE web page,
and app/gamification/game_routes.py serves that page back to the browser.

WHY FULLY FREEFORM, NOT A TEMPLATE LIBRARY
------------------------------------------
The obvious alternative - and the one every other generator in this project uses
(see app/content_generation/service.py) - is a fixed schema: ask the model for
{"pairs": [...]} and render it with our own hand-written matching-game component.
That is strictly safer, always renders, and was deliberately rejected here.

The reason is that a template can only ever produce the handful of game shapes we
thought to build. "Teach me pointer arithmetic" and "teach me the Krebs cycle"
want genuinely different interactions - a memory-address visualiser and a cyclic
drag-and-drop diagram - and no reasonable set of templates covers both. Letting
the model author the whole page is the only way the *game mechanic itself* can be
chosen to suit the concept, which is the entire pedagogical point. The accepted
cost is variance: some generated games will be uglier or less clever than others.

WHAT WE REFUSE TO ACCEPT AS A COST
----------------------------------
A blank page. "Freeform" is a licence for the model to choose the mechanic, not a
licence for us to ship an empty <body> to a student. So every generation is put
through validate_game_html() - a deliberately cheap, purely STRUCTURAL check
(does it look like a whole document, does it contain script, is it long enough to
be a real page, does it reference anything off-origin). We do not attempt to
verify the game is *fun* or even that its JavaScript runs; that would need a
headless browser and is out of scope. We only guarantee the page is not obviously
dead on arrival, and we tell the model exactly what it got wrong on the retry.

WHY THE "NO EXTERNAL REFERENCE" CHECK IS A HARD FAILURE
-------------------------------------------------------
The play endpoint serves this HTML under `default-src 'none'` (see
game_routes.py for the full directive-by-directive rationale). A page that pulls
in a CDN copy of a game framework, a Google font, or an image by URL will
therefore load with those requests blocked and will usually render as a broken
half-page. The CSP is not negotiable - the document is untrusted LLM output - so
the page has to be genuinely self-contained, and catching that here (where we can
regenerate) is far better than catching it in the student's browser (where we
cannot).

Retry shape and the OpenRouter call parameters follow the project convention
established in app/content_processing/kimi_service.py.
"""
import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from app.config import settings
from app.content_processing.kimi_service import _get_client, is_budget_exhausted_error, BUDGET_EXHAUSTED_MESSAGE
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.gamification.games")

VALID_DIFFICULTIES = ("Easy", "Medium", "Hard")

# Authoring a full page is by far the largest single completion in this project -
# a polished game is comfortably 6-10k tokens of HTML/CSS/JS. Anything smaller
# truncates mid-</script> and produces exactly the blank page this module exists
# to prevent.
# Settable because it is also the one knob that decides whether this feature fits in
# a given OpenRouter balance: the API refuses the request outright (402) if the
# account cannot afford max_tokens, regardless of how many tokens the answer would
# actually have used.
GAME_MAX_TOKENS = int(os.getenv("GAME_MAX_TOKENS", "16000"))

# Deliberately higher than the project-wide 60.0s used for every other chat call.
# 16000 tokens of generated markup does not come back in a minute; a 60s deadline
# here would not "fail fast", it would fail *always*, three times, and then raise.
# Still an explicit finite value rather than the openai SDK's 600s default, which
# is the actual reason the 60s convention exists (see kimi_service._get_client).
GAME_CALL_TIMEOUT = 180.0

# Structural floor for "this is a real page, not a stub". A genuine playable game
# with inlined styles and logic is several kilobytes; anything under this is a
# skeleton the model gave up on partway through.
MIN_HTML_CHARS = 1200

# src=/href= pointing at an absolute URL (http://, https://) or a protocol-relative
# one (//cdn...). data: URIs and same-document fragments (#id) are fine and are
# intentionally NOT matched - img-src data: is permitted by the play endpoint's CSP.
_EXTERNAL_ATTR_RE = re.compile(r"""(?:src|href)\s*=\s*["']?\s*(?:https?:)?//""", re.IGNORECASE)

# The same failure expressed through CSS instead of an attribute - @import url(...)
# or background:url(https://...). Blocked by the CSP identically, so it is the same
# broken page from the student's point of view.
_EXTERNAL_CSS_URL_RE = re.compile(r"""url\(\s*["']?\s*(?:https?:)?//""", re.IGNORECASE)


GAME_SYSTEM_PROMPT = """You are a senior front-end engineer and instructional designer. You write small,
polished, genuinely educational browser games - one game, about one concept, in
one file.

YOUR OUTPUT IS A COMPLETE WEB PAGE
Return ONE complete, self-contained HTML document: the literal string "<!doctype html>"
through the closing "</html>" tag. Every line of CSS must be inside a <style> tag and
every line of JavaScript inside a <script> tag, in that same document.

ABSOLUTE RULE - NO EXTERNAL REQUESTS OF ANY KIND
The page is served under a restrictive Content-Security-Policy of
`default-src 'none'` and every off-origin request will be BLOCKED by the browser.
A page that depends on one will render broken and be rejected. Therefore:
- NO <script src="...">. No CDN. No React, no jQuery, no Phaser, no Three.js, no
  confetti library, no anything. Write plain vanilla JavaScript by hand.
- NO <link rel="stylesheet">. No Google Fonts, no Font Awesome, no icon packs.
  Use the CSS system font stack and Unicode characters/emoji for icons.
- NO <img src="http...">, no background-image pointing at a URL, no @import,
  no fetch()/XMLHttpRequest/WebSocket, no external audio or video.
- If you want graphics, DRAW them: inline <svg>, a <canvas>, CSS shapes and
  gradients, or emoji. Inline `data:` URIs are the only URI form permitted.

THE GAME MUST ACTUALLY TEACH THE CONCEPT
This is a learning tool, not a reskinned quiz with a timer. The interaction itself
should carry the idea: if the concept is a process, make the player order or run
its steps; if it is a classification, make them sort things; if it is a
relationship between quantities, make them manipulate one and observe the other.
Choose whatever mechanic genuinely fits this specific concept - matching, sorting,
building, simulation, tower defence, a guided puzzle, a dungeon of questions.
Reward correct reasoning with a short explanation of WHY it was correct, not just
a tick. Every question and every piece of feedback must be factually correct.

REQUIRED BEHAVIOUR
- Playable with mouse AND touch AND keyboard. Every interactive element must be
  reachable by Tab and activatable by Enter/Space; add arrow-key controls where
  the mechanic suggests them. Use real <button> elements for anything clickable
  and give non-obvious controls an aria-label.
- Responsive: usable from a 360px-wide phone up to a wide desktop. No fixed pixel
  layouts that overflow, no horizontal scrolling.
- Show a visible, live score and a short instructions/help area the player can
  read before starting.
- Visually polished and dark-friendly: a dark background with high-contrast
  foreground text by default, generous spacing, rounded corners, smooth CSS
  transitions. It should look like a designed product, not a debug page.
- Finite and finishable - it must reach a clear end state with a final summary of
  what the player got right and wrong.

REPORTING THE SCORE BACK - MANDATORY
When the game ends, call EXACTLY this, once:

  window.parent.postMessage({ type: 'conceptintel:game-complete', score: <number 0-100> }, '*');

`score` is an integer percentage from 0 to 100 reflecting how well the player
demonstrated understanding of the concept. Wrap the call in a try/catch so a
failure there can never break the page. Also offer a "Play again" control that
resets the game state.

RESPOND WITH JSON ONLY, in exactly this shape:
{"title": "...", "game_kind": "...", "html": "<!doctype html>..."}

- "title": a short, appealing name for the game (under 60 characters).
- "game_kind": your own lowercase-hyphenated label for the mechanic you chose,
  e.g. "matching", "sorting", "step-sequencer", "simulation", "quiz-runner".
- "html": the ENTIRE document as a single JSON string. It must be valid JSON, so
  escape every double quote and newline correctly. Do not wrap it in markdown
  code fences. Do not truncate it."""


GAME_USER_PROMPT = """Concept: {concept_name}
{description_block}{difficulty_block}{context_block}

Design and write a complete HTML game that teaches "{concept_name}" to a university
student. Choose the game mechanic that best suits this particular concept."""


_DIFFICULTY_GUIDANCE = {
    "Easy": (
        "\nTarget difficulty: EASY. The player should be practising recall and "
        "recognition of the core definition and vocabulary. Keep each round to a "
        "single step, be generous with hints, and make wrong options clearly wrong."
    ),
    "Medium": (
        "\nTarget difficulty: MEDIUM. The player should have to apply the concept to "
        "concrete situations, not just restate it. Wrong options should reflect real, "
        "common misunderstandings rather than obvious nonsense."
    ),
    "Hard": (
        "\nTarget difficulty: HARD. The player should have to reason across multiple "
        "steps, compare competing approaches, and recognise edge cases where the "
        "concept does not apply. Make difficulty come from genuine conceptual demand, "
        "never from vague wording, hidden controls, or artificial time pressure."
    ),
}

_GROUNDING_BLOCK = (
    "\n\nExcerpts from this course's own uploaded material follow. Build the game's "
    "questions, examples, terminology and notation out of THESE - they are what the "
    "course actually taught and what the student will be assessed on. Prefer the "
    "course's own phrasing over the standard textbook phrasing you already know, and "
    "do not introduce methods or notation the excerpts never use. Where the excerpts "
    "are silent, fall back to standard knowledge rather than inventing "
    "course-specific detail.\n\n{excerpts}"
)

# Appended to the user turn on a retry so the second attempt is a targeted repair
# rather than a blind reroll. Naming the exact structural fault is what makes the
# retry worth spending a second 16k-token completion on.
_REPAIR_INSTRUCTION = (
    "\n\nIMPORTANT - your previous attempt was REJECTED by an automated structural "
    "check for this reason:\n\n  {reason}\n\nWrite the game again from scratch and "
    "make sure that specific problem is fixed. Remember: one complete document from "
    "<!doctype html> to </html>, all CSS and JS inlined, and not a single reference "
    "to any external URL."
)


def normalize_difficulty(value: Optional[str]) -> str:
    """Accepts any casing, falls back to Medium. Permissive on purpose - the value
    may arrive from a client, from a Neo4j concept property, or be absent entirely
    (same contract as content_generation.service.normalize_difficulty)."""
    if not value:
        return "Medium"
    cleaned = str(value).strip().capitalize()
    return cleaned if cleaned in VALID_DIFFICULTIES else "Medium"


def _client_or_raise():
    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to enable "
            "game generation. See https://openrouter.ai/keys."
        )
    return client


def validate_game_html(html: str) -> List[str]:
    """Cheap structural gate on an LLM-authored page. Returns a list of human-readable
    problems - empty means the page passed.

    Every check here answers "would a student opening this see something?", not "is
    this good HTML". We deliberately do NOT parse the document or execute it: a real
    verdict on whether the JavaScript works needs a headless browser, which would add
    a heavyweight dependency and seconds of latency to every generation for a
    guarantee we still could not fully make. These five checks catch the failure modes
    actually observed from freeform page generation - truncation, prose instead of
    markup, a stub skeleton, and CDN dependencies.
    """
    problems: List[str] = []

    if not html or not html.strip():
        return ["The html field was empty."]

    stripped = html.strip()
    lowered = stripped.lower()

    # 1. It has to be a whole document. A missing </html> is the signature of a
    #    completion that hit max_tokens partway through.
    if "<html" not in lowered:
        problems.append("The document has no opening <html> tag, so it is not a complete page.")
    if "</html>" not in lowered:
        problems.append(
            "The document has no closing </html> tag - it was cut off before it "
            "finished. Write a shorter, tighter game so the whole page fits."
        )

    # 2. No <script> means nothing is interactive, which means it is not a game.
    if "<script" not in lowered:
        problems.append("The document contains no <script> tag, so it has no game logic at all.")

    # 3. Length floor - catches the "valid but empty skeleton" case that passes
    #    every tag check above.
    if len(stripped) < MIN_HTML_CHARS:
        problems.append(
            f"The document is only {len(stripped)} characters, which is too short to be "
            f"a real playable game (expected at least {MIN_HTML_CHARS})."
        )

    # 4/5. Anything off-origin is dead on arrival under the play endpoint's CSP.
    if _EXTERNAL_ATTR_RE.search(stripped):
        problems.append(
            "The document has a src= or href= pointing at an external URL. Every "
            "external request is blocked by the page's Content-Security-Policy - "
            "inline the script/stylesheet, or draw the asset with SVG/CSS/emoji instead."
        )
    if _EXTERNAL_CSS_URL_RE.search(stripped):
        problems.append(
            "The document's CSS references an external URL via url(...) or @import. "
            "These are blocked too - use CSS gradients, inline SVG or a data: URI."
        )

    return problems


def _build_user_prompt(
    concept_name: str,
    concept_description: str,
    difficulty: str,
    rag_context: str,
) -> str:
    description_block = f"Description: {concept_description}\n" if concept_description else ""
    difficulty_block = _DIFFICULTY_GUIDANCE[normalize_difficulty(difficulty)]
    context_block = _GROUNDING_BLOCK.format(excerpts=rag_context) if rag_context else ""
    return GAME_USER_PROMPT.format(
        concept_name=concept_name,
        description_block=description_block,
        difficulty_block=difficulty_block,
        context_block=context_block,
    )


@trace_ai_call("gamification-game-generation")
def generate_concept_game(
    concept_name: str,
    concept_description: str = "",
    difficulty: str = "Medium",
    rag_context: str = "",
) -> Dict[str, Any]:
    """Author one complete, self-contained HTML game for a single concept.

    Returns {"title": str, "game_kind": str, "html": str} where html is a full
    standalone document ready to be stored in GeneratedGame.html_source.

    Retries the WHOLE call up to 3 times - not just the JSON parse - because the
    failure being recovered from is usually the generation itself (truncated page,
    a CDN import) rather than a transport blip, and the same prompt frequently
    produces a sound page on a second pass. From attempt 2 onward the exact
    structural complaint is fed back into the user turn, so the retry is a repair
    with information rather than a reroll. Raises RuntimeError after 3 failures.
    """
    client = _client_or_raise()
    base_user_content = _build_user_prompt(concept_name, concept_description, difficulty, rag_context)

    last_error = None
    repair_note = ""

    for attempt in range(3):
        try:
            started = time.monotonic()
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": GAME_SYSTEM_PROMPT},
                    {"role": "user", "content": base_user_content + repair_note},
                ],
                response_format={"type": "json_object"},
                # Low but not zero: the mechanic should vary between concepts (and
                # between two students generating for the same concept), while the
                # markup itself stays disciplined. Higher values started producing
                # clever-but-broken pages.
                temperature=0.6,
                max_tokens=GAME_MAX_TOKENS,
                timeout=GAME_CALL_TIMEOUT,
                # kimi is a reasoning model - without this it spends the token budget
                # on hidden thinking and returns message.content=None, which for a
                # 16k-token page generation is an expensive way to get nothing.
                extra_body={"reasoning": {"exclude": True}},
            )
            elapsed = time.monotonic() - started

            choice = response.choices[0]
            raw_content = choice.message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={choice.finish_reason}).")

            data = json.loads(raw_content)
            html = (data.get("html") or "").strip()

            problems = validate_game_html(html)
            if problems:
                raise ValueError("; ".join(problems))

            title = (data.get("title") or f"{concept_name} Game").strip()[:120]
            game_kind = (data.get("game_kind") or "interactive").strip().lower()[:60]

            logger.info(
                "Game generation succeeded for '%s' in %.1fs on attempt %d/3 (kind=%s, %d chars of html).",
                concept_name, elapsed, attempt + 1, game_kind, len(html),
            )
            return {"title": title, "game_kind": game_kind, "html": html}

        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning(
                "Game generation attempt %d/3 for '%s' failed validation: %s",
                attempt + 1, concept_name, str(e),
            )
            repair_note = _REPAIR_INSTRUCTION.format(reason=str(e))
        except Exception as e:
            last_error = e
            # Not every API failure is worth retrying. Insufficient credits, a bad key
            # and a refused model are all deterministic: the next two attempts fail
            # identically, just slower, and each one still costs the user a round trip.
            # Only transient failures (timeouts, 5xx, rate limits) earn a retry.
            fatal = _fatal_api_error(e)
            if fatal:
                logger.error("Game generation aborted for '%s': %s", concept_name, fatal)
                raise RuntimeError(fatal) from e
            logger.warning(
                "Game generation attempt %d/3 for '%s' failed: %s: %s",
                attempt + 1, concept_name, type(e).__name__, str(e),
            )
            # A transport/API failure says nothing about the page, so the next
            # attempt goes out with the original prompt rather than a bogus repair note.
            repair_note = ""

    raise RuntimeError(f"Game generation failed after 3 attempts: {last_error}")


def _fatal_api_error(exc: Exception) -> Optional[str]:
    """Returns an actionable message if this error can never succeed on retry, else None.

    Authoring a whole page requests a large max_tokens, and OpenRouter rejects the
    request up front (402) when the account balance cannot cover that reservation -
    even if the finished page would have used a fraction of it. That reads as a
    confusing "failed after 3 attempts" unless it is named plainly, so it is.
    """
    status = getattr(exc, "status_code", None)
    text = str(exc)

    # Distinct from the "requires more credits" case below: this is a transient
    # concurrency ceiling, not an underfunded account - retrying moments later
    # (not just adding credit) is a real fix, so it gets its own message rather
    # than being told to permanently lower GAME_MAX_TOKENS.
    if is_budget_exhausted_error(exc):
        return BUDGET_EXHAUSTED_MESSAGE

    if status == 402 or "requires more credits" in text:
        return (
            "Game generation needs more OpenRouter credit than this account currently has. "
            f"Each game reserves up to {GAME_MAX_TOKENS} output tokens, and OpenRouter refuses "
            "the request when the balance cannot cover that reservation. Either add credit at "
            "https://openrouter.ai/settings/credits, or lower GAME_MAX_TOKENS in backend/.env "
            "(below about 8000 the page usually truncates mid-script and will not run)."
        )
    if status in (401, 403):
        return (
            "OpenRouter rejected the API key while generating a game - check OPENROUTER_API_KEY "
            "in backend/.env."
        )
    if status == 404:
        return (
            f"OpenRouter does not recognise the model '{settings.KIMI_MODEL}' - check KIMI_MODEL "
            "in backend/.env."
        )
    return None
