"""Base class and shared helpers for Admin service."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.features.admin.contracts import (
    AdminConfigRecord,
    IntegrationRecommendedAction,
    IntegrationStatusClass,
    IntegrationTestResult,
)
from app.features.audit.service import AuditEventStore
from app.features.qc.contracts import QcActorRole


class AdminBaseService:
    """Base class with shared DB and setup logic for Admin service."""

    def __init__(
        self,
        *,
        audit: AuditEventStore,
        now_fn: Callable[[], datetime] | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self._connection = connection or get_connection()
        self._audit = audit
        self._now = now_fn or (lambda: datetime.now(UTC))
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_configs (
              id TEXT PRIMARY KEY,
              config_type TEXT NOT NULL,
              version INTEGER NOT NULL DEFAULT 1,
              payload_json TEXT NOT NULL,
              published_by TEXT,
              published_at TEXT,
              is_draft INTEGER DEFAULT 1,
              created_at TEXT NOT NULL
            );
            """
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS integration_secrets_meta (
              id TEXT PRIMARY KEY,
              provider TEXT NOT NULL,
              key_ref TEXT NOT NULL,
              rotated_at TEXT,
              status TEXT DEFAULT 'active',
              created_at TEXT NOT NULL
            );
            """
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS integration_health (
              provider TEXT PRIMARY KEY,
              status_class TEXT NOT NULL,
              recommended_action TEXT NOT NULL,
              status_copy TEXT NOT NULL,
              credential_status TEXT NOT NULL,
              last_checked_at TEXT NOT NULL,
              last_rotated_at TEXT,
              last_failure_context TEXT,
              last_error TEXT,
              last_latency_ms INTEGER NOT NULL,
              updated_by TEXT NOT NULL
            );
            """
        )
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS integration_credentials (
              provider TEXT PRIMARY KEY,
              credentials_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            """
        )
        integration_credentials_columns = {
            row[1]
            for row in self._connection.execute("PRAGMA table_info(integration_credentials)").fetchall()
        }
        if "credentials_json" not in integration_credentials_columns:
            self._connection.execute("ALTER TABLE integration_credentials ADD COLUMN credentials_json TEXT")
        if "updated_at" not in integration_credentials_columns:
            self._connection.execute("ALTER TABLE integration_credentials ADD COLUMN updated_at TEXT")
        has_legacy_dropbox_columns = (
            "app_key" in integration_credentials_columns
            and "app_secret" in integration_credentials_columns
            and "refresh_token" in integration_credentials_columns
            and "access_token" in integration_credentials_columns
        )
        if has_legacy_dropbox_columns:
            rows = self._connection.execute(
                """
                SELECT provider, app_key, app_secret, refresh_token, access_token, credentials_json, updated_at
                FROM integration_credentials
                """
            ).fetchall()
            now_iso = self._now().isoformat()
            for row in rows:
                current_json = str(row["credentials_json"] or "").strip()
                if current_json:
                    continue
                provider = str(row["provider"] or "").strip()
                if not provider:
                    continue
                migrated = {}
                app_key = str(row["app_key"] or "").strip()
                app_secret = str(row["app_secret"] or "").strip()
                refresh_token = str(row["refresh_token"] or "").strip()
                access_token = str(row["access_token"] or "").strip()
                if app_key:
                    migrated["app_key"] = app_key
                if app_secret:
                    migrated["app_secret"] = app_secret
                if refresh_token:
                    migrated["refresh_token"] = refresh_token
                if access_token:
                    migrated["access_token"] = access_token
                self._connection.execute(
                    """
                    UPDATE integration_credentials
                    SET credentials_json = ?, updated_at = COALESCE(updated_at, ?)
                    WHERE provider = ?
                    """,
                    (json.dumps(migrated, separators=(",", ":"), ensure_ascii=True), now_iso, provider),
                )
        self._connection.commit()

    def _assert_admin(self, *, actor_role: QcActorRole, actor_id: str) -> None:
        if actor_role != QcActorRole.ADMIN:
            raise DomainError(
                code="AUTH_FORBIDDEN",
                message="Only admin role can access admin operations.",
                status_code=403,
                details={"actor_id": actor_id, "actor_role": actor_role.value},
            )

    def _require_confirmation(self, *, provided: str, expected: str, action: str) -> None:
        if provided.strip().upper() != expected:
            raise DomainError(
                code="VALIDATION_ERROR",
                message=f"Confirmation text must be '{expected}' before {action}.",
                status_code=422,
                details={"expected": expected, "provided": provided},
            )

    def _map_row(self, row) -> AdminConfigRecord:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
        return AdminConfigRecord(
            id=row["id"],
            config_type=row["config_type"],
            version=row["version"],
            payload_json=payload if isinstance(payload, dict) else {"value": payload},
            published_by=row["published_by"],
            published_at=datetime.fromisoformat(row["published_at"])
            if row["published_at"]
            else None,
            is_draft=bool(row["is_draft"]),
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    def _map_health_response(
        self,
        *,
        provider: str,
        row,
        fallback_checked_at: datetime,
        fallback_rotated_at: datetime | None,
    ) -> IntegrationTestResult:
        if row is None:
            return IntegrationTestResult(
                provider=provider,
                ok=False,
                latency_ms=0,
                status_class=IntegrationStatusClass.UNCONFIGURED,
                recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
                status_copy=(
                    "Credentials are missing. Configure credentials in setup, then run a connection test."
                ),
                credential_status="missing",
                last_checked_at=fallback_checked_at,
                last_rotated_at=fallback_rotated_at,
                last_failure_context="No credentials are configured for this provider.",
                error="Credentials not configured.",
            )

        status_class = IntegrationStatusClass(row["status_class"])
        recommended_action = IntegrationRecommendedAction(row["recommended_action"])
        last_checked_at = datetime.fromisoformat(row["last_checked_at"])
        last_rotated_at = (
            datetime.fromisoformat(row["last_rotated_at"]) if row["last_rotated_at"] else None
        )
        last_error = row["last_error"]

        return IntegrationTestResult(
            provider=provider,
            ok=status_class == IntegrationStatusClass.HEALTHY,
            latency_ms=max(0, int(row["last_latency_ms"] or 0)),
            status_class=status_class,
            recommended_action=recommended_action,
            status_copy=row["status_copy"],
            credential_status=row["credential_status"],
            last_checked_at=last_checked_at,
            last_rotated_at=last_rotated_at,
            last_failure_context=row["last_failure_context"],
            error=last_error,
        )
