"""Live quiz endpoints: REST to create and join a room, WebSocket to play it.

WHY BOTH
--------
Creating and joining are ordinary authenticated requests that happen once, so they use
normal HTTP and normal dependencies. Playing is a stream of small updates to many
clients at once, which is exactly what HTTP is bad at - so the game loop is a
WebSocket. The socket carries no authority of its own: it is authenticated at
handshake time from the same JWT, and every action it accepts is re-checked against
the database.

WEBSOCKET AUTHENTICATION
------------------------
A browser WebSocket cannot set an Authorization header, so the token is passed as a
query parameter and decoded with the same decode_access_token used by the HTTP
dependency. That puts a credential in a URL, which is normally something to avoid -
here it is same-origin, never logged by this app, and the alternative (an unauthenticated
socket that trusts a client-sent user id) is far worse.
"""
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status,
)
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.auth.routes import get_current_teacher, get_current_user
from app.auth.utils import decode_access_token
from app.courses.access import assert_course_access
from app.database.connection import SessionLocal, get_db
from app.database.models import (
    Course, LiveQuizAnswer, LiveQuizParticipant, LiveQuizSession, QuestionBankItem, User,
)
from app.live import service as live

router = APIRouter(tags=["Live Quiz"])
logger = logging.getLogger("conceptintel.live")


class CreateSessionRequest(BaseModel):
    title: str
    question_ids: List[int]
    seconds_per_question: int = 30
    speed_bonus_max: int = 0

    @field_validator("title")
    @classmethod
    def non_empty(cls, v: str) -> str:
        if not (v or "").strip():
            raise ValueError("A live quiz needs a title.")
        return v.strip()

    @field_validator("question_ids")
    @classmethod
    def has_questions(cls, v: List[int]) -> List[int]:
        if not v:
            raise ValueError("Pick at least one question for the live quiz.")
        if len(v) > 50:
            raise ValueError("A live quiz can have at most 50 questions.")
        return v

    @field_validator("seconds_per_question")
    @classmethod
    def sane_seconds(cls, v: int) -> int:
        if not (live.MIN_SECONDS_PER_QUESTION <= v <= live.MAX_SECONDS_PER_QUESTION):
            raise ValueError(
                f"seconds_per_question must be between {live.MIN_SECONDS_PER_QUESTION} "
                f"and {live.MAX_SECONDS_PER_QUESTION}"
            )
        return v

    @field_validator("speed_bonus_max")
    @classmethod
    def sane_bonus(cls, v: int) -> int:
        if not (0 <= v <= 100):
            raise ValueError("speed_bonus_max must be between 0 and 100")
        return v


class JoinRequest(BaseModel):
    code: str
    nickname: str

    @field_validator("code")
    @classmethod
    def clean_code(cls, v: str) -> str:
        return (v or "").strip().upper()

    @field_validator("nickname")
    @classmethod
    def clean_nickname(cls, v: str) -> str:
        name = (v or "").strip()
        if not (2 <= len(name) <= 24):
            raise ValueError("Pick a nickname between 2 and 24 characters.")
        return name


class SessionOut(BaseModel):
    id: int
    code: str
    title: str
    status: str
    question_count: int
    seconds_per_question: int
    speed_bonus_max: int
    participants: int


class JoinOut(BaseModel):
    session_id: int
    participant_id: int
    code: str
    title: str
    nickname: str
    status: str


def _to_session_out(db: Session, s: LiveQuizSession) -> SessionOut:
    return SessionOut(
        id=s.id, code=s.access_code, title=s.title, status=s.status,
        question_count=len(live.session_question_ids(s)),
        seconds_per_question=s.seconds_per_question, speed_bonus_max=s.speed_bonus_max,
        participants=db.query(LiveQuizParticipant).filter(
            LiveQuizParticipant.session_id == s.id
        ).count(),
    )


# ──────────────────────────────── REST ────────────────────────────────

