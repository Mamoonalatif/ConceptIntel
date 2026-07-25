from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import ChatMessage, User
from app.assistant.schemas import ChatMessageCreate, ChatMessageResponse
from app.assistant.services import generate_assistant_reply
from app.auth.routes import get_current_user

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
    """Stores the user's message, calls OpenAI for a reply (graceful offline
    fallback if unconfigured/failing - never a 500), stores the assistant's reply,
    and returns the reply."""
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

    reply_content = generate_assistant_reply(history, payload.content)

    assistant_message = ChatMessage(user_id=current_user.id, role="assistant", content=reply_content)
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    return assistant_message


@router.delete("/messages", status_code=status.HTTP_204_NO_CONTENT)
def clear_messages(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clears the current user's chat history - a "new conversation" action."""
    db.query(ChatMessage).filter(ChatMessage.user_id == current_user.id).delete(synchronize_session=False)
    db.commit()
    return None
