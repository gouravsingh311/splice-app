from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.core.errors import DomainError
from app.features.qc.contracts import QcErrorCode, UpdateActiveQcPolicyRequest
from app.features.qc.rules import QcRulesRegistryService


def create_registry() -> QcRulesRegistryService:
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA foreign_keys=ON;")
    schema_path = Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    connection.executescript(schema_path.read_text(encoding="utf-8"))
    return QcRulesRegistryService(
        now_fn=lambda: datetime(2026, 2, 26, tzinfo=UTC),
        connection=connection,
    )


def create_registry_with_connection(connection: sqlite3.Connection) -> QcRulesRegistryService:
    return QcRulesRegistryService(
        now_fn=lambda: datetime(2026, 2, 26, tzinfo=UTC),
        connection=connection,
    )


def build_policy_update(
    registry: QcRulesRegistryService,
    *,
    request_id: str,
    reason: str,
    actor_id: str = "admin-1",
    actor_role: str = "admin",
    expected_policy_version: int | None = None,
    rules: list[dict[str, object]] | None = None,
    disabled_rule_ids: list[str] | None = None,
) -> UpdateActiveQcPolicyRequest:
    snapshot = registry.get_active_policy_snapshot()
    payload_rules = rules if rules is not None else [
        {
            "rule_id": binding.rule_id,
            "enabled": binding.enabled,
            "blocking_override": binding.blocking_override,
            "params": binding.params,
        }
        for binding in snapshot.rules
    ]
    return UpdateActiveQcPolicyRequest(
        request_id=request_id,
        actor_id=actor_id,
        actor_role=actor_role,
        reason=reason,
        expected_policy_version=expected_policy_version or snapshot.policy_version,
        policy={
            "policy_id": snapshot.policy_id,
            "rule_set_version": snapshot.rule_set_version,
            "rules": payload_rules,
            "disabled_rule_ids": disabled_rule_ids or [],
        },
    )


def test_registry_lists_active_rules_without_disabled_entries() -> None:
    registry = create_registry()

    response = registry.list_rules(include_disabled=False, policy_id=None)
    assert response.policy.policy_id == "default-wave2-policy"
    assert len(response.rules) >= 4
    assert all(rule.enabled for rule in response.rules)


def test_registry_rejects_unknown_rule_ids_on_policy_update() -> None:
    registry = create_registry()
    snapshot = registry.get_active_policy_snapshot()
    payload_rules = [
        {
            "rule_id": binding.rule_id,
            "enabled": binding.enabled,
            "blocking_override": binding.blocking_override,
            "params": binding.params,
        }
        for binding in snapshot.rules
    ] + [
        {
            "rule_id": "unknown.rule.id",
            "enabled": True,
            "blocking_override": None,
        }
    ]

    with pytest.raises(DomainError) as exc_info:
        registry.update_active_policy(
            UpdateActiveQcPolicyRequest(
                request_id="req-1",
                actor_id="admin-1",
                actor_role="admin",
                reason="Enable experimental rule",
                expected_policy_version=1,
                policy={
                    "policy_id": "default-wave2-policy",
                    "rule_set_version": "2026.03.phase1-production",
                    "rules": payload_rules,
                    "disabled_rule_ids": [],
                },
            )
        )

    assert exc_info.value.code == QcErrorCode.QC_RULE_NOT_FOUND


def test_registry_policy_update_is_idempotent_by_request_key() -> None:
    registry = create_registry()
    request = build_policy_update(
        registry,
        request_id="req-2",
        reason="Keep naming warning non-blocking",
    )

    first = registry.update_active_policy(request)
    second = registry.update_active_policy(request)

    assert first.policy.policy_version == 2
    assert second.policy.policy_version == 2
    assert first.audit_hook.idempotency_key == second.audit_hook.idempotency_key


def test_registry_persists_policy_update_across_service_restart(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    registry = create_registry_with_connection(in_memory_db_connection)
    request = build_policy_update(
        registry,
        request_id="req-persist-1",
        reason="Persist policy update",
    )
    registry.update_active_policy(request)

    restarted = create_registry_with_connection(in_memory_db_connection)
    snapshot = restarted.get_active_policy_snapshot()
    assert snapshot.policy_version == 2
    assert snapshot.updated_by == "admin-1"
    assert snapshot.reason == "Persist policy update"


def test_registry_rejects_partial_policy_update_without_explicit_disable() -> None:
    registry = create_registry()
    snapshot = registry.get_active_policy_snapshot()
    partial_rules = [
        {
            "rule_id": snapshot.rules[0].rule_id,
            "enabled": True,
            "blocking_override": None,
            "params": snapshot.rules[0].params,
        }
    ]

    with pytest.raises(DomainError) as exc_info:
        registry.update_active_policy(
            UpdateActiveQcPolicyRequest(
                request_id="req-partial",
                actor_id="admin-1",
                actor_role="admin",
                reason="Partial update should be rejected",
                expected_policy_version=snapshot.policy_version,
                policy={
                    "policy_id": snapshot.policy_id,
                    "rule_set_version": snapshot.rule_set_version,
                    "rules": partial_rules,
                    "disabled_rule_ids": [],
                },
            )
        )

    assert exc_info.value.code == QcErrorCode.INVALID_CONTRACT_PAYLOAD
    assert "missing_rule_ids" in exc_info.value.details


def test_registry_accepts_partial_policy_update_with_explicit_disabled_rules() -> None:
    registry = create_registry()
    snapshot = registry.get_active_policy_snapshot()
    partial_rule = snapshot.rules[0]
    disabled_rule_ids = [rule.rule_id for rule in snapshot.rules[1:]]

    result = registry.update_active_policy(
        UpdateActiveQcPolicyRequest(
            request_id="req-partial-disable",
            actor_id="admin-1",
            actor_role="admin",
            reason="Intentionally disable the remaining rules",
            expected_policy_version=snapshot.policy_version,
            policy={
                "policy_id": snapshot.policy_id,
                "rule_set_version": snapshot.rule_set_version,
                "rules": [
                    {
                        "rule_id": partial_rule.rule_id,
                        "enabled": partial_rule.enabled,
                        "blocking_override": partial_rule.blocking_override,
                        "params": partial_rule.params,
                    }
                ],
                "disabled_rule_ids": disabled_rule_ids,
            },
        )
    )

    assert result.policy.policy_version == snapshot.policy_version + 1
    assert all(
        binding.enabled is False or binding.rule_id == partial_rule.rule_id
        for binding in result.policy.rules
    )


def test_registry_upgrades_existing_stale_policy_to_phase1_defaults(
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    now = datetime(2026, 2, 26, tzinfo=UTC)
    with in_memory_db_connection:
        in_memory_db_connection.execute(
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
                "default-wave2-policy",
                1,
                "2026.02.wave2-baseline",
                json.dumps(
                    [
                        {
                            "rule_id": "FOLDER_AUDIO_MISSING",
                            "enabled": True,
                            "blocking_override": None,
                        },
                        {
                            "rule_id": "AUDIO_ZIP_NAMING",
                            "enabled": True,
                            "blocking_override": None,
                        },
                    ]
                ),
                "system",
                now.isoformat(),
                "legacy bootstrap",
            ),
        )

    registry = create_registry_with_connection(in_memory_db_connection)
    snapshot = registry.get_active_policy_snapshot()

    assert snapshot.policy_version == 2
    assert snapshot.rule_set_version == "2026.03.phase1-production"
    assert len(snapshot.rules) == len(
        registry.resolve_rules_for_active_policy(include_disabled=True)
    )