@router.post("/courses/{course_id}/live/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def create_session(
    course_id: int,
    payload: CreateSessionRequest,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    """Opens a lobby and returns the code players type in."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    if course.teacher_id != current_teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You are not the instructor of this course."
        )

    owned = {
        i for (i,) in db.query(QuestionBankItem.id).filter(
            QuestionBankItem.id.in_(payload.question_ids),
            QuestionBankItem.course_id == course_id,
        ).all()
    }
    ids = [i for i in payload.question_ids if i in owned]
    if not ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="None of those questions belong to this course's bank.",
        )

    session = LiveQuizSession(
        course_id=course_id, host_id=current_teacher.id,
        access_code=live.generate_access_code(db), title=payload.title,
        question_ids_json=json.dumps(ids),
        seconds_per_question=payload.seconds_per_question,
        speed_bonus_max=payload.speed_bonus_max,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return _to_session_out(db, session)


@router.get("/courses/{course_id}/live/sessions", response_model=List[SessionOut])
def list_sessions(
    course_id: int,
    db: Session = Depends(get_db),
    current_teacher: User = Depends(get_current_teacher),
):
    rows = db.query(LiveQuizSession).filter(
        LiveQuizSession.course_id == course_id
    ).order_by(LiveQuizSession.created_at.desc()).limit(25).all()
    return [_to_session_out(db, s) for s in rows]


@router.post("/live/join", response_model=JoinOut)
def join_session(
    payload: JoinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Joins a lobby by code. Re-joining with the same account returns the existing
    participant rather than creating a duplicate, so a refresh keeps your score.

    Student-only: unlike practice/study/exams, this had no role gate at all until
    now, so a teacher joining as a player was indistinguishable from a student -
    their LiveQuizParticipant/LiveQuizAnswer rows were written and scored
    identically, silently entering a phantom player on their own leaderboard.
    """
    if current_user.role.lower() != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Live quizzes are played by students - as the instructor, you're the host, not a player.",
        )

    session = db.query(LiveQuizSession).filter(
        LiveQuizSession.access_code == payload.code,
        LiveQuizSession.status != "ended",
    ).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No live quiz found with that code. Check it and try again.",
        )

    course = db.query(Course).filter(Course.id == session.course_id).first()
    if course:
        assert_course_access(db, course, current_user)

    existing = db.query(LiveQuizParticipant).filter(
        LiveQuizParticipant.session_id == session.id,
        LiveQuizParticipant.user_id == current_user.id,
    ).first()
    if existing:
        return JoinOut(
            session_id=session.id, participant_id=existing.id, code=session.access_code,
            title=session.title, nickname=existing.nickname, status=session.status,
        )

    if session.status != "waiting":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz has already started - ask the host to run it again.",
        )

    # Nicknames are unique per room so the leaderboard is unambiguous.
    nickname = payload.nickname
    clash = db.query(LiveQuizParticipant).filter(
        LiveQuizParticipant.session_id == session.id,
        LiveQuizParticipant.nickname == nickname,
    ).first()
    if clash:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Someone in this room already took that nickname - pick another.",
        )

    participant = LiveQuizParticipant(
        session_id=session.id, user_id=current_user.id, nickname=nickname,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    return JoinOut(
        session_id=session.id, participant_id=participant.id, code=session.access_code,
        title=session.title, nickname=participant.nickname, status=session.status,
    )


@router.get("/live/{code}/state")
def get_state(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """HTTP fallback for the live state, for a client whose socket dropped."""
    session = db.query(LiveQuizSession).filter(
        LiveQuizSession.access_code == code.strip().upper()
    ).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live quiz not found")
    return live.build_state(db, session, for_host=session.host_id == current_user.id)


# ───────────────────────────── WebSocket ──────────────────────────────

async def _push_state(db: Session, session: LiveQuizSession) -> None:
    """Broadcasts the player view to the room.

    The host receives the same message: everything the host sees beyond it (the answer
    key, the distribution) is already in `reveal`, which is included for the host in
    build_state. Sending one message to everyone keeps the room from ever showing two
    different truths.
    """
    await live.hub.broadcast(session.access_code, live.build_state(db, session, for_host=True))


@router.websocket("/live/ws/{code}")
async def live_socket(
    websocket: WebSocket,
    code: str,
    token: str = Query(...),
    participant_id: Optional[int] = Query(None),
):
    code = code.strip().upper()
    payload = decode_access_token(token)
    if not payload or not payload.get("user_id"):
        await websocket.close(code=4401)
        return
    user_id = int(payload["user_id"])

    await websocket.accept()
    db: Session = SessionLocal()
    try:
        session = db.query(LiveQuizSession).filter(
            LiveQuizSession.access_code == code
        ).first()
        if not session:
            await websocket.send_json({"type": "error", "detail": "Live quiz not found."})
            await websocket.close(code=4404)
            return

        is_host = session.host_id == user_id
        participant = None
        if not is_host:
            participant = db.query(LiveQuizParticipant).filter(
                LiveQuizParticipant.session_id == session.id,
                LiveQuizParticipant.user_id == user_id,
            ).first()
            if participant is None:
                await websocket.send_json({"type": "error", "detail": "Join the quiz before connecting."})
                await websocket.close(code=4403)
                return

        await live.hub.join(code, websocket)
        await websocket.send_json({
            "type": "welcome",
            "is_host": is_host,
            "participant_id": participant.id if participant else None,
        })
        await _push_state(db, session)

        while True:
            raw = await websocket.receive_json()
            action = (raw or {}).get("action")
            db.expire_all()  # another connection may have advanced the game
            session = db.query(LiveQuizSession).filter(LiveQuizSession.id == session.id).first()
            if session is None:
                break

            if action == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            # ── host controls ──
            if action in ("start", "next", "end") and is_host:
                questions = live.load_questions(db, session)
                if action == "end" or (action == "next" and session.current_index + 1 >= len(questions)):
                    session.status = "ended"
                    session.ended_at = datetime.utcnow()
                elif action == "start":
                    if session.status == "waiting":
                        session.current_index = 0
                        session.status = "question"
                        session.started_at = datetime.utcnow()
                        session.question_started_at = datetime.utcnow()
                elif action == "next":
                    # "next" from a live question reveals it; from a reveal it advances.
                    if session.status == "question":
                        session.status = "reveal"
                    else:
                        session.current_index += 1
                        session.status = "question"
                        session.question_started_at = datetime.utcnow()
                db.commit()
                await _push_state(db, session)
                continue

            # ── player answers ──
            if action == "answer" and participant is not None:
                if session.status != "question":
                    await websocket.send_json({"type": "error", "detail": "No question is open."})
                    continue
                item = live.current_question(db, session)
                if item is None:
                    continue
                outcome = live.record_answer(db, session, participant, item, raw.get("response"))
                if outcome is None:
                    await websocket.send_json({"type": "error", "detail": "You already answered this one."})
                    continue
                db.commit()
                await websocket.send_json({"type": "answer_received", **outcome})
                # Everyone sees the answered-count tick up, without the answer itself.
                await _push_state(db, session)
                continue

            await websocket.send_json({"type": "error", "detail": "Unknown or not-permitted action."})

    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.warning("Live socket error in room %s: %s: %s", code, type(e).__name__, e)
    finally:
        await live.hub.leave(code, websocket)
        db.close()
