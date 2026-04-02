"""Ops history logic for Admin service."""

from __future__ import annotations

from app.features.admin.contracts import (
    AdminOpsHistoryEntry,
    AdminOpsHistoryResponse,
    ListAdminOpsHistoryRequest,
)
from app.features.audit.contracts import AuditAction

from .base import AdminBaseService


class AdminHistoryLogic(AdminBaseService):
    """Mixes in admin ops history retrieval logic."""

    def list_ops_history(self, request: ListAdminOpsHistoryRequest) -> AdminOpsHistoryResponse:
        self._assert_admin(actor_role=request.actor_role, actor_id=request.actor_id)
        events = self._audit.list_events(limit=request.limit, offset=0).events
        tracked_actions = {
            AuditAction.admin_config_published,
            AuditAction.admin_config_rolled_back,
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
