"""PRD-14 admin operations service for active QC policy management."""

from __future__ import annotations

from app.core.errors import DomainError
from app.features.qc.contracts import (
    GetActiveQcPolicyResponse,
    QcActorRole,
    QcErrorCode,
    UpdateActiveQcPolicyRequest,
    UpdateActiveQcPolicyResponse,
)
from app.features.qc.rules import QcRulesRegistryService


class AdminQcPolicyService:
    """Applies role guardrails and delegates policy operations to the registry."""

    def __init__(self, *, registry: QcRulesRegistryService) -> None:
        self._registry = registry

    def get_active_policy(self) -> GetActiveQcPolicyResponse:
        return self._registry.get_active_policy()

    def update_active_policy(
        self, request: UpdateActiveQcPolicyRequest
    ) -> UpdateActiveQcPolicyResponse:
        if request.actor_role != QcActorRole.ADMIN:
            raise DomainError(
                code=QcErrorCode.QC_POLICY_FORBIDDEN,
                message="Only admin role can update active QC policy.",
                status_code=403,
                details={"actor_role": request.actor_role.value},
            )

        return self._registry.update_active_policy(request)
