"""Config-related operations for Admin service."""

from __future__ import annotations

import json
from uuid import uuid4

from app.core.errors import DomainError
from app.features.admin.contracts import (
    AdminConfigMutationResponse,
    AdminConfigsListResponse,
    CreateAdminConfigDraftRequest,
    ListAdminConfigsRequest,
    PublishAdminConfigRequest,
    RollbackAdminConfigRequest,
)
from app.features.audit.contracts import AuditAction, AuditAppendRequest, AuditEntityType

from .base import AdminBaseService

PUBLISH_CONFIRMATION_TOKEN = "PUBLISH"
ROLLBACK_CONFIRMATION_TOKEN = "ROLLBACK"


class AdminConfigLogic(AdminBaseService):
    """Mixes in config draft and publish lifecycle logic."""

    def _load_config_row(self, config_id: str):
        return self._connection.execute(
            """
            SELECT
              id, config_type, version, payload_json,
              published_by, published_at, is_draft, created_at
            FROM admin_configs
            WHERE id = ?
            """,
            (config_id,),
        ).fetchone()

    def _load_latest_publish_event(self, config_id: str):
        events = self._audit.list_events(
            entity_type=AuditEntityType.system,
            entity_id=config_id,
            action=AuditAction.admin_config_published.value,
            limit=100,
            offset=0,
        ).events
        return events[-1] if events else None

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
        row = self._load_config_row(config_id)
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

        row = self._load_config_row(config_id)
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

    def rollback_config(
        self,
        *,
        config_id: str,
        request: RollbackAdminConfigRequest,
    ) -> AdminConfigMutationResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        self._require_confirmation(
            provided=request.confirmation,
            expected=ROLLBACK_CONFIRMATION_TOKEN,
            action="rolling back config",
        )

        row = self._load_config_row(config_id)
        if row is None:
            raise DomainError(
                code="SUBMISSION_NOT_FOUND",
                message=f"Config {config_id} was not found.",
                status_code=404,
                details={"id": config_id},
            )

        current_record = self._map_row(row)
        if current_record.is_draft:
            raise DomainError(
                code="ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
                message=f"Config {config_id} has no published history to roll back.",
                status_code=409,
                details={"id": config_id, "config_type": current_record.config_type},
            )

        previous_event = self._load_latest_publish_event(config_id)
        if previous_event is None or not isinstance(previous_event.before_json, dict):
            raise DomainError(
                code="ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
                message=f"Config {config_id} has no published history to roll back.",
                status_code=409,
                details={"id": config_id, "config_type": current_record.config_type},
            )

        restored_payload = (
            previous_event.before_json.get("payload_json")
            if isinstance(previous_event.before_json, dict)
            else None
        )
        if not isinstance(restored_payload, dict):
            raise DomainError(
                code="ADMIN_CONFIG_ROLLBACK_NOT_AVAILABLE",
                message=f"Config {config_id} has no published history to roll back.",
                status_code=409,
                details={"id": config_id, "config_type": current_record.config_type},
            )
        rolled_back_at = self._now()
        next_version = current_record.version + 1
        payload_json = json.dumps(restored_payload, separators=(",", ":"), sort_keys=True)
        self._connection.execute(
            """
            UPDATE admin_configs
            SET version = ?, payload_json = ?, published_by = ?, published_at = ?, is_draft = 0
            WHERE id = ?
            """,
            (next_version, payload_json, request.actor_id, rolled_back_at.isoformat(), config_id),
        )
        self._connection.commit()
        updated_row = self._load_config_row(config_id)
        updated_record = self._map_row(updated_row)

        self._audit.append_event(
            AuditAppendRequest(
                actor_id=request.actor_id,
                action=AuditAction.admin_config_rolled_back,
                entity_type=AuditEntityType.system,
                entity_id=updated_record.id,
                before_json=current_record.model_dump(mode="json"),
                after_json=updated_record.model_dump(mode="json"),
                metadata={
                    "config_type": updated_record.config_type,
                    "version": updated_record.version,
                    "reason": request.reason,
                    "restored_from_version": previous_event.after_json.get("version")
                    if isinstance(previous_event.after_json, dict)
                    else None,
                },
                occurred_at=rolled_back_at,
            )
        )

        return AdminConfigMutationResponse(config=updated_record)
