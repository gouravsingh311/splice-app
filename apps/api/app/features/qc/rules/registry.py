"""SQLite-backed PRD-05 rules and policy registry."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime

from app.core.db.session import get_connection, init_db
from app.core.errors import DomainError
from app.features.qc.contracts import (
    QC_POLICY_UPDATED_EVENT,
    AuditHookPayload,
    GetActiveQcPolicyResponse,
    ListQcRulesResponse,
    ObservabilityHookPayload,
    QcErrorCode,
    QcPolicyRuleBinding,
    QcPolicySnapshot,
    QcPolicyUpdate,
    QcPolicyUpdatedEvent,
    QcRuleDefinition,
    QcSeverity,
    UpdateActiveQcPolicyRequest,
    UpdateActiveQcPolicyResponse,
)

from ..services.idempotency import canonical_request_hash
from .audio import AUDIO_RULES
from .metadata import METADATA_RULES

DEFAULT_RULE_SET_VERSION = "2026.03.phase1-production"
DEFAULT_POLICY_ID = "default-wave2-policy"

DEFAULT_RULES = AUDIO_RULES + METADATA_RULES

class QcRulesRegistryService:
    """Owns active policy and immutable rule definitions for PRD-04/05."""

    def __init__(
        self,
        *,
        now_fn: Callable[[], datetime] | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self._now = now_fn or (lambda: datetime.now(tz=UTC))
        self._rules_by_id = {rule.rule_id: rule for rule in DEFAULT_RULES}
        if connection is None:
            init_db()
            connection = get_connection()
        self._connection = connection
        self._ensure_default_policy()

    def get_active_policy(self) -> GetActiveQcPolicyResponse:
        return GetActiveQcPolicyResponse(policy=self.get_active_policy_snapshot())

    def get_active_policy_snapshot(self) -> QcPolicySnapshot:
        row = self._connection.execute(
            """
            SELECT
              policy_id,
              policy_version,
              rule_set_version,
              rules_json,
              updated_by,
              updated_at,
              reason
            FROM qc_policy_versions
            WHERE policy_id = ?
            ORDER BY policy_version DESC
            LIMIT 1
            """,
            (DEFAULT_POLICY_ID,),
        ).fetchone()
        if row is None:
            raise DomainError(
                code=QcErrorCode.QC_POLICY_NOT_FOUND,
                message=f"Policy {DEFAULT_POLICY_ID} was not found.",
                status_code=404,
                details={"policy_id": DEFAULT_POLICY_ID},
            )
        return self._policy_from_row(row)

    def list_rules(
        self,
        *,
        include_disabled: bool = False,
        policy_id: str | None = None,
    ) -> ListQcRulesResponse:
        active_policy = self.get_active_policy_snapshot()
        if policy_id is not None and policy_id != active_policy.policy_id:
            raise DomainError(
                code=QcErrorCode.QC_POLICY_NOT_FOUND,
                message=f"Policy {policy_id} was not found.",
                status_code=404,
                details={"policy_id": policy_id},
            )

        resolved_rules = self.resolve_rules_for_active_policy(include_disabled=include_disabled)
        return ListQcRulesResponse(
            rules=resolved_rules,
            policy=active_policy,
        )

    def resolve_rules_for_active_policy(self, *, include_disabled: bool) -> list[QcRuleDefinition]:
        active_policy = self.get_active_policy_snapshot()
        resolved_rules: list[QcRuleDefinition] = []
        for binding in active_policy.rules:
            definition = self._rules_by_id.get(binding.rule_id)
            if definition is None:
                continue

            effective_enabled = definition.enabled and binding.enabled
            if not include_disabled and not effective_enabled:
                continue

            effective_blocking = (
                binding.blocking_override
                if binding.blocking_override is not None
                else definition.blocking
            )
            effective_severity = (
                QcSeverity.BLOCKING if effective_blocking else QcSeverity.WARNING
            )

            resolved_rules.append(
                definition.model_copy(
                    update={
                        "enabled": effective_enabled,
                        "blocking": effective_blocking,
                        "severity": effective_severity,
                    }
                )
            )

        return resolved_rules

    def update_active_policy(
        self, request: UpdateActiveQcPolicyRequest
    ) -> UpdateActiveQcPolicyResponse:
        request_key = f"{request.policy.policy_id}:{request.request_id}"
        request_hash = canonical_request_hash(request)
        existing_row = self._connection.execute(
            """
            SELECT response_json, request_hash
            FROM qc_policy_idempotency
            WHERE request_key = ?
            """,
            (request_key,),
        ).fetchone()
        if existing_row is not None:
            existing_hash = str(existing_row["request_hash"] or "")
            if existing_hash and existing_hash != request_hash:
                raise DomainError(
                    code=QcErrorCode.QC_IDEMPOTENCY_CONFLICT,
                    message="QC policy idempotency key was reused with a different payload.",
                    status_code=409,
                    details={
                        "request_key": request_key,
                        "existing_request_hash": existing_hash,
                        "incoming_request_hash": request_hash,
                    },
                )
            return UpdateActiveQcPolicyResponse.model_validate_json(existing_row["response_json"])

        active_policy = self.get_active_policy_snapshot()
        if request.policy.policy_id != active_policy.policy_id:
            raise DomainError(
                code=QcErrorCode.QC_POLICY_NOT_FOUND,
                message=f"Policy {request.policy.policy_id} was not found.",
                status_code=404,
                details={"policy_id": request.policy.policy_id},
            )

        if (
            request.expected_policy_version is not None
            and request.expected_policy_version != active_policy.policy_version
        ):
            raise DomainError(
                code=QcErrorCode.QC_POLICY_VERSION_CONFLICT,
                message="Active policy version does not match expected_policy_version.",
                status_code=409,
                details={
                    "expected_policy_version": request.expected_policy_version,
                    "actual_policy_version": active_policy.policy_version,
                },
            )

        resolved_rules = self._resolve_complete_rule_bindings(request.policy)

        next_policy_version = active_policy.policy_version + 1
        updated_at = self._now()
        updated_policy = QcPolicySnapshot(
            policy_id=active_policy.policy_id,
            policy_version=next_policy_version,
            rule_set_version=request.policy.rule_set_version
            or active_policy.rule_set_version,
            rules=resolved_rules,
            updated_by=request.actor_id,
            updated_at=updated_at,
            reason=request.reason,
        )

        idempotency_key = (
            f"{QC_POLICY_UPDATED_EVENT}:"
            f"{updated_policy.policy_id}:{updated_policy.policy_version}:{request.request_id}"
        )
        event = QcPolicyUpdatedEvent(
            event_name=QC_POLICY_UPDATED_EVENT,
            schema_version=1,
            policy_id=updated_policy.policy_id,
            policy_version=updated_policy.policy_version,
            updated_by=request.actor_id,
            reason=request.reason,
            idempotency_key=idempotency_key,
            occurred_at=updated_at,
        )

        response = UpdateActiveQcPolicyResponse(
            policy=updated_policy,
            audit_hook=AuditHookPayload(
                action=event.event_name,
                entity_type="system",
                entity_id=event.policy_id,
                actor_id=request.actor_id,
                idempotency_key=event.idempotency_key,
                metadata={
                    "policy_version": event.policy_version,
                    "reason": request.reason,
                },
            ),
            observability_hook=ObservabilityHookPayload(
                metric_name="qc_policy_update_total",
                tags={
                    "policy_id": updated_policy.policy_id,
                    "policy_version": str(updated_policy.policy_version),
                },
                value=1,
                emitted_at=updated_at,
            ),
        )

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO qc_policy_versions (
                    policy_id,
                    policy_version,
                    rule_set_version,
                    rules_json,
                    updated_by,
                    updated_at,
                    reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    updated_policy.policy_id,
                    updated_policy.policy_version,
                    updated_policy.rule_set_version,
                    json.dumps([rule.model_dump(mode="json") for rule in updated_policy.rules]),
                    updated_policy.updated_by,
                    updated_policy.updated_at.isoformat(),
                    updated_policy.reason,
                ),
            )
            self._connection.execute(
                """
                INSERT INTO qc_policy_idempotency (
                    request_key,
                    policy_id,
                    request_hash,
                    response_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    request_key,
                    updated_policy.policy_id,
                    request_hash,
                    response.model_dump_json(),
                    updated_at.isoformat(),
                ),
            )

        return response.model_copy(deep=True)

    def _assert_known_rule_ids(self, update: QcPolicyUpdate) -> None:
        seen_rule_ids: set[str] = set()
        unknown_rule_ids: list[str] = []
        duplicate_rule_ids: list[str] = []

        for binding in update.rules:
            if binding.rule_id in seen_rule_ids:
                duplicate_rule_ids.append(binding.rule_id)
                continue

            seen_rule_ids.add(binding.rule_id)
            if binding.rule_id not in self._rules_by_id:
                unknown_rule_ids.append(binding.rule_id)

        if duplicate_rule_ids:
            raise DomainError(
                code=QcErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Policy update includes duplicate rule IDs.",
                status_code=422,
                details={"duplicate_rule_ids": sorted(duplicate_rule_ids)},
            )

        if unknown_rule_ids:
            raise DomainError(
                code=QcErrorCode.QC_RULE_NOT_FOUND,
                message="Policy update references unknown rule IDs.",
                status_code=404,
                details={"unknown_rule_ids": sorted(unknown_rule_ids)},
            )

    def _resolve_complete_rule_bindings(
        self, update: QcPolicyUpdate
    ) -> list[QcPolicyRuleBinding]:
        requested_bindings: dict[str, QcPolicyRuleBinding] = {}
        duplicate_rule_ids: list[str] = []

        for binding in update.rules:
            if binding.rule_id in requested_bindings:
                duplicate_rule_ids.append(binding.rule_id)
                continue
            requested_bindings[binding.rule_id] = binding

        if duplicate_rule_ids:
            raise DomainError(
                code=QcErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Policy update includes duplicate rule IDs.",
                status_code=422,
                details={"duplicate_rule_ids": sorted(duplicate_rule_ids)},
            )

        disabled_rule_ids = self._normalize_disabled_rule_ids(update.disabled_rule_ids)
        overlap_rule_ids = sorted(set(requested_bindings).intersection(disabled_rule_ids))
        if overlap_rule_ids:
            raise DomainError(
                code=QcErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Policy update cannot both include and disable the same rule.",
                status_code=422,
                details={"overlapping_rule_ids": overlap_rule_ids},
            )

        known_rule_ids = set(self._rules_by_id)
        unknown_rule_ids = sorted(
            (set(requested_bindings) | disabled_rule_ids) - known_rule_ids
        )
        if unknown_rule_ids:
            raise DomainError(
                code=QcErrorCode.QC_RULE_NOT_FOUND,
                message="Policy update references unknown rule IDs.",
                status_code=404,
                details={"unknown_rule_ids": unknown_rule_ids},
            )

        missing_rule_ids = [
            rule.rule_id
            for rule in DEFAULT_RULES
            if rule.rule_id not in requested_bindings
            and rule.rule_id not in disabled_rule_ids
        ]
        if missing_rule_ids:
            raise DomainError(
                code=QcErrorCode.INVALID_CONTRACT_PAYLOAD,
                message=(
                    "Policy update must cover the full rule set or explicitly disable omitted rules."
                ),
                status_code=422,
                details={
                    "missing_rule_ids": missing_rule_ids,
                    "requested_rule_ids": sorted(requested_bindings),
                    "disabled_rule_ids": sorted(disabled_rule_ids),
                },
            )

        canonical_rules: list[QcPolicyRuleBinding] = []
        for rule in DEFAULT_RULES:
            binding = requested_bindings.get(rule.rule_id)
            if binding is not None:
                canonical_rules.append(binding)
            else:
                canonical_rules.append(
                    QcPolicyRuleBinding(
                        rule_id=rule.rule_id,
                        enabled=False,
                        blocking_override=None,
                    )
                )
        return canonical_rules

    def _normalize_disabled_rule_ids(self, disabled_rule_ids: list[str]) -> set[str]:
        normalized_rule_ids: set[str] = set()
        duplicate_rule_ids: list[str] = []

        for raw_rule_id in disabled_rule_ids:
            rule_id = str(raw_rule_id or "").strip()
            if not rule_id:
                raise DomainError(
                    code=QcErrorCode.INVALID_CONTRACT_PAYLOAD,
                    message="Disabled rule IDs cannot be blank.",
                    status_code=422,
                    details={"disabled_rule_ids": disabled_rule_ids},
                )
            if rule_id in normalized_rule_ids:
                duplicate_rule_ids.append(rule_id)
                continue
            normalized_rule_ids.add(rule_id)

        if duplicate_rule_ids:
            raise DomainError(
                code=QcErrorCode.INVALID_CONTRACT_PAYLOAD,
                message="Policy update includes duplicate disabled rule IDs.",
                status_code=422,
                details={"duplicate_disabled_rule_ids": sorted(duplicate_rule_ids)},
            )

        return normalized_rule_ids

    def _ensure_default_policy(self) -> None:
        existing = self._connection.execute(
            """
            SELECT policy_version, rule_set_version, rules_json
            FROM qc_policy_versions
            WHERE policy_id = ?
            ORDER BY policy_version DESC
            LIMIT 1
            """,
            (DEFAULT_POLICY_ID,),
        ).fetchone()
        if existing is not None:
            parsed_rules = [
                QcPolicyRuleBinding.model_validate(rule)
                for rule in json.loads(existing["rules_json"])
            ]
            parsed_by_id = {rule.rule_id: rule for rule in parsed_rules}
            default_rule_ids = {rule.rule_id for rule in DEFAULT_RULES}
            existing_rule_ids = set(parsed_by_id.keys())

            if (
                existing_rule_ids == default_rule_ids
                and existing["rule_set_version"] == DEFAULT_RULE_SET_VERSION
            ):
                return

            now = self._now()
            upgraded_rules = [
                parsed_by_id.get(
                    rule.rule_id,
                    QcPolicyRuleBinding(
                        rule_id=rule.rule_id,
                        enabled=True,
                        blocking_override=None,
                    ),
                )
                for rule in DEFAULT_RULES
            ]

            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO qc_policy_versions (
                        policy_id,
                        policy_version,
                        rule_set_version,
                        rules_json,
                        updated_by,
                        updated_at,
                        reason
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        DEFAULT_POLICY_ID,
                        int(existing["policy_version"]) + 1,
                        DEFAULT_RULE_SET_VERSION,
                        json.dumps([rule.model_dump(mode="json") for rule in upgraded_rules]),
                        "system",
                        now.isoformat(),
                        "phase1 production ruleset bootstrap",
                    ),
                )
            return

        now = self._now()
        initial_rules = [
            QcPolicyRuleBinding(rule_id=rule.rule_id, enabled=True, blocking_override=None)
            for rule in DEFAULT_RULES
        ]
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO qc_policy_versions (
                    policy_id,
                    policy_version,
                    rule_set_version,
                    rules_json,
                    updated_by,
                    updated_at,
                    reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    DEFAULT_POLICY_ID,
                    1,
                    DEFAULT_RULE_SET_VERSION,
                    json.dumps([rule.model_dump(mode="json") for rule in initial_rules]),
                    "system",
                    now.isoformat(),
                    "initial policy bootstrap",
                ),
            )

    def _policy_from_row(self, row: sqlite3.Row) -> QcPolicySnapshot:
        parsed_rules = json.loads(row["rules_json"])
        return QcPolicySnapshot(
            policy_id=row["policy_id"],
            policy_version=int(row["policy_version"]),
            rule_set_version=row["rule_set_version"],
            rules=[QcPolicyRuleBinding.model_validate(entry) for entry in parsed_rules],
            updated_by=row["updated_by"],
            updated_at=self._parse_iso(row["updated_at"]),
            reason=row["reason"],
        )

    def _parse_iso(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
