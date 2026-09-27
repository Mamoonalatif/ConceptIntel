"""Live quiz mechanics: codes, state transitions, scoring and the broadcast hub.

STATE LIVES IN THE DATABASE, CONNECTIONS LIVE IN MEMORY
-------------------------------------------------------
Two different things are tracked here and it matters which is which. The *game* -
which question is showing, who has joined, what everyone scored - is in Postgres, so a
host who refreshes, or a player whose phone sleeps, rejoins exactly where the room is.
The *sockets* are in a process-local registry, because a WebSocket cannot be persisted
and there is nothing to recover: a dropped connection just reconnects and re-reads the
game state.

The consequence is worth stating plainly: the in-memory hub means live quizzes work on
ONE backend process. Running several workers would put players in the same game on
different hubs and they would stop seeing each other's updates. Fixing that means a
shared pub/sub (Redis is already a dependency, though not currently running) - noted
here rather than discovered later.

SPEED BONUS
-----------
`answered_in_seconds` is measured from the server's own `question_started_at`, never
from a client timestamp, because the whole competitive point of a live quiz is that
being fast is worth something - and anything a browser reports about its own speed is
worth nothing.
"""
import asyncio
import json
import logging
import random
import string
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from app.database.models import (
    LiveQuizAnswer, LiveQuizParticipant, LiveQuizSession, QuestionBankItem,
)
from app.question_bank import service as qb

logger = logging.getLogger("conceptintel.live")

# No I/O/0/1: a code is read aloud across a room or typed off a projector, and those
# four are the characters people get wrong.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6

MIN_SECONDS_PER_QUESTION = 5
MAX_SECONDS_PER_QUESTION = 300


def generate_access_code(db: Session) -> str:
    """A code unique among sessions that are still running. Ended games release their
    code back, so a term's worth of quizzes doesn't exhaust the space."""
    for _ in range(50):
        code = "".join(random.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        clash = db.query(LiveQuizSession).filter(
            LiveQuizSession.access_code == code,
            LiveQuizSession.status != "ended",
        ).first()
        if not clash:
            return code
    raise RuntimeError("Could not allocate a free access code - too many live sessions.")


def session_question_ids(session: LiveQuizSession) -> List[int]:
    try:
        ids = json.loads(session.question_ids_json or "[]")
        return [int(i) for i in ids] if isinstance(ids, list) else []
    except (json.JSONDecodeError, TypeError, ValueError):
        return []


def load_questions(db: Session, session: LiveQuizSession) -> List[QuestionBankItem]:
    ids = session_question_ids(session)
    if not ids:
        return []
    rows = db.query(QuestionBankItem).filter(QuestionBankItem.id.in_(ids)).all()
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ids if i in by_id]


def _payload(item: QuestionBankItem) -> Dict[str, Any]:
    try:
        return json.loads(item.payload_json) or {}
    except (json.JSONDecodeError, TypeError):
        return {}


def current_question(db: Session, session: LiveQuizSession) -> Optional[QuestionBankItem]:
    questions = load_questions(db, session)
    if 0 <= session.current_index < len(questions):
        return questions[session.current_index]
    return None


def public_question(item: QuestionBankItem, index: int, total: int) -> Dict[str, Any]:
    """What players see. Options are NOT shuffled per player: everyone in the room is
    looking at the same projected question, and per-player orders would make the host's
    answer distribution meaningless and the room impossible to talk about out loud."""
    payload = _payload(item)
    public = qb.public_payload(item.question_type, payload, shuffle=False)
    return {
        "index": index,
        "total": total,
        "id": item.id,
        "question_type": item.question_type,
        "prompt": item.prompt,
        "points": item.points or 1,
        "concept_name": item.concept_name,
        **public,
    }


