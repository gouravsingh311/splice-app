"""Integration health and rotation logic for Admin service."""

from __future__ import annotations

import json
import os
import smtplib
from datetime import datetime
from time import monotonic
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
from uuid import uuid4

import requests

from app.core.errors import DomainError
from app.features.admin.contracts import (
    ALLOWED_INTEGRATION_PROVIDERS,
    ConfigureAirtableIntegrationRequest,
    ConfigureDropboxAppRequest,
    ConfigureDropboxTokensRequest,
    ConfigureSmtpIntegrationRequest,
    DropboxOauthCompleteRequest,
    DropboxOauthCompleteResponse,
    DropboxOauthStartRequest,
    DropboxOauthStartResponse,
    DropboxReadinessResponse,
    DropboxReadinessStatus,
    IntegrationConfigureResponse,
    IntegrationHealthResponse,
    IntegrationRecommendedAction,
    IntegrationRotateResult,
    IntegrationStatusClass,
    IntegrationTestResult,
    RotateIntegrationRequest,
    TestIntegrationRequest,
)
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType

from .base import AdminBaseService

ROTATE_CONFIRMATION_TOKEN = "ROTATE"
DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
DROPBOX_TOKEN_URL = "https://api.dropbox.com/oauth2/token"


class AdminIntegrationLogic(AdminBaseService):
    """Mixes in integration management logic: rotation, health checks, and testing."""

    def _normalize_provider(self, provider: str) -> str:
        normalized = provider.strip().lower()
        if normalized not in ALLOWED_INTEGRATION_PROVIDERS:
            from app.core.errors import DomainError

            raise DomainError(
                code="VALIDATION_ERROR",
                message=f"Unsupported provider '{provider}'.",
                status_code=422,
                details={"provider": provider},
            )
        return normalized

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

    def _load_provider_credentials(self, provider: str) -> dict[str, str]:
        row = self._connection.execute(
            """
            SELECT credentials_json
            FROM integration_credentials
            WHERE provider = ?
            """,
            (provider,),
        ).fetchone()
        if not row:
            parsed = {}
        else:
            try:
                parsed = json.loads(row["credentials_json"] or "{}")
            except json.JSONDecodeError:
                parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        output: dict[str, str] = {}
        for key, value in parsed.items():
            if value is None:
                continue
            normalized = str(value).strip()
            if normalized:
                output[str(key)] = normalized
        return output

    def _save_provider_credentials(self, provider: str, credentials: dict[str, str | None]) -> None:
        sanitized: dict[str, str] = {}
        for key, value in credentials.items():
            if value is None:
                continue
            normalized = str(value).strip()
            if normalized:
                sanitized[key] = normalized
        now_iso = self._now().isoformat()
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO integration_credentials (provider, credentials_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                  credentials_json = excluded.credentials_json,
                  updated_at = excluded.updated_at
                """,
                (provider, json.dumps(sanitized, separators=(",", ":"), ensure_ascii=True), now_iso),
            )

    def _build_unconfigured_result(
        self,
        *,
        provider: str,
        checked_at: datetime,
        rotated_at: datetime | None,
    ) -> IntegrationTestResult:
        return IntegrationTestResult(
            provider=provider,
            ok=False,
            latency_ms=0,
            status_class=IntegrationStatusClass.UNCONFIGURED,
            recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
            status_copy="Credentials are missing. Configure this provider in Setup, then run a connection test.",
            credential_status="missing",
            last_checked_at=checked_at,
            last_rotated_at=rotated_at,
            last_failure_context="No active credential reference was found for this provider.",
            error="Credentials not configured.",
        )

    def _build_unavailable_result(
        self,
        *,
        provider: str,
        checked_at: datetime,
        rotated_at: datetime | None,
        status_copy: str,
        last_failure_context: str,
    ) -> IntegrationTestResult:
        return IntegrationTestResult(
            provider=provider,
            ok=False,
            latency_ms=0,
            status_class=IntegrationStatusClass.UNAVAILABLE,
            recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
            status_copy=status_copy,
            credential_status="configured",
            last_checked_at=checked_at,
            last_rotated_at=rotated_at,
            last_failure_context=last_failure_context,
            error="Connectivity adapter unavailable.",
        )

    def _probe_airtable(
        self,
        *,
        provider: str,
        checked_at: datetime,
        rotated_at: datetime | None,
    ) -> IntegrationTestResult:
        stored = self._load_provider_credentials("airtable")
        api_key = os.environ.get("AIRTABLE_API_KEY", "").strip() or stored.get("api_key", "").strip()
        if not api_key:
            return self._build_unavailable_result(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
                status_copy=(
                    "Airtable connectivity check is unavailable until an API key is configured."
                ),
                last_failure_context="No Airtable API key found in env or wizard configuration.",
            )

        started = monotonic()
        try:
            response = requests.get(
                "https://api.airtable.com/v0/meta/whoami",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
        except requests.RequestException as exc:
            latency_ms = max(1, int((monotonic() - started) * 1000))
            return IntegrationTestResult(
                provider=provider,
                ok=False,
                latency_ms=latency_ms,
                status_class=IntegrationStatusClass.UNHEALTHY,
                recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
                status_copy="Airtable connection test failed. Verify the API key and network access.",
                credential_status="configured",
                last_checked_at=checked_at,
                last_rotated_at=rotated_at,
                last_failure_context=str(exc),
                error=str(exc),
            )

        latency_ms = max(1, int((monotonic() - started) * 1000))
        if response.status_code == 200:
            return IntegrationTestResult(
                provider=provider,
                ok=True,
                latency_ms=latency_ms,
                status_class=IntegrationStatusClass.HEALTHY,
                recommended_action=IntegrationRecommendedAction.NONE,
                status_copy="Airtable API token validated successfully.",
                credential_status="configured",
                last_checked_at=checked_at,
                last_rotated_at=rotated_at,
                last_failure_context=None,
                error=None,
            )

        error = f"Airtable whoami returned HTTP {response.status_code}."
        return IntegrationTestResult(
            provider=provider,
            ok=False,
            latency_ms=latency_ms,
            status_class=IntegrationStatusClass.UNHEALTHY,
            recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
            status_copy="Airtable connection test failed. Verify the API key and network access.",
            credential_status="configured",
            last_checked_at=checked_at,
            last_rotated_at=rotated_at,
            last_failure_context=error,
            error=error,
        )

    def _probe_dropbox(
        self,
        *,
        provider: str,
        checked_at: datetime,
        rotated_at: datetime | None,
    ) -> IntegrationTestResult:
        stored = self._load_provider_credentials("dropbox")
        app_key = os.environ.get("DROPBOX_APP_KEY", "").strip() or stored.get("app_key", "").strip()
        app_secret = os.environ.get("DROPBOX_APP_SECRET", "").strip() or stored.get("app_secret", "").strip()
        refresh_token = os.environ.get("DROPBOX_REFRESH_TOKEN", "").strip() or stored.get("refresh_token", "").strip()
        access_token = os.environ.get("DROPBOX_ACCESS_TOKEN", "").strip() or stored.get("access_token", "").strip()
        if not app_key or not app_secret or not refresh_token:
            return self._build_unavailable_result(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
                status_copy=(
                    "Dropbox connectivity check is unavailable until app key/secret and refresh token are configured."
                ),
                last_failure_context="DROPBOX_APP_KEY, DROPBOX_APP_SECRET, or refresh token is missing.",
            )

        try:
            import dropbox
        except ImportError:
            return self._build_unavailable_result(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
                status_copy=(
                    "Dropbox connectivity check is unavailable until the Dropbox SDK is installed."
                ),
                last_failure_context="The Dropbox SDK is not installed in the runtime environment.",
            )

        started = monotonic()
        try:
            client = dropbox.Dropbox(
                oauth2_access_token=access_token or None,
                oauth2_refresh_token=refresh_token,
                app_key=app_key,
                app_secret=app_secret,
                timeout=30,
            )
            client.users_get_current_account()
        except Exception as exc:  # pragma: no cover - network/client specific
            latency_ms = max(1, int((monotonic() - started) * 1000))
            return IntegrationTestResult(
                provider=provider,
                ok=False,
                latency_ms=latency_ms,
                status_class=IntegrationStatusClass.UNHEALTHY,
                recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
                status_copy="Dropbox connection test failed. Verify the access token and network access.",
                credential_status="configured",
                last_checked_at=checked_at,
                last_rotated_at=rotated_at,
                last_failure_context=str(exc),
                error=str(exc),
            )

        latency_ms = max(1, int((monotonic() - started) * 1000))
        return IntegrationTestResult(
            provider=provider,
            ok=True,
            latency_ms=latency_ms,
            status_class=IntegrationStatusClass.HEALTHY,
            recommended_action=IntegrationRecommendedAction.NONE,
            status_copy="Dropbox access token validated successfully.",
            credential_status="configured",
            last_checked_at=checked_at,
            last_rotated_at=rotated_at,
            last_failure_context=None,
            error=None,
        )

    def _probe_smtp(
        self,
        *,
        provider: str,
        checked_at: datetime,
        rotated_at: datetime | None,
    ) -> IntegrationTestResult:
        host = os.environ.get("SMTP_HOST", "").strip()
        port_value = os.environ.get("SMTP_PORT", "").strip()
        stored = self._load_provider_credentials("smtp")
        if not host:
            host = stored.get("host", "").strip()
        if not port_value:
            port_value = stored.get("port", "").strip()
        if not host or not port_value:
            return self._build_unavailable_result(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
                status_copy=(
                    "SMTP connectivity check is unavailable until SMTP_HOST and SMTP_PORT are set."
                ),
                last_failure_context="SMTP_HOST or SMTP_PORT is missing from the runtime environment.",
            )

        try:
            port = int(port_value)
        except ValueError:
            return self._build_unavailable_result(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
                status_copy=(
                    "SMTP connectivity check is unavailable until SMTP_PORT is a valid integer."
                ),
                last_failure_context=f"SMTP_PORT value '{port_value}' is not a valid integer.",
            )

        username = os.environ.get("SMTP_USERNAME", "").strip() or stored.get("username", "").strip()
        password = os.environ.get("SMTP_PASSWORD", "") or stored.get("password", "")
        started = monotonic()
        try:
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.ehlo()
                if server.has_extn("starttls"):
                    server.starttls()
                    server.ehlo()
                if username and password:
                    server.login(username, password)
                server.noop()
        except Exception as exc:  # pragma: no cover - network/client specific
            latency_ms = max(1, int((monotonic() - started) * 1000))
            return IntegrationTestResult(
                provider=provider,
                ok=False,
                latency_ms=latency_ms,
                status_class=IntegrationStatusClass.UNHEALTHY,
                recommended_action=IntegrationRecommendedAction.VERIFY_PROVIDER_CONFIGURATION,
                status_copy="SMTP connection test failed. Verify the server host, port, and credentials.",
                credential_status="configured",
                last_checked_at=checked_at,
                last_rotated_at=rotated_at,
                last_failure_context=str(exc),
                error=str(exc),
            )

        latency_ms = max(1, int((monotonic() - started) * 1000))
        return IntegrationTestResult(
            provider=provider,
            ok=True,
            latency_ms=latency_ms,
            status_class=IntegrationStatusClass.HEALTHY,
            recommended_action=IntegrationRecommendedAction.NONE,
            status_copy="SMTP server connectivity validated successfully.",
            credential_status="configured",
            last_checked_at=checked_at,
            last_rotated_at=rotated_at,
            last_failure_context=None,
            error=None,
        )

    def _probe_provider(
        self,
        *,
        provider: str,
        checked_at: datetime,
        rotated_at: datetime | None,
        secret,
    ) -> IntegrationTestResult:
        if provider == "airtable":
            return self._probe_airtable(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
            )
        if provider == "dropbox":
            return self._probe_dropbox(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
            )
        if provider == "smtp":
            return self._probe_smtp(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
            )

        if secret is None:
            return self._build_unconfigured_result(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
            )

        return self._build_unavailable_result(
            provider=provider,
            checked_at=checked_at,
            rotated_at=rotated_at,
            status_copy="Provider connectivity check is unavailable for this integration.",
            last_failure_context="No provider adapter has been registered for this integration.",
        )

    def _load_health_row(self, provider: str):
        return self._connection.execute(
            """
            SELECT
              provider,
              status_class,
              recommended_action,
              status_copy,
              credential_status,
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

    def _upsert_health(
        self,
        *,
        provider: str,
        status_class: IntegrationStatusClass,
        recommended_action: IntegrationRecommendedAction,
        status_copy: str,
        credential_status: str,
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
                  last_checked_at,
                  last_rotated_at,
                  last_failure_context,
                  last_error,
                  last_latency_ms,
                  updated_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider) DO UPDATE SET
                  status_class = excluded.status_class,
                  recommended_action = excluded.recommended_action,
                  status_copy = excluded.status_copy,
                  credential_status = excluded.credential_status,
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
                    checked_at.isoformat(),
                    last_rotated_at.isoformat() if last_rotated_at else None,
                    last_failure_context,
                    last_error,
                    latency_ms,
                    updated_by,
                ),
            )

    def list_integration_health(self, request: TestIntegrationRequest) -> IntegrationHealthResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        checked_at = self._now()
        integrations: list[IntegrationTestResult] = []
        for provider in sorted(ALLOWED_INTEGRATION_PROVIDERS):
            secret = self._load_secret_meta(provider)
            rotated_at = (
                datetime.fromisoformat(secret["rotated_at"])
                if secret and secret["rotated_at"]
                else None
            )
            result = self._probe_provider(
                provider=provider,
                checked_at=checked_at,
                rotated_at=rotated_at,
                secret=secret,
            )
            self._upsert_health(
                provider=provider,
                status_class=result.status_class,
                recommended_action=result.recommended_action,
                status_copy=result.status_copy,
                credential_status=result.credential_status,
                checked_at=checked_at,
                updated_by=request.actor_id,
                latency_ms=result.latency_ms,
                last_rotated_at=rotated_at,
                last_failure_context=result.last_failure_context,
                last_error=result.error,
            )
            integrations.append(result)
        return IntegrationHealthResponse(integrations=integrations)

    def configure_airtable_integration(
        self, request: ConfigureAirtableIntegrationRequest
    ) -> IntegrationConfigureResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        configured_at = self._now()
        self._save_provider_credentials(
            "airtable",
            {
                "api_key": request.api_key,
                "submissions_table": request.submissions_table,
                "completion_view": request.completion_view,
            },
        )
        return IntegrationConfigureResponse(
            provider="airtable",
            status="configured",
            configured_at=configured_at,
        )

    def configure_smtp_integration(
        self, request: ConfigureSmtpIntegrationRequest
    ) -> IntegrationConfigureResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        configured_at = self._now()
        self._save_provider_credentials(
            "smtp",
            {
                "host": request.host,
                "port": str(request.port),
                "username": request.username,
                "password": request.password,
                "from_email": request.from_email,
            },
        )
        return IntegrationConfigureResponse(
            provider="smtp",
            status="configured",
            configured_at=configured_at,
        )

    def configure_dropbox_tokens(
        self, request: ConfigureDropboxTokensRequest
    ) -> IntegrationConfigureResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        configured_at = self._now()
        self._save_provider_credentials(
            "dropbox",
            {
                "refresh_token": request.refresh_token,
                "access_token": request.access_token,
            },
        )
        return IntegrationConfigureResponse(
            provider="dropbox",
            status="configured",
            configured_at=configured_at,
        )

    def configure_dropbox_app_credentials(
        self, request: ConfigureDropboxAppRequest
    ) -> IntegrationConfigureResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        existing = self._load_provider_credentials("dropbox")
        configured_at = self._now()
        self._save_provider_credentials(
            "dropbox",
            {
                **existing,
                "app_key": request.app_key,
                "app_secret": request.app_secret,
            },
        )
        return IntegrationConfigureResponse(
            provider="dropbox",
            status="configured",
            configured_at=configured_at,
        )

    def get_dropbox_readiness(self, request: TestIntegrationRequest) -> DropboxReadinessResponse:
        result = self.test_integration(provider="dropbox", request=request)
        stored = self._load_provider_credentials("dropbox")
        app_key = os.environ.get("DROPBOX_APP_KEY", "").strip() or stored.get("app_key", "").strip()
        app_secret = os.environ.get("DROPBOX_APP_SECRET", "").strip() or stored.get("app_secret", "").strip()
        has_app_credentials = bool(app_key and app_secret)
        if result.status_class == IntegrationStatusClass.HEALTHY:
            return DropboxReadinessResponse(
                provider="dropbox",
                status=DropboxReadinessStatus.READY,
                message="Dropbox integration is configured and healthy.",
                has_app_credentials=has_app_credentials,
                authorize_url=None,
            )
        authorize_url = self._build_dropbox_authorize_url(app_key=app_key) if app_key else None
        status = (
            DropboxReadinessStatus.NOT_CONFIGURED
            if result.status_class in {IntegrationStatusClass.UNCONFIGURED, IntegrationStatusClass.UNAVAILABLE}
            else DropboxReadinessStatus.INVALID_TOKEN
        )
        if status == DropboxReadinessStatus.NOT_CONFIGURED:
            message = (
                "Dropbox app is configured. Open Dropbox login to mint a refresh token."
                if has_app_credentials
                else "Dropbox app key/secret are missing. Enter them, then continue OAuth."
            )
        else:
            message = (
                "Dropbox credentials look invalid. Reconnect via OAuth."
                if has_app_credentials
                else "Dropbox app key/secret are missing or invalid. Update them, then reconnect."
            )
        return DropboxReadinessResponse(
            provider="dropbox",
            status=status,
            message=message,
            has_app_credentials=has_app_credentials,
            authorize_url=authorize_url,
        )

    def _build_dropbox_authorize_url(self, *, app_key: str) -> str:
        query = urllib_parse.urlencode(
            {
                "client_id": app_key,
                "response_type": "code",
                "token_access_type": "offline",
            }
        )
        return f"{DROPBOX_AUTHORIZE_URL}?{query}"

    def start_dropbox_oauth(self, request: DropboxOauthStartRequest) -> DropboxOauthStartResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        stored = self._load_provider_credentials("dropbox")
        app_key = (
            (request.app_key or "").strip()
            or os.environ.get("DROPBOX_APP_KEY", "").strip()
            or stored.get("app_key", "").strip()
        )
        if not app_key:
            raise DomainError(
                code="DROPBOX_NOT_CONFIGURED",
                message="DROPBOX_APP_KEY is required to start Dropbox OAuth.",
                status_code=409,
            )
        return DropboxOauthStartResponse(
            provider="dropbox",
            authorize_url=self._build_dropbox_authorize_url(app_key=app_key),
        )

    def _exchange_dropbox_auth_code(
        self, *, app_key: str, app_secret: str, auth_code: str, redirect_uri: str | None = None
    ) -> dict[str, str | None]:
        payload_data = {
            "grant_type": "authorization_code",
            "code": auth_code,
            "client_id": app_key,
            "client_secret": app_secret,
        }
        if redirect_uri:
            payload_data["redirect_uri"] = redirect_uri
        payload = urllib_parse.urlencode(payload_data).encode("utf-8")
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

        parsed = json.loads(raw)
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
            "account_id": str(parsed.get("account_id") or "").strip() or None,
        }

    def complete_dropbox_oauth(
        self, request: DropboxOauthCompleteRequest
    ) -> DropboxOauthCompleteResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        stored = self._load_provider_credentials("dropbox")
        app_key = (
            (request.app_key or "").strip()
            or os.environ.get("DROPBOX_APP_KEY", "").strip()
            or stored.get("app_key", "").strip()
        )
        app_secret = (
            (request.app_secret or "").strip()
            or os.environ.get("DROPBOX_APP_SECRET", "").strip()
            or stored.get("app_secret", "").strip()
        )
        if not app_key or not app_secret:
            raise DomainError(
                code="DROPBOX_NOT_CONFIGURED",
                message="DROPBOX_APP_KEY and DROPBOX_APP_SECRET are required.",
                status_code=409,
            )
        exchanged = self._exchange_dropbox_auth_code(
            app_key=app_key,
            app_secret=app_secret,
            auth_code=request.auth_code,
            redirect_uri=request.redirect_uri,
        )
        self._save_provider_credentials(
            "dropbox",
            {
                "app_key": app_key,
                "app_secret": app_secret,
                "refresh_token": str(exchanged["refresh_token"]),
                "access_token": exchanged["access_token"],
            },
        )
        configured_at = self._now()
        return DropboxOauthCompleteResponse(
            provider="dropbox",
            status="configured",
            account_id=exchanged.get("account_id"),
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
        normalized_provider = self._normalize_provider(provider)
        checked_at = self._now()

        secret = self._load_secret_meta(normalized_provider)
        last_rotated_at = (
            datetime.fromisoformat(secret["rotated_at"])
            if secret and secret["rotated_at"]
            else None
        )
        result = self._probe_provider(
            provider=normalized_provider,
            checked_at=checked_at,
            rotated_at=last_rotated_at,
            secret=secret,
        )

        self._upsert_health(
            provider=normalized_provider,
            status_class=result.status_class,
            recommended_action=result.recommended_action,
            status_copy=result.status_copy,
            credential_status=result.credential_status,
            checked_at=checked_at,
            updated_by=request.actor_id,
            latency_ms=result.latency_ms,
            last_rotated_at=last_rotated_at,
            last_failure_context=result.last_failure_context,
            last_error=result.error,
        )
        return result
