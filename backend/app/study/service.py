"""Study modes: the scheduling and assembly logic behind Learn, Test and Match.

WHY THIS IS NOT AN AI FEATURE
-----------------------------
Every mode here runs entirely on material that has already been generated and
approved. No mode makes an LLM call. That is the point: generation is slow, costs
tokens and can fail, whereas a student drilling flashcards needs an instant,
reliable loop. Content Generation produces the material once; this module is what a
student actually does with it, over and over, for free.

THE THREE MODES
---------------
* Learn  - spaced repetition over the items of one content set. Answers are graded,
           wrong answers come back sooner, and the set is "done" when every item has
           climbed out of the low boxes.
* Test   - assembles a one-off mixed exam from a content set (or a whole course) and
           scores it in one go. Distinct from Learn in that nothing repeats and the
           result is a single grade that feeds mastery.
* Match  - a timed pairing drill over flashcard fronts/backs. Scored on time rather
           than correctness, since a mismatch is immediately obvious and retried.

SCHEDULING: LEITNER BOXES
-------------------------
BOX_INTERVALS maps a box number to how long a card rests before it is due again. A
correct answer promotes the card one box (longer rest); a wrong answer drops it to
box 0 (due immediately). This is deliberately simpler than SM-2/Anki interval math:
it needs no per-card ease factor, it is explainable to a student in one sentence,
and it degrades sensibly under the usage pattern this app actually sees - one long
cramming session the night before an assessment, rather than daily reviews forever.
"""
import json
import logging
import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.database.models import GeneratedContent, StudyCardState, StudySession

logger = logging.getLogger("conceptintel.study")

# Box -> how long until the card is due again. Box 0 is "you just got this wrong",
# so it stays in the current session rather than resting at all.
BOX_INTERVALS = {
    0: timedelta(0),
    1: timedelta(minutes=10),
    2: timedelta(hours=6),
    3: timedelta(days=1),
    4: timedelta(days=3),
    5: timedelta(days=7),
}
MAX_BOX = 5
# A card at or above this box counts as "known" for progress reporting.
MASTERED_BOX = 4

VALID_MODES = ("learn", "test", "match")


