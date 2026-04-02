"""SQLite-backed admin config operations for PRD-14."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
from uuid import uuid4

from app.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType
from app.audit.service import AuditEventStore
from app.contracts.qc import QcActorRole
from app.db import get_connection
from app.domain.errors import DomainError

from app.features.admin.contracts import (
    ALLOWED_INTEGRATION_PROVIDERS,
    AdminConfigMutationResponse,
    AdminConfigRecord,
    AdminConfigsListResponse,
    AdminOpsHistoryEntry,
    AdminOpsHistoryResponse,
    CreateAdminConfigDraftRequest,
    DropboxOauthCompleteRequest,
    DropboxOauthCompleteResponse,
    DropboxOauthStartRequest,
    DropboxOauthStartResponse,
    DropboxReadinessResponse,
    DropboxReadinessStatus,
    IntegrationHealthResponse,
    IntegrationRecommendedAction,
    IntegrationRotateResult,
    IntegrationStatusClass,
    IntegrationTestResult,
    ListAdminConfigsRequest,
    ListAdminOpsHistoryRequest,
    PublishAdminConfigRequest,
    RotateIntegrationRequest,
    TestIntegrationRequest,
)

PUBLISH_CONFIRMATION_TOKEN = "PUBLISH"
ROTATE_CONFIRMATION_TOKEN = "ROTATE"
DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"


class AdminConfigService:
    """Manages config draft/publish lifecycle and integration health checks."""

    def __init__(
        self,
        *,
        audit: AuditEventStore,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._connection = get_connection()
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
              error_code TEXT,
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
              app_key TEXT,
              app_secret TEXT,
              refresh_token TEXT,
              access_token TEXT,
              token_type TEXT,
              scope TEXT,
              account_id TEXT,
              updated_at TEXT NOT NULL
            );
            """
        )
        health_columns = {
            row["name"]
            for row in self._connection.execute("PRAGMA table_info(integration_health)").fetchall()
        }
        if "error_code" not in health_columns:
            self._connection.execute("ALTER TABLE integration_health ADD COLUMN error_code TEXT")
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

    def _normalize_provider(self, provider: str) -> str:
        normalized = provider.strip().lower()
        if normalized not in ALLOWED_INTEGRATION_PROVIDERS:
            raise DomainError(
                code="VALIDATION_ERROR",
                message=f"Unsupported provider '{provider}'.",
                status_code=422,
                details={"provider": provider},
            )
        return normalized

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

    def _load_secret_meta(self, provider: str):
        return self._connection.execute(
            """
            SELECT provider, key_ref, rotated_at, status, created_at
            FROM integration_secrets_meta
            WHERE provider = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (provider,),
        ).fetchone()

    def _load_health_row(self, provider: str):
        return self._connection.execute(
            """
            SELECT
              provider,
              status_class,
              recommended_action,
              status_copy,
              credential_status,
              error_code,
              last_checked_at,
              last_rotated_at,
              last_failure_context,
              last_error,
              last_latency_ms
            FROM integration_health
            WHERE provider = ?
            """,
            (provider,),
        ).fetchone()

    def _load_integration_credentials_row(self, provider: str):
        return self._connection.execute(
            """
            SELECT
              provider, app_key, app_secret, refresh_token, access_token,
              token_type, scope, account_id, updated_at
            FROM integration_credentials
            WHERE provider = ?
            """,
            (provider,),
        ).fetchone()

    def _read_env_local(self) -> dict[str, str]:
        env_values: dict[str, str] = {}
        env_local_path = Path(__file__).resolve().parents[3] / ".env.local"
        if not env_local_path.exists():
            return env_values
        for line in env_local_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            cleaned_key = key.strip()
            cleaned_value = self._normalize_env_value(value)
            if cleaned_key and cleaned_value:
                env_values[cleaned_key] = cleaned_value
        return env_values

    def _normalize_env_value(self, raw: str) -> str:
        value = raw.strip()
        if len(value) >= 2:
            if value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]
        return value.strip()

    def _resolve_dropbox_credentials(
        self, *, override_app_key: str | None = None, override_app_secret: str | None = None
    ) -> dict[str, str | None]:
        row = self._load_integration_credentials_row("dropbox")
        env_local = self._read_env_local()

        def pick(name: str, row_key: str) -> str | None:
            if row is not None and row[row_key]:
                return str(row[row_key]).strip() or None
            env_value = os.environ.get(name) or env_local.get(name)
            if env_value:
                cleaned = str(env_value).strip()
                return cleaned or None
            return None

        app_key = (override_app_key or "").strip() or pick("DROPBOX_APP_KEY", "app_key")
        app_secret = (override_app_secret or "").strip() or pick("DROPBOX_APP_SECRET", "app_secret")
        refresh_token = pick("DROPBOX_REFRESH_TOKEN", "refresh_token")
        access_token = pick("DROPBOX_ACCESS_TOKEN", "access_token")
        return {
            "app_key": app_key,
            "app_secret": app_secret,
            "refresh_token": refresh_token,
            "access_token": access_token,
        }

    def _upsert_dropbox_credentials(
        self,
        *,
        app_key: str | None,
        app_secret: str | None,
        refresh_token: str,
        access_token: str | None,
        token_type: str | None,
        scope: str | None,
        account_id: str | None,
        updated_at: datetime,
    ) -> None:
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO integration_credentials (
                    provider, app_key, app_secret, refresh_token, access_token,
                    token_type, scope, account_id, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                    app_key = COALESCE(integration_credentials.app_key, excluded.app_key),
                    app_secret = COALESCE(integration_credentials.app_secret, excluded.app_secret),
                    refresh_token = excluded.refresh_token,
                    access_token = excluded.access_token,
                    token_type = excluded.token_type,
                    scope = excluded.scope,
                    account_id = excluded.account_id,
                    updated_at = excluded.updated_at
                """,
                (
                    "dropbox",
                    app_key,
                    app_secret,
                    refresh_token,
                    access_token,
                    token_type,
                    scope,
                    account_id,
                    updated_at.isoformat(),
                ),
            )

    def _upsert_health(
        self,
        *,
        provider: str,
        status_class: IntegrationStatusClass,
        recommended_action: IntegrationRecommendedAction,
        status_copy: str,
        credential_status: str,
        error_code: str | None,
        checked_at: datetime,
        updated_by: str,
        latency_ms: int,
        last_rotated_at: datetime | None,
        last_failure_context: str | None,
        last_error: str | None,
    ) -> None:
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO integration_health (
                  provider,
                  status_class,
                  recommended_action,
                  status_copy,
                  credential_status,
                  error_code,
                  last_checked_at,
                  last_rotated_at,
                  last_failure_context,
                  last_error,
                  last_latency_ms,
                  updated_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                  status_class = excluded.status_class,
                  recommended_action = excluded.recommended_action,
                  status_copy = excluded.status_copy,
                  credential_status = excluded.credential_status,
                  error_code = excluded.error_code,
                  last_checked_at = excluded.last_checked_at,
                  last_rotated_at = excluded.last_rotated_at,
                  last_failure_context = excluded.last_failure_context,
                  last_error = excluded.last_error,
                  last_latency_ms = excluded.last_latency_ms,
                  updated_by = excluded.updated_by
                """,
                (
                    provider,
                    status_class.value,
                    recommended_action.value,
                    status_copy,
                    credential_status,
                    error_code,
                    checked_at.isoformat(),
                    last_rotated_at.isoformat() if last_rotated_at else None,
                    last_failure_context,
                    last_error,
                    latency_ms,
                    updated_by,
                ),
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
                recommended_action=IntegrationRecommendedAction.ROTATE_CREDENTIALS,
                status_copy=(
                    "Credentials are missing. Rotate credentials, then run a connection test."
                ),
                credential_status="missing",
                error_code="DROPBOX_NOT_CONFIGURED" if provider == "dropbox" else None,
                last_checked_at=fallback_checked_at,
                last_rotated_at=fallback_rotated_at,
                last_failure_context="No credentials are configured for this provider.",
                error="Credentials not configured.",
            )

        status_class = IntegrationStatusClass(row["status_class"])
        recommended_action = IntegrationRecommendedAction(row["recommended_action"])
        last_checked_at = datetime.fromisoformat(row["last_checked_at"])
        last_rotated_at = (
            datetime.fromisoformat(row["last_rotated_at"])
            if row["last_rotated_at"]
            else None
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
            error_code=row["error_code"],
            last_checked_at=last_checked_at,
            last_rotated_at=last_rotated_at,
            last_failure_context=row["last_failure_context"],
            error=last_error,
        )

    def list_configs(self, request: ListAdminConfigsRequest) -> AdminConfigsListResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        query = """
            SELECT
              id, config_type, version, payload_json,
              published_by, published_at, is_draft, created_at
            FROM admin_configs
        """
        params: tuple[object, ...]
        if request.include_drafts:
            query += " ORDER BY created_at DESC"
            params = ()
        else:
            query += " WHERE is_draft = 0 ORDER BY published_at DESC, created_at DESC"
            params = ()
        rows = self._connection.execute(query, params).fetchall()
        return AdminConfigsListResponse(configs=[self._map_row(row) for row in rows])

    def create_draft(
        self, request: CreateAdminConfigDraftRequest
    ) -> AdminConfigMutationResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        config_id = str(uuid4())
        created_at = self._now().isoformat()
        payload_json = json.dumps(request.payload_json, separators=(",", ":"), sort_keys=True)
        self._connection.execute(
            """
            INSERT INTO admin_configs (
              id, config_type, version, payload_json,
              published_by, published_at, is_draft, created_at
            ) VALUES (?, ?, 1, ?, NULL, NULL, 1, ?)
            """,
            (config_id, request.config_type, payload_json, created_at),
        )
        self._connection.commit()
        row = self._connection.execute(
            """
            SELECT
              id, config_type, version, payload_json,
              published_by, published_at, is_draft, created_at
            FROM admin_configs
            WHERE id = ?
            """,
            (config_id,),
        ).fetchone()
        return AdminConfigMutationResponse(config=self._map_row(row))

    def publish_config(
        self,
        *,
        config_id: str,
        request: PublishAdminConfigRequest,
    ) -> AdminConfigMutationResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        self._require_confirmation(
            provided=request.confirmation,
            expected=PUBLISH_CONFIRMATION_TOKEN,
            action="publishing config",
        )

        row = self._connection.execute(
            """
            SELECT
              id, config_type, version, payload_json,
              published_by, published_at, is_draft, created_at
            FROM admin_configs
            WHERE id = ?
            """,
            (config_id,),
        ).fetchone()
        if row is None:
            raise DomainError(
                code="SUBMISSION_NOT_FOUND",
                message=f"Config {config_id} was not found.",
                status_code=404,
                details={"id": config_id},
            )

        previous_record = self._map_row(row)
        next_version = previous_record.version + 1
        published_at = self._now()
        self._connection.execute(
            """
            UPDATE admin_configs
            SET version = ?, is_draft = 0, published_by = ?, published_at = ?
            WHERE id = ?
            """,
            (next_version, request.actor_id, published_at.isoformat(), config_id),
        )
        self._connection.commit()
        updated_row = self._connection.execute(
            """
            SELECT
              id, config_type, version, payload_json,
              published_by, published_at, is_draft, created_at
            FROM admin_configs
            WHERE id = ?
            """,
            (config_id,),
        ).fetchone()
        updated_record = self._map_row(updated_row)

        self._audit.append_event(
            AuditAppendRequest(
                actor_id=request.actor_id,
                action=AuditAction.admin_config_published,
                entity_type=AuditEntityType.system,
                entity_id=updated_record.id,
                before_json=previous_record.model_dump(mode="json"),
                after_json=updated_record.model_dump(mode="json"),
                metadata={
                    "config_type": updated_record.config_type,
                    "version": updated_record.version,
                    "reason": request.reason,
                },
                occurred_at=published_at,
            )
        )
        return AdminConfigMutationResponse(config=updated_record)

    def list_integration_health(self, request: TestIntegrationRequest) -> IntegrationHealthResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        checked_at = self._now()
        integrations: list[IntegrationTestResult] = []
        for provider in sorted(ALLOWED_INTEGRATION_PROVIDERS):
            if provider == "dropbox":
                integrations.append(self.test_integration(provider=provider, request=request))
                continue
            secret = self._load_secret_meta(provider)
            rotated_at = (
                datetime.fromisoformat(secret["rotated_at"])
                if secret and secret["rotated_at"]
                else None
            )
            row = self._load_health_row(provider)
            integrations.append(
                self._map_health_response(
                    provider=provider,
                    row=row,
                    fallback_checked_at=checked_at,
                    fallback_rotated_at=rotated_at,
                )
            )
        return IntegrationHealthResponse(integrations=integrations)

    def _build_dropbox_authorize_url(self, *, app_key: str) -> str:
        query = urllib_parse.urlencode(
            {
                "client_id": app_key,
                "response_type": "code",
                "token_access_type": "offline",
            }
        )
        return f"{DROPBOX_AUTHORIZE_URL}?{query}"

    def _exchange_dropbox_auth_code(
        self, *, app_key: str, app_secret: str, auth_code: str
    ) -> dict[str, str | None]:
        payload = urllib_parse.urlencode(
            {
                "grant_type": "authorization_code",
                "code": auth_code,
                "client_id": app_key,
                "client_secret": app_secret,
            }
        ).encode("utf-8")
        request = urllib_request.Request(
            DROPBOX_TOKEN_URL,
            data=payload,
            method="POST",
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
        try:
            with urllib_request.urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8")
        except urllib_error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="ignore")
            raise DomainError(
                code="DROPBOX_AUTH_INVALID",
                message="Dropbox authorization code exchange failed.",
                status_code=409,
                details={"status": exc.code, "response": body[:500]},
            ) from exc
        except urllib_error.URLError as exc:
            raise DomainError(
                code="DROPBOX_AUTH_INVALID",
                message="Unable to contact Dropbox during OAuth exchange.",
                status_code=409,
                details={"reason": str(exc.reason)},
            ) from exc

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise DomainError(
                code="DROPBOX_AUTH_INVALID",
                message="Dropbox OAuth exchange returned an invalid response.",
                status_code=409,
                details={"response": raw[:500]},
            ) from exc

        refresh_token = str(parsed.get("refresh_token") or "").strip()
        if not refresh_token:
            raise DomainError(
                code="DROPBOX_AUTH_INVALID",
                message="Dropbox OAuth exchange did not return a refresh token.",
                status_code=409,
                details={"response": parsed},
            )
        return {
            "refresh_token": refresh_token,
            "access_token": str(parsed.get("access_token") or "").strip() or None,
            "token_type": str(parsed.get("token_type") or "").strip() or None,
            "scope": str(parsed.get("scope") or "").strip() or None,
            "account_id": str(parsed.get("account_id") or "").strip() or None,
        }

    def _test_dropbox_credentials(self) -> dict[str, object]:
        started = monotonic()
        credentials = self._resolve_dropbox_credentials()
        app_key = credentials["app_key"]
        app_secret = credentials["app_secret"]
        refresh_token = credentials["refresh_token"]
        access_token = credentials["access_token"]

        if not app_key or not app_secret or not refresh_token:
            return {
                "status_class": IntegrationStatusClass.UNCONFIGURED,
                "recommended_action": IntegrationRecommendedAction.ROTATE_CREDENTIALS,
                "status_copy": "Dropbox is not configured. Complete Dropbox OAuth setup.",
                "credential_status": "missing",
                "error_code": "DROPBOX_NOT_CONFIGURED",
                "error": "Dropbox app key, app secret, or refresh token is missing.",
                "failure_context": "Missing one or more required Dropbox credentials.",
                "latency_ms": int((monotonic() - started) * 1000),
                "account_id": None,
            }

        try:
            import dropbox
        except ImportError:
            return {
                "status_class": IntegrationStatusClass.UNHEALTHY,
                "recommended_action": IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
                "status_copy": "Dropbox SDK is unavailable in backend environment.",
                "credential_status": "invalid",
                "error_code": "DROPBOX_AUTH_INVALID",
                "error": "Dropbox SDK is not installed.",
                "failure_context": "Backend runtime is missing python dependency 'dropbox'.",
                "latency_ms": int((monotonic() - started) * 1000),
                "account_id": None,
            }

        try:
            client = dropbox.Dropbox(
                oauth2_access_token=access_token or None,
                oauth2_refresh_token=refresh_token,
                app_key=app_key,
                app_secret=app_secret,
                timeout=20,
            )
            account = client.users_get_current_account()
            account_id = str(getattr(account, "account_id", "") or "").strip() or None
            return {
                "status_class": IntegrationStatusClass.HEALTHY,
                "recommended_action": IntegrationRecommendedAction.NONE,
                "status_copy": "Dropbox connection check passed.",
                "credential_status": "configured",
                "error_code": None,
                "error": None,
                "failure_context": None,
                "latency_ms": max(1, int((monotonic() - started) * 1000)),
                "account_id": account_id,
            }
        except Exception as exc:
            return {
                "status_class": IntegrationStatusClass.UNHEALTHY,
                "recommended_action": IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
                "status_copy": "Stored Dropbox credentials are invalid. Reconnect Dropbox.",
                "credential_status": "invalid",
                "error_code": "DROPBOX_AUTH_INVALID",
                "error": str(exc),
                "failure_context": "Dropbox token refresh or account lookup failed.",
                "latency_ms": max(1, int((monotonic() - started) * 1000)),
                "account_id": None,
            }

    def get_dropbox_readiness(self, request: TestIntegrationRequest) -> DropboxReadinessResponse:
        result = self.test_integration(provider="dropbox", request=request)
        if result.error_code == "DROPBOX_NOT_CONFIGURED":
            credentials = self._resolve_dropbox_credentials()
            authorize_url = None
            if credentials["app_key"]:
                authorize_url = self._build_dropbox_authorize_url(
                    app_key=str(credentials["app_key"])
                )
            return DropboxReadinessResponse(
                provider="dropbox",
                status=DropboxReadinessStatus.NOT_CONFIGURED,
                message="Dropbox is not configured. Complete OAuth setup or skip for now.",
                authorize_url=authorize_url,
            )

        if result.error_code == "DROPBOX_AUTH_INVALID":
            credentials = self._resolve_dropbox_credentials()
            authorize_url = None
            if credentials["app_key"]:
                authorize_url = self._build_dropbox_authorize_url(
                    app_key=str(credentials["app_key"])
                )
            return DropboxReadinessResponse(
                provider="dropbox",
                status=DropboxReadinessStatus.INVALID_TOKEN,
                message="Stored Dropbox credentials are invalid. Reconnect Dropbox.",
                authorize_url=authorize_url,
            )

        return DropboxReadinessResponse(
            provider="dropbox",
            status=DropboxReadinessStatus.READY,
            message="Dropbox integration is configured and healthy.",
            authorize_url=None,
        )

    def start_dropbox_oauth(self, request: DropboxOauthStartRequest) -> DropboxOauthStartResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        credentials = self._resolve_dropbox_credentials(override_app_key=request.app_key)
        app_key = credentials["app_key"]
        if not app_key:
            raise DomainError(
                code="DROPBOX_NOT_CONFIGURED",
                message="DROPBOX_APP_KEY is required to start Dropbox OAuth.",
                status_code=409,
                details={},
            )
        return DropboxOauthStartResponse(
            provider="dropbox",
            authorize_url=self._build_dropbox_authorize_url(app_key=app_key),
        )

    def complete_dropbox_oauth(
        self, request: DropboxOauthCompleteRequest
    ) -> DropboxOauthCompleteResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        credentials = self._resolve_dropbox_credentials(
            override_app_key=request.app_key,
            override_app_secret=request.app_secret,
        )
        app_key = credentials["app_key"]
        app_secret = credentials["app_secret"]
        if not app_key or not app_secret:
            raise DomainError(
                code="DROPBOX_NOT_CONFIGURED",
                message="Dropbox app key and app secret are required to complete OAuth setup.",
                status_code=409,
                details={},
            )

        exchanged = self._exchange_dropbox_auth_code(
            app_key=app_key,
            app_secret=app_secret,
            auth_code=request.auth_code,
        )
        configured_at = self._now()
        self._upsert_dropbox_credentials(
            app_key=None,
            app_secret=None,
            refresh_token=str(exchanged["refresh_token"]),
            access_token=exchanged["access_token"],
            token_type=exchanged["token_type"],
            scope=exchanged["scope"],
            account_id=exchanged["account_id"],
            updated_at=configured_at,
        )

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO integration_secrets_meta (
                    id, provider, key_ref, rotated_at, status, created_at
                )
                VALUES (?, ?, ?, ?, 'active', ?)
                """,
                (
                    str(uuid4()),
                    "dropbox",
                    f"dropbox-oauth-{uuid4().hex[:8]}",
                    configured_at.isoformat(),
                    configured_at.isoformat(),
                ),
            )

        self.test_integration(
            provider="dropbox",
            request=TestIntegrationRequest(
                actor_id=request.actor_id,
                actor_role=request.actor_role,
            ),
        )

        return DropboxOauthCompleteResponse(
            provider="dropbox",
            status="configured",
            account_id=exchanged["account_id"],
            configured_at=configured_at,
        )

    def rotate_integration_credentials(
        self,
        *,
        provider: str,
        request: RotateIntegrationRequest,
    ) -> IntegrationRotateResult:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        normalized_provider = self._normalize_provider(provider)
        self._require_confirmation(
            provided=request.confirmation,
            expected=ROTATE_CONFIRMATION_TOKEN,
            action="rotating credentials",
        )

        rotated_at = self._now()
        key_ref = request.key_ref or f"{normalized_provider}-key-{uuid4().hex[:8]}"

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO integration_secrets_meta (
                    id, provider, key_ref, rotated_at, status, created_at
                )
                VALUES (?, ?, ?, ?, 'active', ?)
                """,
                (
                    str(uuid4()),
                    normalized_provider,
                    key_ref,
                    rotated_at.isoformat(),
                    rotated_at.isoformat(),
                ),
            )

        self._upsert_health(
            provider=normalized_provider,
            status_class=IntegrationStatusClass.DEGRADED,
            recommended_action=IntegrationRecommendedAction.RUN_CONNECTION_TEST,
            status_copy="Credentials rotated. Run a connection test to verify provider access.",
            credential_status="configured",
            error_code=None,
            checked_at=rotated_at,
            updated_by=request.actor_id,
            latency_ms=0,
            last_rotated_at=rotated_at,
            last_failure_context=None,
            last_error=None,
        )

        self._audit.append_event(
            AuditAppendRequest(
                actor_id=request.actor_id,
                action=AuditAction.admin_integration_credentials_rotated,
                entity_type=AuditEntityType.integration,
                entity_id=normalized_provider,
                metadata={
                    "provider": normalized_provider,
                    "key_ref": key_ref,
                    "reason": request.reason,
                },
                occurred_at=rotated_at,
            )
        )

        return IntegrationRotateResult(
            provider=normalized_provider,
            status="rotated",
            rotated_at=rotated_at,
            key_ref=key_ref,
        )

    def test_integration(
        self,
        *,
        provider: str,
        request: TestIntegrationRequest,
    ) -> IntegrationTestResult:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        started = monotonic()
        normalized_provider = self._normalize_provider(provider)
        checked_at = self._now()

        secret = self._load_secret_meta(normalized_provider)
        last_rotated_at = (
            datetime.fromisoformat(secret["rotated_at"])
            if secret and secret["rotated_at"]
            else None
        )
        error_code: str | None = None

        if normalized_provider == "dropbox":
            dropbox_check = self._test_dropbox_credentials()
            status_class = dropbox_check["status_class"]
            recommended_action = dropbox_check["recommended_action"]
            status_copy = str(dropbox_check["status_copy"])
            credential_status = str(dropbox_check["credential_status"])
            error_code = (
                str(dropbox_check["error_code"])
                if dropbox_check["error_code"] is not None
                else None
            )
            error = str(dropbox_check["error"]) if dropbox_check["error"] is not None else None
            failure_context = (
                str(dropbox_check["failure_context"])
                if dropbox_check["failure_context"] is not None
                else None
            )
            latency_ms = int(dropbox_check["latency_ms"])
            account_id = (
                str(dropbox_check["account_id"])
                if dropbox_check["account_id"] is not None
                else None
            )
            if account_id is not None:
                with self._connection:
                    self._connection.execute(
                        """
                        UPDATE integration_credentials
                        SET account_id = ?, updated_at = ?
                        WHERE provider = ?
                        """,
                        (account_id, checked_at.isoformat(), "dropbox"),
                    )
        elif secret is None:
            latency_ms = int((monotonic() - started) * 1000)
            status_class = IntegrationStatusClass.UNCONFIGURED
            recommended_action = IntegrationRecommendedAction.ROTATE_CREDENTIALS
            status_copy = (
                "Credentials are missing. Rotate credentials, then run a connection test."
            )
            credential_status = "missing"
            error = "Credentials not configured."
            failure_context = "No active credential reference was found for this provider."
        else:
            latency_ms = max(1, int((monotonic() - started) * 1000))
            status_class = IntegrationStatusClass.HEALTHY
            recommended_action = IntegrationRecommendedAction.NONE
            status_copy = "Connection check passed. No remediation needed."
            credential_status = "configured"
            error = None
            failure_context = None

        self._upsert_health(
            provider=normalized_provider,
            status_class=status_class,
            recommended_action=recommended_action,
            status_copy=status_copy,
            credential_status=credential_status,
            error_code=error_code,
            checked_at=checked_at,
            updated_by=request.actor_id,
            latency_ms=latency_ms,
            last_rotated_at=last_rotated_at,
            last_failure_context=failure_context,
            last_error=error,
        )

        return IntegrationTestResult(
            provider=normalized_provider,
            ok=status_class == IntegrationStatusClass.HEALTHY,
            latency_ms=latency_ms,
            status_class=status_class,
            recommended_action=recommended_action,
            status_copy=status_copy,
            credential_status=credential_status,
            error_code=error_code,
            last_checked_at=checked_at,
            last_rotated_at=last_rotated_at,
            last_failure_context=failure_context,
            error=error,
        )

    def list_ops_history(self, request: ListAdminOpsHistoryRequest) -> AdminOpsHistoryResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        events = self._audit.list_events(limit=request.limit, offset=0).events
        tracked_actions = {
            AuditAction.admin_config_published,
            AuditAction.admin_integration_credentials_rotated,
            AuditAction.admin_job_replayed,
        }

        entries: list[AdminOpsHistoryEntry] = []
        for event in reversed(events):
            if event.action not in tracked_actions:
                continue
            metadata = event.metadata if isinstance(event.metadata, dict) else {}
            reason = metadata.get("reason") if isinstance(metadata.get("reason"), str) else None
            timestamp = event.occurred_at or event.created_at
            entries.append(
                AdminOpsHistoryEntry(
                    id=str(event.id),
                    action=event.action.value,
                    actor_id=event.actor_id,
                    reason=reason,
                    entity=f"{event.entity_type.value}:{event.entity_id}",
                    timestamp=timestamp,
                )
            )
            if len(entries) >= request.limit:
                break

        return AdminOpsHistoryResponse(entries=entries)
