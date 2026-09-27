"""Question types: what a valid question of each kind looks like, and how it is graded.

This module is the single authority for both. Validation and grading live together on
purpose - they are two halves of one contract, and splitting them is how an answer
key ends up accepted at write time but ungradable at read time.

THE FIVE TYPES
--------------
  single_choice - exactly one right option.
      payload {"options": [str, ...], "correct_index": int}
  multi_select  - one or more right options, partially credited.
      payload {"options": [str, ...], "correct_indices": [int, ...]}
  true_false    - a claim that is either true or false.
      payload {"correct": bool}
  fill_blank    - a short typed answer, matched against accepted spellings.
      payload {"accepted": [str, ...], "case_sensitive": bool}
  matching      - pair each left item with its right item, partially credited.
      payload {"pairs": [{"left": str, "right": str}, ...]}

PARTIAL CREDIT
--------------
multi_select and matching are graded proportionally; the other three are all-or-
nothing because they have nothing to be partial about. For multi_select the formula
is (correct picked - incorrect picked) / total correct, floored at zero: without the
penalty term, ticking every option would score full marks, which is the classic way
multi-select questions get gamed.

NORMALISATION FOR fill_blank
----------------------------
A typed answer is compared after collapsing whitespace and (unless the question opts
into case sensitivity) case-folding. Nothing cleverer - no stemming, no fuzzy
distance - because a near-miss on a technical term is usually a genuine error, and a
teacher who wants to accept variants can list them in `accepted`.
"""
import json
import logging
import random
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("conceptintel.question_bank")

QUESTION_TYPES = ("single_choice", "multi_select", "true_false", "fill_blank", "matching")

TYPE_LABELS = {
    "single_choice": "Multiple choice",
    "multi_select": "Multiple answers",
    "true_false": "True / false",
    "fill_blank": "Fill in the blank",
    "matching": "Matching",
}

MIN_OPTIONS = 2
MAX_OPTIONS = 8
MAX_PAIRS = 10

_WS = re.compile(r"\s+")


def _norm_text(s: Any) -> str:
    return _WS.sub(" ", str(s or "")).strip()


# ───────────────────────────── validation ─────────────────────────────

