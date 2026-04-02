"""Contract-first models for PRD-04/05/14 QC engine, rules registry, and admin config."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

QC_REPORT_GENERATED_EVENT = "qc.report.generated.v1"
QC_POLICY_UPDATED_EVENT = "qc.policy.updated.v1"


class QcActorRole(StrEnum):
    CREATOR = "creator"
    REVIEWER = "reviewer"
    ADMIN = "admin"
    SYSTEM = "system"


class QcSeverity(StrEnum):
    BLOCKING = "blocking"
    WARNING = "warning"


class QcReportStatus(StrEnum):
    PASSED = "passed"
    FAILED = "failed"


class QcFindingStatus(StrEnum):
    FAILED = "failed"
    WARNING = "warning"


class QcErrorCode(StrEnum):
    INVALID_CONTRACT_PAYLOAD = "INVALID_CONTRACT_PAYLOAD"
    QC_RULE_NOT_FOUND = "QC_RULE_NOT_FOUND"
    QC_POLICY_NOT_FOUND = "QC_POLICY_NOT_FOUND"
    QC_POLICY_FORBIDDEN = "QC_POLICY_FORBIDDEN"
    QC_POLICY_VERSION_CONFLICT = "QC_POLICY_VERSION_CONFLICT"
    QC_IDEMPOTENCY_CONFLICT = "QC_IDEMPOTENCY_CONFLICT"
    QC_EVALUATION_NOT_ALLOWED = "QC_EVALUATION_NOT_ALLOWED"
    INVALID_EVENT_NAME = "INVALID_EVENT_NAME"


class QcPolicyRuleBinding(BaseModel):
    rule_id: str = Field(min_length=1)
    enabled: bool = True
    blocking_override: bool | None = None
    params: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class QcRuleDefinition(BaseModel):
    rule_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    severity: QcSeverity
    blocking: bool
    category: str = Field(min_length=1)
    remediation: str = Field(min_length=1)
    enabled: bool = True

    model_config = ConfigDict(extra="forbid")


class QcPolicySnapshot(BaseModel):
    policy_id: str = Field(min_length=1)
    policy_version: int = Field(ge=1)
    rule_set_version: str = Field(min_length=1)
    rules: list[QcPolicyRuleBinding] = Field(default_factory=list)
    updated_by: str = Field(min_length=1)
    updated_at: datetime
    reason: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class QcPolicyUpdate(BaseModel):
    policy_id: str = Field(min_length=1)
    rule_set_version: str | None = None
    rules: list[QcPolicyRuleBinding] = Field(min_length=1)
    disabled_rule_ids: list[str] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class QcAudioZipInput(BaseModel):
    filename: str = Field(min_length=1)
    size_bytes: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")


class QcPackInput(BaseModel):
    pack_name: str = Field(min_length=1)
    local_pack_path: str | None = None
    declared_top_level_folders: list[str] = Field(default_factory=list)
    audio_zip: QcAudioZipInput | None = None
    sample_count: int = Field(default=0, ge=0)
    contains_unsupported_name_tokens: bool = False

    model_config = ConfigDict(extra="forbid")


class QcEvaluationRequest(BaseModel):
    request_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: QcActorRole
    pack: QcPackInput
    rule_set_version: str | None = None

    model_config = ConfigDict(extra="forbid")


class QcFinding(BaseModel):
    finding_id: str = Field(min_length=1)
    rule_id: str = Field(min_length=1)
    severity: QcSeverity
    blocking: bool
    status: QcFindingStatus
    message: str = Field(min_length=1)
    remediation: str = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class QcReportSummary(BaseModel):
    blocking_failures: int = Field(ge=0)
    warnings: int = Field(ge=0)
    evaluated_rule_count: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid")


class QcReport(BaseModel):
    report_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    status: QcReportStatus
    summary: QcReportSummary
    findings: list[QcFinding]
    generated_at: datetime
    rule_set_version: str = Field(min_length=1)
    policy_version: int = Field(ge=1)

    model_config = ConfigDict(extra="forbid")


class QcEvaluationResult(BaseModel):
    report: QcReport
    idempotent: bool
    applied_policy_id: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class QcRunResult(BaseModel):
    run_id: str | None = None
    submission_id: str | None = None
    status: QcReportStatus | Literal["not_run"]
    started_at: datetime | None = None
    completed_at: datetime | None = None
    generated_at: datetime | None = None
    rule_set_version: str | None = None
    policy_version: int | None = Field(default=None, ge=1)
    findings: list[QcFinding] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class QcResultsResponse(BaseModel):
    latest: QcRunResult
    history: list[QcRunResult] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class ListQcRulesResponse(BaseModel):
    rules: list[QcRuleDefinition]
    policy: QcPolicySnapshot

    model_config = ConfigDict(extra="forbid")


class GetActiveQcPolicyResponse(BaseModel):
    policy: QcPolicySnapshot

    model_config = ConfigDict(extra="forbid")


class AuditHookPayload(BaseModel):
    action: str = Field(min_length=1)
    entity_type: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class ObservabilityHookPayload(BaseModel):
    metric_name: str = Field(min_length=1)
    tags: dict[str, str] = Field(default_factory=dict)
    value: int | float
    emitted_at: datetime

    model_config = ConfigDict(extra="forbid")


class UpdateActiveQcPolicyRequest(BaseModel):
    request_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: QcActorRole
    reason: str = Field(min_length=1)
    expected_policy_version: int | None = Field(default=None, ge=1)
    policy: QcPolicyUpdate

    model_config = ConfigDict(extra="forbid")

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("reason must not be empty")
        return normalized


class UpdateActiveQcPolicyResponse(BaseModel):
    policy: QcPolicySnapshot
    audit_hook: AuditHookPayload
    observability_hook: ObservabilityHookPayload

    model_config = ConfigDict(extra="forbid")


class QcReportGeneratedEvent(BaseModel):
    event_name: Literal[QC_REPORT_GENERATED_EVENT]
    schema_version: Literal[1]
    report_id: str = Field(min_length=1)
    submission_id: str = Field(min_length=1)
    status: QcReportStatus
    blocking_failure_count: int = Field(ge=0)
    warning_count: int = Field(ge=0)
    rule_set_version: str = Field(min_length=1)
    policy_version: int = Field(ge=1)
    occurred_at: datetime

    model_config = ConfigDict(extra="forbid")


class QcPolicyUpdatedEvent(BaseModel):
    event_name: Literal[QC_POLICY_UPDATED_EVENT]
    schema_version: Literal[1]
    policy_id: str = Field(min_length=1)
    policy_version: int = Field(ge=1)
    updated_by: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    occurred_at: datetime

    model_config = ConfigDict(extra="forbid")
