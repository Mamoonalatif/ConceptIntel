"""AI-assisted authoring for the CLO/PLO outcome chain, from the course's own
uploaded outline: extract Course Learning Outcomes, suggest which existing
Program Learning Outcomes each one maps to, and suggest which concept-graph
nodes each CLO is addressed by.

Reuses the same OpenRouter/Kimi client as concept extraction and grading (see
app/content_processing/kimi_service.py) - no new AI provider.

Nothing here writes to the database - every function returns plain data for the
caller (outcomes/routes.py) to create/link, using the exact same direct-write
CLO/PLO/ConceptCLOMap calls a curriculum editor's own UI action would make. CLOs
and concept-CLO links in this app are curriculum data with no approval gate (see
get_current_curriculum_editor's docstring), so AI-authored here is not treated
any differently from teacher-authored - it is just as reviewable/editable
afterward via the existing CRUD endpoints.
"""
import json
import logging
from typing import Any, Dict, List

from app.config import settings
from app.content_processing.kimi_service import _get_client, openrouter_payment_error_message, _reasoning_extra_body
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel.outcomes.ai")


def _call_json(system_prompt: str, user_content: str, max_tokens: int = 2500) -> Dict[str, Any]:
    client = _get_client()
    if client is None:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not configured - set it in backend/.env to enable "
            "AI-assisted outcome extraction. See https://openrouter.ai/keys."
        )
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.KIMI_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=max_tokens,
                timeout=60.0,
                extra_body=_reasoning_extra_body(),
            )
            raw_content = response.choices[0].message.content
            if not raw_content:
                raise ValueError(f"Model returned empty content (finish_reason={response.choices[0].finish_reason}).")
            return json.loads(raw_content)
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning("Outcomes AI call attempt %d/3 failed validation: %s", attempt + 1, str(e))
        except Exception as e:
            payment_message = openrouter_payment_error_message(e)
            if payment_message:
                raise RuntimeError(payment_message) from e
            last_error = e
            logger.warning("Outcomes AI call attempt %d/3 failed: %s: %s", attempt + 1, type(e).__name__, str(e))
    raise RuntimeError(f"Outcomes AI call failed after 3 attempts: {last_error}")


