"""Similar-assignment (plagiarism) detection between student submissions.

Every submission's text is extracted once and cached on AssignmentSubmission.
extracted_text. Two submissions are compared by the overlap of their word 4-gram
"shingles" - copied passages share long runs of identical words, while independently
written answers on the same topic mostly do not. Shingles that also appear in the
assignment brief itself are ignored, so students quoting the question back are not
flagged. The result per submission is a short list of its closest matches (other
students in the same assignment and in other assignments of the same course), stored
as JSON on AssignmentSubmission.similarity_json for the teacher to review.

Pure Python (no extra dependencies) and deterministic - a similarity flag must be
explainable and repeatable, so no AI call is involved.
"""
import json
import logging
import re
from datetime import datetime
from typing import Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.database.models import Assignment, AssignmentSubmission
from app.upload.services import download_stored_file

logger = logging.getLogger("conceptintel.similarity")

SHINGLE_SIZE = 4            # words per shingle
MIN_TOKENS = 40             # texts shorter than this are too short to compare meaningfully
REPORT_THRESHOLD = 0.30     # matches below this overlap are not shown to the teacher
HIGH_THRESHOLD = 0.70       # "high" = very likely copied
MEDIUM_THRESHOLD = 0.45     # "medium" = substantial shared wording, worth a look
MAX_MATCHES = 3

_WORD_RE = re.compile(r"[a-z0-9']+")


def _tokens(text: str) -> List[str]:
    """Lower-cased word tokens; punctuation/whitespace/formatting noise is dropped."""
    return _WORD_RE.findall((text or "").lower())


def _shingles(tokens: List[str]) -> Set[str]:
    """The set of overlapping SHINGLE_SIZE-word windows of a token list."""
    if len(tokens) < SHINGLE_SIZE:
        return set()
    return {" ".join(tokens[i:i + SHINGLE_SIZE]) for i in range(len(tokens) - SHINGLE_SIZE + 1)}


def overlap_score(a: Set[str], b: Set[str]) -> float:
    """Overlap coefficient |A∩B| / min(|A|,|B|): how much of the SMALLER text is found
    in the other, so a short copied answer inside a long document is still caught."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def classify(score: float) -> str:
    """Maps a 0-1 overlap to a human label used by the UI badge."""
    if score >= HIGH_THRESHOLD:
        return "high"
    if score >= MEDIUM_THRESHOLD:
        return "medium"
    return "low"


def extract_and_cache_text(db: Session, submission: AssignmentSubmission) -> str:
    """Returns the submission's plain text, extracting (and caching) it on first use."""
    if submission.extracted_text:
        return submission.extracted_text
    # Imported here: grading_service pulls in the OpenRouter client, which is heavy and
    # unnecessary unless text actually has to be extracted.
    from pathlib import Path
    from app.assignments import grading_service
    try:
        data = download_stored_file(submission.file_url)
        text = grading_service._extract_submission_text(data, Path(submission.file_filename).suffix)
    except Exception as e:
        logger.warning("Could not extract text for submission %s: %s", submission.id, e)
        return ""
    submission.extracted_text = text
    db.commit()
    return text


def refresh_similarity(db: Session, assignment_id: int) -> int:
    """Recomputes similarity for every submission of one assignment (a new
    submission changes everyone else's matches too) and stores the report on each.
    Returns the number of submissions that were compared."""
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment:
        return 0

    brief_shingles = _shingles(_tokens(f"{assignment.title}. {assignment.description or ''}"))

    this_subs: List[AssignmentSubmission] = list(assignment.submissions)
    # Comparison pool: same assignment + other assignments in the same course.
    other_subs: List[AssignmentSubmission] = (
        db.query(AssignmentSubmission)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .filter(Assignment.course_id == assignment.course_id, Assignment.id != assignment_id)
        .all()
    )

    pool: Dict[int, Dict] = {}
    for sub in this_subs + other_subs:
        text = extract_and_cache_text(db, sub)
        toks = _tokens(text)
        if len(toks) < MIN_TOKENS:
            continue
        pool[sub.id] = {
            "sub": sub,
            "shingles": _shingles(toks) - brief_shingles,
        }

    names = {}
    for entry in pool.values():
        s = entry["sub"]
        names[s.id] = s.student.full_name if s.student else f"Student {s.student_id}"

    compared = 0
    now = datetime.utcnow().isoformat()
    for sub in this_subs:
        me = pool.get(sub.id)
        if me is None:
            sub.similarity_json = json.dumps({
                "checked_at": now, "level": "none", "max_score": 0.0, "matches": [],
                "note": "Too little text to compare.",
            })
            continue
        compared += 1
        matches = []
        for other_id, other in pool.items():
            o = other["sub"]
            if other_id == sub.id or o.student_id == sub.student_id:
                continue
            score = overlap_score(me["shingles"], other["shingles"])
            if score >= REPORT_THRESHOLD:
                matches.append({
                    "submission_id": o.id,
                    "student_id": o.student_id,
                    "student_name": names.get(o.id),
                    "assignment_id": o.assignment_id,
                    "same_assignment": o.assignment_id == assignment_id,
                    "score": round(score, 3),
                })
        matches.sort(key=lambda m: -m["score"])
        matches = matches[:MAX_MATCHES]
        top = matches[0]["score"] if matches else 0.0
        sub.similarity_json = json.dumps({
            "checked_at": now, "level": classify(top) if matches else "none",
            "max_score": top, "matches": matches,
        })
    db.commit()
    return compared


def refresh_similarity_background(assignment_id: int) -> None:
    """Thread entry point: opens its own DB session (the request's is closed by the
    time this runs) and never raises - a similarity check must not break a submit."""
    from app.database.connection import SessionLocal
    db = SessionLocal()
    try:
        refresh_similarity(db, assignment_id)
    except Exception as e:
        logger.warning("Background similarity check failed for assignment %s: %s", assignment_id, e)
    finally:
        db.close()
