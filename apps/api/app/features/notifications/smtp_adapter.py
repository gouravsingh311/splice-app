"""SMTP email adapter for sending notifications."""

import smtplib
from email.message import EmailMessage

from app.core.logging import get_logger

logger = get_logger(__name__)


class SmtpEmailAdapter:
    """Sends emails using standard library smtplib."""

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        from_email: str,
    ) -> None:
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_email = from_email

    def send_email(self, to_email: str, subject: str, html_body: str) -> bool:
        """Sends an HTML email. Returns True if successful, False otherwise."""

        # Wrap the raw HTML body in a professional branded template
        styled_html = self._wrap_in_template(subject, html_body)

        if not self.host or not self.port:
            logger.warning("SMTP adapter not fully configured, skipping email dispatch.")
            return False

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.from_email
        msg["To"] = to_email
        msg.set_content(styled_html, subtype="html")

        try:
            logger.info(
                "Connecting to SMTP server.",
                extra={"smtp_host": self.host, "smtp_port": self.port},
            )
            with smtplib.SMTP(self.host, self.port) as server:
                # Upgrades the connection to secure TLS if supported by the server
                server.starttls()
                if self.username and self.password:
                    server.login(self.username, self.password)
                server.send_message(msg)
            logger.info("Successfully sent email.", extra={"recipient_email": to_email})
            return True
        except Exception as e:
            logger.exception(
                "Failed to send email.",
                extra={"recipient_email": to_email, "error_message": str(e)},
            )
            return False

    def _wrap_in_template(self, subject: str, content: str) -> str:
        """Wraps the email content in a professional HTML template loaded from disk."""
        import pathlib

        try:
            template_path = (
                pathlib.Path(__file__).parent.parent.parent
                / "templates"
                / "email_notification.html"
            )
            template = template_path.read_text("utf-8")
            return template.replace("{{SUBJECT}}", subject).replace("{{CONTENT}}", content)
        except Exception as error:
            logger.exception("Failed to load email template.", extra={"error_message": str(error)})
            return content