def leaderboard(db: Session, session_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    rows = (
        db.query(LiveQuizParticipant)
        .filter(LiveQuizParticipant.session_id == session_id)
        .order_by(LiveQuizParticipant.score.desc(), LiveQuizParticipant.joined_at.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "participant_id": p.id,
            "nickname": p.nickname,
            "score": round(float(p.score or 0), 1),
            "correct_count": p.correct_count or 0,
            "rank": i + 1,
        }
        for i, p in enumerate(rows)
    ]


def answer_distribution(db: Session, session: LiveQuizSession, item: QuestionBankItem) -> Dict[str, Any]:
    """How the room answered the current question - the host's "which one was hard?"
    view. Only meaningful for option-based types; others report counts only."""
    answers = db.query(LiveQuizAnswer).filter(
        LiveQuizAnswer.session_id == session.id,
        LiveQuizAnswer.question_index == session.current_index,
    ).all()

    total = len(answers)
    correct = sum(1 for a in answers if a.correct)
    dist: Dict[str, int] = {}
    if item.question_type in ("single_choice", "multi_select"):
        options = _payload(item).get("options") or []
        dist = {o: 0 for o in options}
        for a in answers:
            try:
                raw = json.loads(a.response_json) if a.response_json else None
            except (json.JSONDecodeError, TypeError):
                continue
            picks = raw if isinstance(raw, list) else [raw]
            for p in picks:
                if isinstance(p, int) and 0 <= p < len(options):
                    dist[options[p]] += 1
    return {
        "answered": total,
        "correct": correct,
        "distribution": dist,
        "answer_key": _readable_answer(item),
    }


def _readable_answer(item: QuestionBankItem) -> str:
    payload = _payload(item)
    try:
        t = item.question_type
        if t == "single_choice":
            return payload["options"][payload["correct_index"]]
        if t == "multi_select":
            return ", ".join(payload["options"][i] for i in payload["correct_indices"])
        if t == "true_false":
            return "True" if payload["correct"] else "False"
        if t == "fill_blank":
            return " / ".join(payload["accepted"])
        if t == "matching":
            return "; ".join(f"{p['left']} → {p['right']}" for p in payload["pairs"])
    except (KeyError, IndexError, TypeError):
        pass
    return ""


def record_answer(
    db: Session, session: LiveQuizSession, participant: LiveQuizParticipant,
    item: QuestionBankItem, response: Any,
) -> Optional[Dict[str, Any]]:
    """Scores one live answer. Returns None if this player already answered.

    Points = the question's own points for a correct answer, plus a speed bonus that
    decays linearly across the question's time window. A wrong answer scores zero and
    earns no bonus - speed is only worth rewarding when it is also right.
    """
    existing = db.query(LiveQuizAnswer).filter(
        LiveQuizAnswer.session_id == session.id,
        LiveQuizAnswer.participant_id == participant.id,
        LiveQuizAnswer.question_index == session.current_index,
    ).first()
    if existing:
        return None

    elapsed = None
    if session.question_started_at:
        elapsed = max(0.0, (datetime.utcnow() - session.question_started_at).total_seconds())

    payload = _payload(item)
    served = qb.public_payload(item.question_type, payload, shuffle=False)
    full, fraction = qb.grade(item.question_type, payload, response, served=served)

    points = float(item.points or 1) * fraction
    if fraction > 0 and session.speed_bonus_max and elapsed is not None:
        window = max(1, session.seconds_per_question)
        speed_ratio = max(0.0, 1.0 - (elapsed / window))
        points += session.speed_bonus_max * speed_ratio * fraction

    points = round(points, 2)

    db.add(LiveQuizAnswer(
        session_id=session.id, participant_id=participant.id,
        question_index=session.current_index, question_id=item.id,
        response_json=json.dumps(response), correct=full,
        points_awarded=points, answered_in_seconds=elapsed,
    ))
    participant.score = round(float(participant.score or 0) + points, 2)
    if full:
        participant.correct_count = (participant.correct_count or 0) + 1

    return {"correct": full, "points_awarded": points, "answered_in_seconds": elapsed}


def build_state(
    db: Session, session: LiveQuizSession, for_host: bool = False,
) -> Dict[str, Any]:
    """The single message shape every client renders from."""
    questions = load_questions(db, session)
    participants = db.query(LiveQuizParticipant).filter(
        LiveQuizParticipant.session_id == session.id
    ).count()

    state: Dict[str, Any] = {
        "type": "state",
        "code": session.access_code,
        "title": session.title,
        "status": session.status,
        "current_index": session.current_index,
        "total_questions": len(questions),
        "participants": participants,
        "seconds_per_question": session.seconds_per_question,
        "leaderboard": leaderboard(db, session.id),
    }

    item = current_question(db, session)
    if item and session.status in ("question", "reveal"):
        state["question"] = public_question(item, session.current_index, len(questions))
        if session.question_started_at:
            elapsed = (datetime.utcnow() - session.question_started_at).total_seconds()
            state["remaining_seconds"] = max(0, int(session.seconds_per_question - elapsed))
        # The answer key and the distribution go out at reveal, and to the host at any
        # time - the host is reading the question aloud and needs to see it.
        if session.status == "reveal" or for_host:
            state["reveal"] = answer_distribution(db, session, item)

    return state


# ─────────────────────────── connection hub ───────────────────────────

class LiveHub:
    """Process-local registry of open sockets, grouped by access code.

    Deliberately dumb: it holds no game state, only who to notify. Everything a client
    needs is rebuilt from the database on each broadcast, so a client that missed a
    message is corrected by the next one rather than drifting.
    """

    def __init__(self) -> None:
        self._rooms: Dict[str, Set[Any]] = {}
        self._lock = asyncio.Lock()

    async def join(self, code: str, socket: Any) -> None:
        async with self._lock:
            self._rooms.setdefault(code, set()).add(socket)

    async def leave(self, code: str, socket: Any) -> None:
        async with self._lock:
            room = self._rooms.get(code)
            if not room:
                return
            room.discard(socket)
            if not room:
                self._rooms.pop(code, None)

    async def broadcast(self, code: str, message: Dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._rooms.get(code, ()))
        dead = []
        for s in sockets:
            try:
                await s.send_json(message)
            except Exception:
                # A socket that fails a send is already gone; drop it rather than
                # letting one dead client block the rest of the room.
                dead.append(s)
        for s in dead:
            await self.leave(code, s)

    def room_size(self, code: str) -> int:
        return len(self._rooms.get(code, ()))


hub = LiveHub()
