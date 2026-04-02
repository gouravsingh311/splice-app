from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.qc.contracts import (
    QC_REPORT_GENERATED_EVENT,
    QcPackInput,
    QcPolicyUpdatedEvent,
    QcReportGeneratedEvent,
    QcReportStatus,
    QcRuleDefinition,
    QcRunResult,
    QcSeverity,
    UpdateActiveQcPolicyRequest,
)


def test_qc_report_generated_event_keeps_explicit_versioned_name() -> None:
    payload = QcReportGeneratedEvent(
        event_name=QC_REPORT_GENERATED_EVENT,
        schema_version=1,
        report_id="qcrpt:sub-1:req-1",
        submission_id="sub-1",
        status=QcReportStatus.PASSED,
        blocking_failure_count=0,
        warning_count=1,
        rule_set_version="2026.03.phase1-production",
        policy_version=1,
        occurred_at=datetime.now(tz=UTC),
    )

    assert payload.event_name == QC_REPORT_GENERATED_EVENT
    assert payload.schema_version == 1


def test_qc_policy_updated_event_rejects_invalid_event_name() -> None:
    with pytest.raises(ValidationError):
        QcPolicyUpdatedEvent(
            event_name="qc.policy.updated.v2",
            schema_version=1,
            policy_id="default-wave2-policy",
            policy_version=2,
            updated_by="admin-1",
            reason="Tighten sample count enforcement",
            idempotency_key="qc.policy.updated.v1:default-wave2-policy:2:req-1",
            occurred_at=datetime.now(tz=UTC),
        )


def test_admin_policy_request_accepts_non_admin_actor_for_service_guard() -> None:
    payload = UpdateActiveQcPolicyRequest(
        request_id="req-1",
        actor_id="reviewer-1",
        actor_role="reviewer",
        reason="test",
        policy={
            "policy_id": "default-wave2-policy",
            "rule_set_version": "2026.03.phase1-production",
            "rules": [
                {
                    "rule_id": "FOLDER_AUDIO_MISSING",
                    "enabled": True,
                    "blocking_override": None,
                }
            ],
        },
    )

    assert payload.actor_role.value == "reviewer"


def test_qc_rule_definition_normalizes_blocking_severity_enums() -> None:
    rule = QcRuleDefinition(
        rule_id="SAMPLE_COUNT_EXCEEDED",
        title="Sample count maximum",
        description="Pack must contain at most 1000 samples.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Reduce sample count to 1000 files or fewer.",
        enabled=True,
    )

    assert rule.severity == QcSeverity.BLOCKING


def test_qc_pack_input_accepts_optional_local_pack_path() -> None:
    payload = QcPackInput(
        pack_name="Label - Pack",
        local_pack_path="/tmp/Label - Pack",
        declared_top_level_folders=["Artwork", "Audio", "Demo", "Description"],
        sample_count=2,
        contains_unsupported_name_tokens=False,
    )

    assert payload.local_pack_path == "/tmp/Label - Pack"


def test_qc_run_result_carries_canonical_export_metadata() -> None:
    payload = QcRunResult(
        run_id="req-1",
        submission_id="sub-1",
        status=QcReportStatus.PASSED,
        started_at=datetime.now(tz=UTC),
        completed_at=datetime.now(tz=UTC),
        generated_at=datetime.now(tz=UTC),
        rule_set_version="2026.03.phase1-production",
        policy_version=1,
    )

    assert payload.submission_id == "sub-1"
    assert payload.rule_set_version == "2026.03.phase1-production"