@trace_ai_call("outcomes-extract-clos")
def extract_clos_from_outline(outline_text: str, existing_clos: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Extracts Course Learning Outcomes from an outline/syllabus's own text.

    Many syllabi already state these explicitly under a "Course Learning Outcomes"/
    "CLOs" heading - the model is told to prefer that wording verbatim over writing
    its own. If no such section exists, it may infer a small set of outcomes from
    the outline's topic list, but is told to prefer under- to over-extracting: a
    missing CLO is a quick manual add, a fabricated one is silent curriculum noise.
    """
    existing_block = ""
    if existing_clos:
        lines = "\n".join(f"- {c['code']}: {c['title']}" for c in existing_clos)
        existing_block = (
            f"\nCLOs that already exist for this course - do NOT re-propose these, "
            f"only extract genuinely new ones:\n{lines}\n"
        )

    system_prompt = f"""You are a curriculum specialist extracting Course Learning Outcomes (CLOs) from a
university course outline/syllabus.

A CLO is a statement of what a student will be able to DO after completing the
course - an action verb + an object, at course scope (broader than a single
concept, narrower than the whole program). "Understand physics" is too vague;
"Apply Newton's laws of motion to solve real-world mechanics problems" is a CLO.

PREFER THE OUTLINE'S OWN WORDING: if the outline has an explicit "Course Learning
Outcomes", "CLOs", "Learning Outcomes" or "Objectives" section, extract those
statements as close to verbatim as possible - do not paraphrase them away. Only
when no such section exists may you infer a small number (typically 3-6) of
outcomes from the outline's topic list and stated goals.

Prefer under-extracting to over-extracting: if you are not confident something is a
genuine course-level learning outcome, leave it out.
{existing_block}
Respond ONLY with valid JSON in this exact format:
{{
  "clos": [
    {{"code": "CLO1", "title": "Short outcome statement", "description": "Optional one more sentence of elaboration, or null"}}
  ]
}}
If none can be extracted, respond with exactly {{"clos": []}}"""

    data = _call_json(system_prompt, f"Course outline:\n\n{outline_text[:8000]}")
    clos = data.get("clos", [])
    return [c for c in clos if isinstance(c, dict) and (c.get("title") or "").strip()]


@trace_ai_call("outcomes-map-clos-to-plos")
def suggest_clo_plo_links(clos: List[Dict[str, Any]], plos: List[Dict[str, Any]]) -> Dict[int, List[int]]:
    """For each CLO (already persisted, so it carries a real id), suggests which of
    the program's EXISTING PLOs it supports. Never invents new PLOs - a Program
    Learning Outcome is shared across every course in the program, so one course's
    outline is not authoritative enough to create one; only mapping to what a
    program coordinator has already defined is done here.

    clos/plos: [{"id": int, "code": str, "title": str, "description": str}, ...]
    Returns {clo_id: [plo_id, ...]} - a CLO with no confident match maps to [].
    """
    if not clos or not plos:
        return {}

    clo_lines = "\n".join(f"- id={c['id']}: {c['code']}: {c['title']}" for c in clos)
    plo_lines = "\n".join(f"- id={p['id']}: {p['code']}: {p['title']}" for p in plos)

    system_prompt = """You are mapping a course's Course Learning Outcomes (CLOs) to the program's
existing Program Learning Outcomes (PLOs) they support - the standard
Outcome-Based Education CLO -> PLO chain.

For EACH CLO, list the ids of every PLO it genuinely, substantively supports.
A CLO may map to zero, one, or several PLOs. Do NOT map a CLO to a PLO just
because they are loosely related - only when demonstrating that CLO is real
evidence a student is progressing toward that PLO. Use the exact ids given.

Respond ONLY with valid JSON in this exact format:
{"mappings": [{"clo_id": 1, "plo_ids": [2, 5]}]}"""

    user_content = f"CLOs:\n{clo_lines}\n\nProgram's existing PLOs:\n{plo_lines}"
    data = _call_json(system_prompt, user_content, max_tokens=1500)

    valid_plo_ids = {p["id"] for p in plos}
    result: Dict[int, List[int]] = {}
    for m in data.get("mappings", []):
        if not isinstance(m, dict):
            continue
        clo_id = m.get("clo_id")
        # Deduplicated (order-preserving) - an unvalidated raw LLM JSON list can
        # repeat an id, and the caller inserts one join-table row per entry with a
        # unique (clo_id, plo_id) constraint, so a duplicate here becomes an
        # IntegrityError two layers away instead of a validation concern here.
        plo_ids = list(dict.fromkeys(pid for pid in (m.get("plo_ids") or []) if pid in valid_plo_ids))
        if clo_id is not None:
            result[clo_id] = plo_ids
    return result


@trace_ai_call("outcomes-map-concepts-to-clos")
def suggest_concept_clo_links(concepts: List[Dict[str, Any]], clos: List[Dict[str, Any]]) -> Dict[str, List[int]]:
    """For each concept-graph node, suggests which CLOs it is evidence for
    addressing. concepts: [{"node_id": str, "name": str, "description": str}, ...].
    clos: [{"id": int, "code": str, "title": str}, ...].
    Returns {node_id: [clo_id, ...]} - a concept with no confident match maps to [].
    Concepts are processed in batches so a large graph doesn't blow past the
    model's context/output budget in one call.
    """
    if not concepts or not clos:
        return {}

    clo_lines = "\n".join(f"- id={c['id']}: {c['code']}: {c['title']}" for c in clos)
    system_prompt = f"""You are tagging knowledge-graph concepts from a university course with which
Course Learning Outcomes (CLOs) each one is evidence for.

This course's CLOs:
{clo_lines}

For EACH concept given, list the ids of every CLO it is genuinely, substantively
evidence for - a student who has mastered this concept has made real progress on
that CLO. Most concepts map to one CLO; some map to none (e.g. a concept that is
a stepping stone rather than something a CLO is stated about directly) - use an
empty list rather than forcing a weak match. Use the exact CLO ids given.

Respond ONLY with valid JSON in this exact format:
{{"mappings": [{{"node_id": "17_derivative", "clo_ids": [3]}}]}}"""

    valid_clo_ids = {c["id"] for c in clos}
    result: Dict[str, List[int]] = {}
    batch_size = 40
    for start in range(0, len(concepts), batch_size):
        batch = concepts[start:start + batch_size]
        concept_lines = "\n".join(f"- node_id={c['node_id']}: {c['name']}: {c.get('description') or ''}" for c in batch)
        data = _call_json(system_prompt, f"Concepts:\n{concept_lines}", max_tokens=3000)
        for m in data.get("mappings", []):
            if not isinstance(m, dict):
                continue
            node_id = m.get("node_id")
            # Deduplicated for the same reason as suggest_clo_plo_links above - the
            # caller inserts one ConceptCLOMap row per id under a unique constraint.
            clo_ids = list(dict.fromkeys(cid for cid in (m.get("clo_ids") or []) if cid in valid_clo_ids))
            if node_id:
                result[node_id] = clo_ids
    return result
