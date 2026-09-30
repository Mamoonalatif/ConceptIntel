# AI assistant chat routes (mounted at /assistant): list, send and clear the signed-in user's chat history.
import logging
from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import ChatMessage, User
from app.assistant.schemas import ChatMessageCreate, ChatMessageResponse
from app.assistant.services import generate_assistant_reply, FALLBACK_MESSAGE
from app.auth.routes import get_current_user

logger = logging.getLogger("conceptintel.assistant")

# One ongoing chat thread per user; every route needs a logged-in user.
router = APIRouter(prefix="/assistant", tags=["AI Assistant"])


@router.get("/messages", response_model=List[ChatMessageResponse])
def list_messages(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Oldest-first page of the current user's single ongoing assistant thread
    (most recent `limit` messages)."""
    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.user_id == current_user.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    return list(reversed(messages))


@router.post("/messages", response_model=ChatMessageResponse, status_code=status.HTTP_201_CREATED)
def send_message(
    payload: ChatMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stores the user's message, calls the configured AI provider for a reply
    (graceful offline fallback if unconfigured/failing), stores the assistant's
    reply, and returns it. generate_assistant_reply() itself never raises, but
    this wraps the whole thing anyway so a DB hiccup can't turn into the
    frontend's generic "something went wrong" error either - the user should
    always get an actual reply bubble, even the offline fallback text."""
    try:
        history = (
            db.query(ChatMessage)
            .filter(ChatMessage.user_id == current_user.id)
            .order_by(ChatMessage.created_at.asc())
            .all()
        )

        user_message = ChatMessage(user_id=current_user.id, role="user", content=payload.content)
        db.add(user_message)
        db.commit()
        db.refresh(user_message)

        reply_content = generate_assistant_reply(db, current_user, history, payload.content)

        assistant_message = ChatMessage(user_id=current_user.id, role="assistant", content=reply_content)
        db.add(assistant_message)
        db.commit()
        db.refresh(assistant_message)

        return assistant_message
    except Exception as e:
        logger.error(f"send_message failed unexpectedly: {str(e)}")
        db.rollback()
        # Still return a real ChatMessageResponse shape rather than raising -
        # not persisted, since we can't trust the session state after a rollback,
        # but the user sees a coherent reply instead of a broken error bubble.
        from datetime import datetime
        return ChatMessageResponse(
            id=-1, role="assistant", content=FALLBACK_MESSAGE, created_at=datetime.utcnow(),
        )


@router.delete("/messages", status_code=status.HTTP_204_NO_CONTENT)
def clear_messages(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clears the current user's chat history - a "new conversation" action."""
    db.query(ChatMessage).filter(ChatMessage.user_id == current_user.id).delete(synchronize_session=False)
    db.commit()
    return None