def _payload(item: GeneratedContent) -> Dict[str, Any]:
    """Decode the content's JSON payload; {} (with a warning) if it is corrupt."""
    try:
        return json.loads(item.payload_json) or {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("GeneratedContent %s has unparseable payload_json", item.id)
        return {}


def extract_items(item: GeneratedContent) -> List[Dict[str, Any]]:
    """Normalises a content payload into a flat list of studyable items.

    Every mode works on the same shape regardless of content_type, so the branching
    over flashcard/mcq/quiz lives here once instead of in each mode:

      {"kind": "card",     "index": i, "prompt": front, "answer": back}
      {"kind": "question", "index": i, "prompt": question, "options": [...],
       "correct_index": n, "explanation": "..."}

    A study guide has no discrete items and yields [] - it is read, not drilled.
    """
    payload = _payload(item)
    out: List[Dict[str, Any]] = []

    if item.content_type == "flashcard":
        for i, c in enumerate(payload.get("cards") or []):
            front, back = (c.get("front") or "").strip(), (c.get("back") or "").strip()
            if front and back:
                out.append({"kind": "card", "index": i, "prompt": front, "answer": back})
        return out

    if item.content_type in ("mcq", "quiz"):
        for i, q in enumerate(payload.get("questions") or []):
            options = q.get("options") or []
            if not q.get("question") or len(options) < 2:
                continue
            out.append({
                "kind": "question",
                "index": i,
                "prompt": q["question"],
                "options": options,
                "correct_index": q.get("correct_index", 0),
                "explanation": q.get("explanation") or "",
            })
        return out

    return out


def _state_map(db: Session, student_id: int, content_id: int) -> Dict[int, StudyCardState]:
    """Map card index -> this student's saved Leitner state for the content set."""
    rows = db.query(StudyCardState).filter(
        StudyCardState.student_id == student_id,
        StudyCardState.content_id == content_id,
    ).all()
    return {r.item_index: r for r in rows}


def build_learn_queue(
    db: Session, student_id: int, item: GeneratedContent, limit: int = 20,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """The next batch of items to drill, plus a progress summary.

    Ordering puts genuinely-due work first and never lets a card the student is
    failing hide behind cards they already know:
      1. never-seen cards (box 0, no state row)
      2. cards whose due_at has passed, lowest box first
      3. nothing else - if all cards are resting, the queue is empty and the caller
         shows "you're up to date" instead of pointlessly re-drilling known cards.
    """
    items = extract_items(item)
    if not items:
        return [], {"total": 0, "new": 0, "due": 0, "mastered": 0, "resting": 0}

    states = _state_map(db, student_id, item.id)
    now = datetime.utcnow()

    new_items, due_items = [], []
    mastered = resting = 0
    for it in items:
        st = states.get(it["index"])
        if st is None:
            new_items.append((it, None))
            continue
        if st.box >= MASTERED_BOX:
            mastered += 1
        if st.due_at is None or st.due_at <= now:
            due_items.append((it, st))
        else:
            resting += 1

    due_items.sort(key=lambda pair: (pair[1].box, pair[1].due_at or now))

    queue = []
    for it, st in (new_items + due_items)[:limit]:
        queue.append({
            **it,
            "box": st.box if st else 0,
            "times_seen": st.times_seen if st else 0,
        })

    summary = {
        "total": len(items),
        "new": len(new_items),
        "due": len(due_items),
        "mastered": mastered,
        "resting": resting,
    }
    return queue, summary


def record_answer(
    db: Session, student_id: int, course_id: int, item: GeneratedContent,
    item_index: int, correct: bool,
) -> Dict[str, Any]:
    """Applies one Learn answer to the card's schedule. Commits nothing - the caller
    owns the transaction so a batch of answers is atomic."""
    st = db.query(StudyCardState).filter(
        StudyCardState.student_id == student_id,
        StudyCardState.content_id == item.id,
        StudyCardState.item_index == item_index,
    ).first()

    if st is None:
        st = StudyCardState(
            student_id=student_id, content_id=item.id, course_id=course_id,
            item_index=item_index, box=0, correct_streak=0, times_seen=0, times_correct=0,
        )
        db.add(st)

    now = datetime.utcnow()
    st.times_seen = (st.times_seen or 0) + 1
    st.last_seen_at = now

    if correct:
        st.times_correct = (st.times_correct or 0) + 1
        st.correct_streak = (st.correct_streak or 0) + 1
        st.box = min(MAX_BOX, (st.box or 0) + 1)
    else:
        # Straight back to the bottom. A card you just failed is not "slightly less
        # known" - the whole value of the box system is that it is unforgiving here.
        st.correct_streak = 0
        st.box = 0

    st.due_at = now + BOX_INTERVALS.get(st.box, timedelta(0))
    return {"box": st.box, "due_at": st.due_at, "correct_streak": st.correct_streak}


def assemble_test(
    db: Session, item: GeneratedContent, question_count: Optional[int] = None,
    shuffle_options: bool = True, seed: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Builds a one-off test from a content set.

    Flashcards are convertible into questions by using other cards' backs as
    distractors, so a flashcard set is testable without generating anything new -
    which is the whole reason Test can run offline and instantly. A set with fewer
    than 4 cards cannot produce 4 plausible options and is skipped.

    Options are shuffled per question, and the returned correct_index is recomputed
    to match, so a student cannot learn "the answer is always B" from the source
    payload. seed makes a test reproducible for the same attempt.
    """
    rng = random.Random(seed)
    items = extract_items(item)
    if not items:
        return []

    questions: List[Dict[str, Any]] = []

    if item.content_type == "flashcard":
        if len(items) < 4:
            return []
        for it in items:
            distractor_pool = [o["answer"] for o in items if o["index"] != it["index"]]
            distractors = rng.sample(distractor_pool, min(3, len(distractor_pool)))
            options = distractors + [it["answer"]]
            rng.shuffle(options)
            questions.append({
                "source_index": it["index"],
                "question": it["prompt"],
                "options": options,
                "correct_index": options.index(it["answer"]),
                "explanation": f"{it['prompt']} — {it['answer']}",
            })
    else:
        for it in items:
            options = list(it["options"])
            correct_value = options[it["correct_index"]] if 0 <= it["correct_index"] < len(options) else options[0]
            if shuffle_options:
                rng.shuffle(options)
            questions.append({
                "source_index": it["index"],
                "question": it["prompt"],
                "options": options,
                "correct_index": options.index(correct_value),
                "explanation": it.get("explanation") or "",
            })

    rng.shuffle(questions)
    if question_count:
        questions = questions[:question_count]
    return questions


def build_match_pairs(item: GeneratedContent, pair_count: int = 6, seed: Optional[int] = None) -> List[Dict[str, Any]]:
    """Term/definition pairs for the timed Match drill.

    Only flashcards produce good pairs - an MCQ's "answer" is one option out of four
    and is meaningless without its distractors, so matching them is nonsense. The
    caller surfaces Match only for flashcard sets.
    """
    rng = random.Random(seed)
    items = [i for i in extract_items(item) if i["kind"] == "card"]
    if len(items) < 2:
        return []
    chosen = rng.sample(items, min(pair_count, len(items)))
    return [{"index": c["index"], "term": c["prompt"], "definition": c["answer"]} for c in chosen]


def record_session(
    db: Session, student_id: int, course_id: int, item: Optional[GeneratedContent],
    mode: str, items_total: int, items_correct: int, duration_seconds: Optional[int] = None,
) -> StudySession:
    """Persists a finished run. Commits nothing - the caller owns the transaction so
    the session row and any mastery evidence land together."""
    score = round((items_correct / items_total) * 100, 1) if items_total else 0.0
    session = StudySession(
        student_id=student_id,
        course_id=course_id,
        content_id=item.id if item else None,
        concept_node_id=item.concept_node_id if item else None,
        concept_name=item.concept_name if item else None,
        mode=mode,
        score=score,
        items_total=items_total,
        items_correct=items_correct,
        duration_seconds=duration_seconds,
    )
    db.add(session)
    return session
