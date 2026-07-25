import logging

from fastapi import APIRouter

from app.config import settings
from app.email_service import is_configured, send_email
from app.contact.schemas import ContactMessageCreate, ContactMessageResponse

logger = logging.getLogger("conceptintel")

router = APIRouter(prefix="/contact", tags=["Contact"])


@router.post("", response_model=ContactMessageResponse)
def submit_contact_message(payload: ContactMessageCreate):
    """Public (no-auth) contact form submission - forwards the message to the
    platform's own configured SMTP_EMAIL via the existing email infrastructure.
    If SMTP isn't configured, this is a best-effort no-op (logged, not errored)
    so the frontend still gets a success response - mirrors how other best-effort
    sends in this codebase (see app/email_service.py) treat a missing SMTP config
    as non-fatal rather than user-facing failure."""
    subject = f"Contact form: {payload.name}"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0f766e;">New ConceptIntel contact form message</h2>
      <p><strong>From:</strong> {payload.name} ({payload.email})</p>
      <p style="background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 8px; padding: 12px 16px; white-space: pre-wrap;">
        {payload.message}
      </p>
    </div>
    """

    if not is_configured():
        logger.warning(
            "Contact form submitted but SMTP is not configured - message not emailed (from %s <%s>)",
            payload.name, payload.email,
        )
        return ContactMessageResponse(success=True, detail="Message received.")

    sent = send_email(to_email=settings.SMTP_EMAIL, subject=subject, html_body=html_body)
    if not sent:
        logger.warning("Contact form email failed to send (from %s <%s>)", payload.name, payload.email)

    return ContactMessageResponse(success=True, detail="Message sent.")