def validate_payload(question_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Returns a cleaned payload, or raises ValueError with a message fit to show a
    teacher. Every question entering the bank goes through here, whether it came from
    the AI, an import, or a hand-written form."""
    if question_type not in QUESTION_TYPES:
        raise ValueError(f"Unknown question type '{question_type}'.")
    if not isinstance(payload, dict):
        raise ValueError("Question payload must be an object.")

    if question_type in ("single_choice", "multi_select"):
        options = [_norm_text(o) for o in (payload.get("options") or [])]
        options = [o for o in options if o]
        if len(options) < MIN_OPTIONS:
            raise ValueError(f"A {TYPE_LABELS[question_type]} question needs at least {MIN_OPTIONS} options.")
        if len(options) > MAX_OPTIONS:
            raise ValueError(f"A question can have at most {MAX_OPTIONS} options.")
        if len(set(o.lower() for o in options)) != len(options):
            raise ValueError("Options must be distinct - two identical options make the question unanswerable.")

        if question_type == "single_choice":
            idx = payload.get("correct_index")
            if not isinstance(idx, int) or not (0 <= idx < len(options)):
                raise ValueError("correct_index must point at one of the options.")
            return {"options": options, "correct_index": idx}

        raw = payload.get("correct_indices") or []
        if not isinstance(raw, list):
            raise ValueError("correct_indices must be a list.")
        idxs = sorted({i for i in raw if isinstance(i, int) and 0 <= i < len(options)})
        if not idxs:
            raise ValueError("A multiple-answer question needs at least one correct option.")
        if len(idxs) == len(options):
            raise ValueError("Every option cannot be correct - there would be nothing to decide.")
        return {"options": options, "correct_indices": idxs}

    if question_type == "true_false":
        val = payload.get("correct")
        if not isinstance(val, bool):
            raise ValueError("A true/false question needs `correct` to be true or false.")
        return {"correct": val}

    if question_type == "fill_blank":
        accepted = [_norm_text(a) for a in (payload.get("accepted") or [])]
        accepted = [a for a in accepted if a]
        if not accepted:
            raise ValueError("A fill-in-the-blank question needs at least one accepted answer.")
        if any(len(a) > 200 for a in accepted):
            raise ValueError("Accepted answers must be short - this is a blank, not an essay.")
        return {"accepted": accepted, "case_sensitive": bool(payload.get("case_sensitive", False))}

    # matching
    pairs_raw = payload.get("pairs") or []
    if not isinstance(pairs_raw, list):
        raise ValueError("pairs must be a list.")
    pairs = []
    for p in pairs_raw:
        if not isinstance(p, dict):
            continue
        left, right = _norm_text(p.get("left")), _norm_text(p.get("right"))
        if left and right:
            pairs.append({"left": left, "right": right})
    if len(pairs) < 2:
        raise ValueError("A matching question needs at least 2 pairs.")
    if len(pairs) > MAX_PAIRS:
        raise ValueError(f"A matching question can have at most {MAX_PAIRS} pairs.")
    if len({p["left"].lower() for p in pairs}) != len(pairs):
        raise ValueError("Left-hand items must be distinct.")
    if len({p["right"].lower() for p in pairs}) != len(pairs):
        raise ValueError("Right-hand items must be distinct - a duplicate makes two pairings both correct.")
    return {"pairs": pairs}


# ────────────────────────── delivery (no answers) ──────────────────────

def public_payload(
    question_type: str, payload: Dict[str, Any], shuffle: bool = True, rng: Optional[random.Random] = None,
) -> Dict[str, Any]:
    """The version of a question sent to a student: everything needed to answer it,
    nothing that reveals the answer.

    For option-based types the order is shuffled, so scoring MUST be done against the
    order actually served - see grade(), which takes the served order back as input.
    """
    rng = rng or random.Random()

    if question_type in ("single_choice", "multi_select"):
        options = list(payload["options"])
        if shuffle:
            rng.shuffle(options)
        return {"options": options}

    if question_type == "true_false":
        return {}

    if question_type == "fill_blank":
        return {}

    pairs = list(payload["pairs"])
    lefts = [p["left"] for p in pairs]
    rights = [p["right"] for p in pairs]
    if shuffle:
        rng.shuffle(rights)
    return {"left_items": lefts, "right_items": rights}


# ────────────────────────────── grading ────────────────────────────────

def grade(
    question_type: str,
    payload: Dict[str, Any],
    response: Any,
    served: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, float]:
    """Grades one response. Returns (fully_correct, fraction_of_points 0.0-1.0).

    `served` is the public_payload the student actually saw. It matters because
    options are shuffled per attempt: the student answers in terms of THEIR ordering,
    so the selected index has to be resolved back to the option text before it can be
    compared with the stored answer key. Passing served=None means "the response is
    already in the stored order", which is only true for unshuffled delivery.
    """
    try:
        if question_type == "single_choice":
            options = payload["options"]
            correct_text = options[payload["correct_index"]]
            chosen = _resolve_option(response, served, options)
            return (chosen == correct_text, 1.0 if chosen == correct_text else 0.0)

        if question_type == "multi_select":
            options = payload["options"]
            correct_texts = {options[i] for i in payload["correct_indices"]}
            chosen_texts = set()
            for r in (response or []):
                t = _resolve_option(r, served, options)
                if t is not None:
                    chosen_texts.add(t)
            hits = len(chosen_texts & correct_texts)
            misses = len(chosen_texts - correct_texts)
            fraction = max(0.0, (hits - misses) / len(correct_texts))
            return (chosen_texts == correct_texts, round(min(1.0, fraction), 4))

        if question_type == "true_false":
            if not isinstance(response, bool):
                return (False, 0.0)
            ok = response is payload["correct"]
            return (ok, 1.0 if ok else 0.0)

        if question_type == "fill_blank":
            if not isinstance(response, str):
                return (False, 0.0)
            given = _norm_text(response)
            accepted = payload["accepted"]
            if not payload.get("case_sensitive"):
                given = given.casefold()
                accepted = [a.casefold() for a in accepted]
            ok = given in accepted
            return (ok, 1.0 if ok else 0.0)

        if question_type == "matching":
            pairs = payload["pairs"]
            truth = {p["left"]: p["right"] for p in pairs}
            if not isinstance(response, dict):
                return (False, 0.0)
            correct = 0
            for left, right in response.items():
                if truth.get(_norm_text(left)) == _norm_text(right):
                    correct += 1
            fraction = correct / len(pairs) if pairs else 0.0
            return (correct == len(pairs), round(fraction, 4))

    except (KeyError, IndexError, TypeError) as e:
        logger.warning("Ungradable %s question (payload/response mismatch): %s", question_type, e)
        return (False, 0.0)

    return (False, 0.0)


def _resolve_option(response: Any, served: Optional[Dict[str, Any]], options: List[str]) -> Optional[str]:
    """Turns whatever the client sent into the option TEXT it refers to.

    Accepts either an index into the served (shuffled) order or the literal text, so a
    client that echoes the string back is graded correctly too.
    """
    if isinstance(response, str):
        return _norm_text(response)
    if isinstance(response, int):
        pool = (served or {}).get("options") or options
        if 0 <= response < len(pool):
            return pool[response]
    return None


# ─────────────────────── import from generated sets ────────────────────

def items_from_generated_content(content_type: str, payload_json: str) -> List[Dict[str, Any]]:
    """Lifts an existing GeneratedContent set into bank-question dicts.

    Flashcards become fill_blank questions (front asks, back is the accepted answer),
    which is the only faithful conversion: a flashcard has no distractors, and
    inventing them here would silently change what the teacher approved. MCQ/quiz
    items become single_choice. Study guides yield nothing.
    """
    try:
        payload = json.loads(payload_json) or {}
    except (json.JSONDecodeError, TypeError):
        return []

    out: List[Dict[str, Any]] = []

    if content_type == "flashcard":
        for c in payload.get("cards") or []:
            front, back = _norm_text(c.get("front")), _norm_text(c.get("back"))
            if front and back and len(back) <= 200:
                out.append({
                    "question_type": "fill_blank",
                    "prompt": front,
                    "payload": {"accepted": [back], "case_sensitive": False},
                    "explanation": back,
                })
        return out

    if content_type in ("mcq", "quiz"):
        for q in payload.get("questions") or []:
            prompt = _norm_text(q.get("question"))
            options = [_norm_text(o) for o in (q.get("options") or []) if _norm_text(o)]
            idx = q.get("correct_index")
            if not prompt or len(options) < MIN_OPTIONS or not isinstance(idx, int):
                continue
            if not (0 <= idx < len(options)):
                continue
            # Generation can now produce true/false questions, which arrive as two
            # options reading "True" and "False". Imported as single_choice they would
            # render as a two-option multiple choice - correct, but not what the bank
            # already knows how to display, shuffle or report on.
            if len(options) == 2 and {o.strip().lower() for o in options} == {"true", "false"}:
                out.append({
                    "question_type": "true_false",
                    "prompt": prompt,
                    "payload": {"correct": options[idx].strip().lower() == "true"},
                    "explanation": _norm_text(q.get("explanation")),
                })
                continue
            out.append({
                "question_type": "single_choice",
                "prompt": prompt,
                "payload": {"options": options, "correct_index": idx},
                "explanation": _norm_text(q.get("explanation")),
            })
    return out
