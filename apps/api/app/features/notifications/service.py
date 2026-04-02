"""PRD-10 notification service backed by SQLite inbox and retry support."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.notifications.contracts import (
    EmitNotificationRequest,
    EmitNotificationResponse,
    ListNotificationsRequest,
    ListNotificationsResponse,
    MarkAllNotificationsReadRequest,
    MarkAllNotificationsReadResponse,
    MarkNotificationsReadRequest,
    MarkNotificationsReadResponse,
    NotificationActorRole,
    NotificationErrorCode,
    NotificationItem,
    NotificationSeverity,
    NotificationStatus,
    NotificationType,
    RetryNotificationRequest,
    RetryNotificationResponse,
)
from app.features.notifications.smtp_adapter import SmtpEmailAdapter

logger = get_logger(__name__)


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    else:
        value = value.astimezone(UTC)
    return value.isoformat()


def _from_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


class NotificationService:
    """SQLite implementation for notification list/read/retry interactions."""

    def __init__(
        self,
        *,
        now_fn: Callable[[], datetime] = _utcnow,
        email_adapter: SmtpEmailAdapter | None = None,
    ) -> None:
        self._now_fn = now_fn
        self._email_adapter = email_adapter
        self._connection = get_connection()
        self._lock = threading.Lock()
        self._ensure_table()

    def _ensure_table(self) -> None:
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
              notification_id TEXT PRIMARY KEY,
              type TEXT,
              severity TEXT,
              status TEXT,
              channel TEXT,
              title TEXT,
              message TEXT,
              submission_id TEXT,
              recipient_email TEXT,
              read INTEGER NOT NULL DEFAULT 0,
              read_at TEXT,
              attempts INTEGER DEFAULT 0,
              max_attempts INTEGER DEFAULT 3,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        self._connection.commit()
        logger.info("Ensured notifications table exists.")

    def _row_to_model(self, row) -> NotificationItem:
        return NotificationItem(
            notification_id=row["notification_id"],
            type=NotificationType(row["type"]),
            severity=NotificationSeverity(row["severity"]),
            status=NotificationStatus(row["status"]),
            channel=row["channel"],
            title=row["title"],
            message=row["message"],
            submission_id=row["submission_id"],
            read=bool(row["read"]),
            read_at=_from_iso(row["read_at"]),
            attempts=int(row["attempts"]),
            max_attempts=int(row["max_attempts"]),
            created_at=_from_iso(row["created_at"]),
            updated_at=_from_iso(row["updated_at"]),
        )

    def _get_record_row(self, notification_id: str):
        return self._connection.execute(
            """
            SELECT notification_id, type, severity, status, channel, title, message,
                   submission_id, recipient_email, read, read_at, attempts, max_attempts,
                   created_at, updated_at
            FROM notifications
            WHERE notification_id = ?
            """,
            (notification_id,),
        ).fetchone()

    def _get_record_row_with_owner(self, notification_id: str):
        return self._connection.execute(
            """
            SELECT n.notification_id, n.type, n.severity, n.status, n.channel, n.title, n.message,
                   n.submission_id, n.recipient_email, n.read, n.read_at, n.attempts, n.max_attempts,
                   n.created_at, n.updated_at, s.creator_id AS submission_creator_id
            FROM notifications n
            LEFT JOIN submissions s ON s.id = n.submission_id
            WHERE n.notification_id = ?
            """,
            (notification_id,),
        ).fetchone()

    def _fetch_record_rows_with_owner(self, notification_ids: list[str]):
        placeholders = ", ".join("?" for _ in notification_ids)
        return self._connection.execute(
            f"""
            SELECT n.notification_id, n.type, n.severity, n.status, n.channel, n.title, n.message,
                   n.submission_id, n.recipient_email, n.read, n.read_at, n.attempts, n.max_attempts,
                   n.created_at, n.updated_at, s.creator_id AS submission_creator_id
            FROM notifications n
            LEFT JOIN submissions s ON s.id = n.submission_id
            WHERE n.notification_id IN ({placeholders})
            """,
            tuple(notification_ids),
        ).fetchall()

    def _actor_has_global_access(self, actor_role: NotificationActorRole) -> bool:
        return actor_role in {NotificationActorRole.REVIEWER, NotificationActorRole.ADMIN}

    def _raise_scope_forbidden(
        self,
        *,
        actor_id: str,
        actor_role: NotificationActorRole,
        notification_ids: list[str] | None = None,
    ) -> None:
        details = {"actor_id": actor_id, "actor_role": actor_role.value}
        if notification_ids:
            details["notification_ids"] = list(notification_ids)
        raise DomainError(
            code=NotificationErrorCode.NOTIFICATION_SCOPE_FORBIDDEN,
            message="Notification access is outside the actor's scope.",
            status_code=403,
            details=details,
        )

    def _normalize_notification_type(self, value: str) -> NotificationType:
        normalized = str(value or "").strip().lower()
        try:
            return NotificationType(normalized)
        except ValueError as exc:
            raise DomainError(
                code=NotificationErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Notification type is not supported.",
                status_code=422,
                details={"type": value},
            ) from exc

    def _normalize_notification_severity(self, value: str) -> NotificationSeverity:
        normalized = str(value or "").strip().lower()
        try:
            return NotificationSeverity(normalized)
        except ValueError as exc:
            raise DomainError(
                code=NotificationErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Notification severity is not supported.",
                status_code=422,
                details={"severity": value},
            ) from exc

    def list_notifications(self, request: ListNotificationsRequest) -> ListNotificationsResponse:
        if self._actor_has_global_access(request.actor_role):
            query = (
                """
                SELECT notification_id, type, severity, status, channel, title, message,
                       submission_id, recipient_email, read, read_at, attempts, max_attempts,
                       created_at, updated_at
                FROM notifications
                """
            )
            params: tuple[object, ...] = ()
            if not request.include_read:
                query += " WHERE read = 0"
            query += " ORDER BY created_at DESC"
        else:
            query = (
                """
                SELECT n.notification_id, n.type, n.severity, n.status, n.channel, n.title, n.message,
                       n.submission_id, n.recipient_email, n.read, n.read_at, n.attempts, n.max_attempts,
                       n.created_at, n.updated_at
                FROM notifications n
                INNER JOIN submissions s ON s.id = n.submission_id
                WHERE s.creator_id = ?
                """
            )
            params = (request.actor_id,)
            if not request.include_read:
                query += " AND n.read = 0"
            query += " ORDER BY n.created_at DESC"

        rows = self._connection.execute(query, params).fetchall()
        notifications = [self._row_to_model(row) for row in rows]
        logger.info(
            "Listed notifications.",
            extra={"returned_count": len(notifications), "include_read": request.include_read},
        )
        return ListNotificationsResponse(notifications=notifications)

    def mark_read(self, request: MarkNotificationsReadRequest) -> MarkNotificationsReadResponse:
        if not request.notification_ids:
            return MarkNotificationsReadResponse(updated_count=0)

        rows = self._fetch_record_rows_with_owner(request.notification_ids)
        rows_by_id = {row["notification_id"]: row for row in rows}
        missing_ids = [notification_id for notification_id in request.notification_ids if notification_id not in rows_by_id]
        if missing_ids:
            raise DomainError(
                code=NotificationErrorCode.NOTIFICATION_NOT_FOUND,
                message="Notification record not found.",
                status_code=404,
                details={"notification_ids": missing_ids},
            )

        if not self._actor_has_global_access(request.actor_role):
            out_of_scope_ids = [
                notification_id
                for notification_id, row in rows_by_id.items()
                if row["submission_creator_id"] != request.actor_id
            ]
            if out_of_scope_ids:
                self._raise_scope_forbidden(
                    actor_id=request.actor_id,
                    actor_role=request.actor_role,
                    notification_ids=out_of_scope_ids,
                )

        now_iso = _to_iso(self._now_fn())
        placeholders = ", ".join("?" for _ in request.notification_ids)
        with self._lock:
            cursor = self._connection.execute(
                f"""
                UPDATE notifications
                SET read = 1,
                    read_at = ?,
                    updated_at = ?
                WHERE read = 0
                  AND notification_id IN ({placeholders})
                """,
                (now_iso, now_iso, *request.notification_ids),
            )
            self._connection.commit()
        logger.info("Marked notifications read.", extra={"updated_count": cursor.rowcount})
        return MarkNotificationsReadResponse(updated_count=cursor.rowcount)

    def mark_all_read(
        self, request: MarkAllNotificationsReadRequest
    ) -> MarkAllNotificationsReadResponse:
        now_iso = _to_iso(self._now_fn())
        with self._lock:
            if self._actor_has_global_access(request.actor_role):
                cursor = self._connection.execute(
                    """
                    UPDATE notifications
                    SET read = 1,
                        read_at = ?,
                        updated_at = ?
                    WHERE read = 0
                    """,
                    (now_iso, now_iso),
                )
            else:
                cursor = self._connection.execute(
                    """
                    UPDATE notifications
                    SET read = 1,
                        read_at = ?,
                        updated_at = ?
                    WHERE read = 0
                      AND notification_id IN (
                        SELECT n.notification_id
                        FROM notifications n
                        INNER JOIN submissions s ON s.id = n.submission_id
                        WHERE s.creator_id = ?
                      )
                    """,
                    (now_iso, now_iso, request.actor_id),
                )
            self._connection.commit()
        logger.info("Marked all notifications read.", extra={"updated_count": cursor.rowcount})
        return MarkAllNotificationsReadResponse(updated_count=cursor.rowcount)

    def retry(self, request: RetryNotificationRequest) -> RetryNotificationResponse:
        logger.info(
            "Retrying notification dispatch.",
            extra={"notification_id": request.notification_id, "actor_id": request.actor_id},
        )
        if not self._actor_has_global_access(request.actor_role):
            raise DomainError(
                code=NotificationErrorCode.NOTIFICATION_RETRY_FORBIDDEN,
                message="Only reviewer or admin role can retry notification dispatch.",
                status_code=403,
                details={"actor_role": request.actor_role.value},
            )

        row = self._get_record_row_with_owner(request.notification_id)
        if not row:
            raise DomainError(
                code=NotificationErrorCode.NOTIFICATION_NOT_FOUND,
                message="Notification record not found.",
                status_code=404,
                details={"notification_id": request.notification_id},
            )

        attempts = int(row["attempts"]) + 1
        max_attempts = int(row["max_attempts"])
        channel = row["channel"]
        status = NotificationStatus(row["status"])

        if channel == "email" and self._email_adapter:
            to_email = row["recipient_email"] or "test.recipient@fileeaters.local"
            success = self._email_adapter.send_email(
                to_email=to_email,
                subject=f"Retry: {row['title']}",
                html_body=row["message"],
            )
            if success:
                status = NotificationStatus.SENT
            else:
                status = (
                    NotificationStatus.FAILED
                    if attempts >= max_attempts
                    else NotificationStatus.PENDING
                )
        else:
            if attempts >= max_attempts:
                status = NotificationStatus.FAILED
            else:
                status = NotificationStatus.SENT

        now_iso = _to_iso(self._now_fn())
        with self._lock:
            self._connection.execute(
                """
                UPDATE notifications
                SET attempts = ?,
                    status = ?,
                    updated_at = ?
                WHERE notification_id = ?
                """,
                (attempts, status.value, now_iso, request.notification_id),
            )
            self._connection.commit()

        updated = self._get_record_row(request.notification_id)
        logger.info(
            "Retried notification dispatch.",
            extra={"notification_id": request.notification_id, "status": status.value},
        )
        return RetryNotificationResponse(notification=self._row_to_model(updated))

    def emit_notification(self, request: EmitNotificationRequest) -> EmitNotificationResponse:
        notification_type = self._normalize_notification_type(request.type)
        notification_severity = self._normalize_notification_severity(request.severity)
        logger.info(
            "Emitting notification.",
            extra={
                "type": notification_type.value,
                "channel": request.channel,
                "submission_id": request.submission_id,
            },
        )
        record_id = f"ntf-{uuid.uuid4().hex[:8]}"
        now = self._now_fn()
        now_iso = _to_iso(now)

        status = NotificationStatus.PENDING
        if request.channel == "in_app":
            status = NotificationStatus.SENT
        elif not request.recipient_email:
            status = NotificationStatus.FAILED

        max_attempts = request.max_attempts or 3
        attempts = 0

        with self._lock:
            self._connection.execute(
                """
                INSERT INTO notifications (
                  notification_id, type, severity, status, channel, title, message,
                  submission_id, recipient_email, read, read_at,
                  attempts, max_attempts, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
                """,
                (
                    record_id,
                    notification_type.value,
                    notification_severity.value,
                    status.value,
                    request.channel,
                    request.title,
                    request.message,
                    request.submission_id,
                    request.recipient_email,
                    attempts,
                    max_attempts,
                    now_iso,
                    now_iso,
                ),
            )

            if request.channel == "email" and self._email_adapter and request.recipient_email:
                attempts = 1
                success = self._email_adapter.send_email(
                    to_email=request.recipient_email,
                    subject=request.title,
                    html_body=request.message,
                )
                if success:
                    status = NotificationStatus.SENT
                else:
                    status = (
                        NotificationStatus.FAILED
                        if attempts >= max_attempts
                        else NotificationStatus.PENDING
                    )

                self._connection.execute(
                    """
                    UPDATE notifications
                    SET attempts = ?, status = ?, updated_at = ?
                    WHERE notification_id = ?
                    """,
                    (attempts, status.value, _to_iso(self._now_fn()), record_id),
                )

            self._connection.commit()

        row = self._get_record_row(record_id)
        logger.info(
            "Notification emitted.",
            extra={"notification_id": record_id, "status": status.value},
        )
        return EmitNotificationResponse(notification=self._row_to_model(row))
