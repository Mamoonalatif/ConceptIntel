import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger("conceptintel")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465


def is_configured() -> bool:
    return bool(settings.SMTP_EMAIL and settings.SMTP_APP_PASSWORD)


def send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Best-effort send via Gmail SMTP with an App Password. Returns True if the email
    was sent, False if email isn't configured or sending failed - callers should treat
    this as non-fatal (e.g. still show credentials in the API response as a fallback)."""
    if not is_configured():
        logger.info("Email delivery skipped (SMTP_EMAIL/SMTP_APP_PASSWORD not set): %s", subject)
        return False

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = settings.SMTP_EMAIL
    message["To"] = to_email
    message.attach(MIMEText(html_body, "html"))

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
            server.login(settings.SMTP_EMAIL, settings.SMTP_APP_PASSWORD)
            server.sendmail(settings.SMTP_EMAIL, to_email, message.as_string())
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False


def send_staff_credentials_email(to_email: str, full_name: str, role_label: str, temporary_password: str) -> bool:
    subject = f"Your ConceptIntel {role_label} account"
    html_body = f"""
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #4f46e5;">Welcome to ConceptIntel</h2>
      <p>Hi {full_name},</p>
      <p>An administrator has created a <strong>{role_label}</strong> account for you on ConceptIntel.</p>
      <p style="background: #f8faff; border: 1px solid #dde3f0; border-radius: 8px; padding: 12px 16px;">
        <strong>Email:</strong> {to_email}<br/>
        <strong>Temporary password:</strong> <code>{temporary_password}</code>
      </p>
      <p>Please sign in and change your password as soon as possible.</p>
      <p style="color: #94a3b8; font-size: 12px;">If you weren't expecting this email, you can ignore it.</p>
    </div>
    """
    return send_email(to_email, subject, html_body)
