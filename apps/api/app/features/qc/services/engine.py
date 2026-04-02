"""SQLite-backed PRD-04 QC engine with production-depth file inspection checks."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from app.core.db.session import get_connection, init_db
from app.core.errors import DomainError
from app.features.qc.contracts import (
    QcErrorCode,
    QcEvaluationRequest,
    QcEvaluationResult,
    QcFindingStatus,
    QcReport,
    QcReportStatus,
    QcReportSummary,
)
from app.features.qc.rules import QcRulesRegistryService

from .idempotency import canonical_request_hash
from .inspection import QcInspectionMixin
from .inspection.base import (
    STRICT_DB_TOLERANCE,
    TARGET_DB_TOLERANCE,
    TARGET_PREVIEW_NORMALIZATION_DB,
)
from .reporting import QcReportingMixin


class QcEngineService(QcInspectionMixin, QcReportingMixin):
    """Evaluates pack assets against active QC policy and stores deterministic reports."""

    def __init__(
        self,
        *,
        rules_registry: QcRulesRegistryService,
        now_fn: Callable[[], datetime] | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self._rules_registry = rules_registry
        self._now = now_fn or (lambda: datetime.now(tz=UTC))
        if connection is None:
            init_db()
            connection = get_connection()
        self._connection = connection

    def evaluate(self, request: QcEvaluationRequest) -> QcEvaluationResult:
        request_key = f"{request.submission_id}:{request.request_id}"
        request_hash = canonical_request_hash(request)
        existing = self._connection.execute(
            """
            SELECT response_json, request_hash
            FROM qc_evaluation_idempotency
            WHERE request_key = ?
            """,
            (request_key,),
        ).fetchone()
        if existing is not None:
            existing_hash = str(existing["request_hash"] or "")
            if existing_hash and existing_hash != request_hash:
                raise DomainError(
                    code=QcErrorCode.QC_IDEMPOTENCY_CONFLICT,
                    message="QC evaluation idempotency key was reused with a different payload.",
                    status_code=409,
                    details={
                        "request_key": request_key,
                        "existing_request_hash": existing_hash,
                        "incoming_request_hash": request_hash,
                    },
                )
            replay = QcEvaluationResult.model_validate_json(existing["response_json"])
            return replay.model_copy(deep=True, update={"idempotent": True})

        active_policy = self._rules_registry.get_active_policy_snapshot()
        if (
            request.rule_set_version is not None
            and request.rule_set_version != active_policy.rule_set_version
        ):
            raise DomainError(
                code=QcErrorCode.QC_POLICY_VERSION_CONFLICT,
                message="Request rule_set_version does not match active policy.",
                status_code=409,
                details={
                    "request_rule_set_version": request.rule_set_version,
                    "active_rule_set_version": active_policy.rule_set_version,
                },
            )

        resolved_rules = self._rules_registry.resolve_rules_for_active_policy(
            include_disabled=False
        )
        normalization_policy = self._resolve_normalization_policy(active_policy.rules)
        issues_by_rule = self._inspect_pack(
            request,
            normalization_policy=normalization_policy,
        )
        findings = self._resolve_findings(
            request=request,
            rules=resolved_rules,
            issues_by_rule=issues_by_rule,
        )

        blocking_failures = sum(1 for finding in findings if finding.blocking)
        warnings = sum(1 for finding in findings if finding.status == QcFindingStatus.WARNING)
        report_status = (
            QcReportStatus.FAILED if blocking_failures > 0 else QcReportStatus.PASSED
        )

        generated_at = self._now()
        report = QcReport(
            report_id=f"qcrpt:{request.submission_id}:{request.request_id}",
            submission_id=request.submission_id,
            status=report_status,
            summary=QcReportSummary(
                blocking_failures=blocking_failures,
                warnings=warnings,
                evaluated_rule_count=len(resolved_rules),
            ),
            findings=findings,
            generated_at=generated_at,
            rule_set_version=active_policy.rule_set_version,
            policy_version=active_policy.policy_version,
        )

        _ = self._build_report_event(report, occurred_at=generated_at)

        outcome = QcEvaluationResult(
            report=report,
            idempotent=False,
            applied_policy_id=active_policy.policy_id,
        )

        with self._connection:
            self._connection.execute(
                """
                INSERT INTO qc_reports (
                    report_id,
                    submission_id,
                    request_id,
                    status,
                    summary_json,
                    rule_set_version,
                    policy_version,
                    applied_policy_id,
                    generated_at,
                    created_at,
                    idempotency_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report.report_id,
                    report.submission_id,
                    request.request_id,
                    report.status.value,
                    report.summary.model_dump_json(),
                    report.rule_set_version,
                    report.policy_version,
                    active_policy.policy_id,
                    report.generated_at.isoformat(),
                    generated_at.isoformat(),
                    request_key,
                ),
            )
            if report.findings:
                self._connection.executemany(
                    """
                    INSERT INTO qc_findings (
                        finding_id,
                        report_id,
                        rule_id,
                        severity,
                        blocking,
                        status,
                        message,
                        remediation,
                        context_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            finding.finding_id,
                            report.report_id,
                            finding.rule_id,
                            finding.severity.value,
                            1 if finding.blocking else 0,
                            finding.status.value,
                            finding.message,
                            finding.remediation,
                            json.dumps(finding.context),
                        )
                        for finding in report.findings
                    ],
                )
            self._connection.execute(
                """
                INSERT INTO qc_evaluation_idempotency (
                    request_key,
                    submission_id,
                    request_id,
                    report_id,
                    request_hash,
                    response_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    request_key,
                    request.submission_id,
                    request.request_id,
                    report.report_id,
                    request_hash,
                    outcome.model_dump_json(),
                    generated_at.isoformat(),
                ),
            )

        return outcome.model_copy(deep=True)

    def _build_normalization_message(
        self,
        subject: str,
        *,
        target_db: float,
        strict_enforcement: bool,
    ) -> str:
        target_text = f"{target_db:.1f}dB"
        if strict_enforcement:
            return f"{subject} must be strictly normalized to {target_text}."
        return f"{subject} must be normalized to {target_text}."

    def _resolve_normalization_policy(
        self,
        policy_rules: list[Any],
    ) -> dict[str, dict[str, Any]]:
        defaults = {
            "DEMO_NORMALIZATION_INVALID": {
                "target_db": TARGET_PREVIEW_NORMALIZATION_DB,
                "tolerance_db": TARGET_DB_TOLERANCE,
                "strict_enforcement": False,
            },
            "PRESET_PREVIEW_NORMALIZATION_INVALID": {
                "target_db": TARGET_PREVIEW_NORMALIZATION_DB,
                "tolerance_db": TARGET_DB_TOLERANCE,
                "strict_enforcement": False,
            },
            "MIDI_PREVIEW_NORMALIZATION_INVALID": {
                "target_db": TARGET_PREVIEW_NORMALIZATION_DB,
                "tolerance_db": TARGET_DB_TOLERANCE,
                "strict_enforcement": False,
            },
        }
        by_rule = {
            str(rule.rule_id): rule
            for rule in policy_rules
            if hasattr(rule, "rule_id")
        }
        for rule_id, config in defaults.items():
            rule = by_rule.get(rule_id)
            params = getattr(rule, "params", {}) if rule else {}
            if not isinstance(params, dict):
                params = {}
            target_db = params.get("target_peak_db")
            tolerance_db = params.get("tolerance_db")
            strict_enforcement = params.get("strict_enforcement")

            if isinstance(target_db, (int, float)) and -24.0 <= float(target_db) <= 0.0:
                config["target_db"] = float(target_db)
            if isinstance(tolerance_db, (int, float)) and 0.0 <= float(tolerance_db) <= 6.0:
                config["tolerance_db"] = float(tolerance_db)
            if strict_enforcement is True:
                config["strict_enforcement"] = True
                config["tolerance_db"] = min(config["tolerance_db"], STRICT_DB_TOLERANCE)
        return defaults

    def _normalize_preview_stem_key(self, stem: str) -> str:
        return str(stem or "").casefold()
