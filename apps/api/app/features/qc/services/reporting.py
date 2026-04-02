"""SQLite-backed PRD-04 QC engine with production-depth file inspection checks."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any

from app.features.qc.contracts import (
    QC_REPORT_GENERATED_EVENT,
    QcEvaluationRequest,
    QcFinding,
    QcFindingStatus,
    QcReport,
    QcReportGeneratedEvent,
    QcReportStatus,
    QcResultsResponse,
    QcRuleDefinition,
    QcRunResult,
)

MIN_AUDIO_ZIP_SIZE_BYTES = 100 * 1024
MAX_AUDIO_ZIP_SIZE_BYTES = 4 * 1024 * 1024 * 1024
MAX_SAMPLE_COUNT = 1000
MAX_SAMPLE_DURATION_SECONDS = 180
MIN_SAMPLE_RATE = 44_100
MIN_SAMPLE_BYTES = 1024
MAX_DEMO_SIZE_BYTES = 10 * 1024 * 1024
MAX_DEMO_DURATION_SECONDS = 210
MAX_ARTWORK_BYTES = 10 * 1024 * 1024
MIN_ARTWORK_DIMENSION = 600
MAX_ARTWORK_DIMENSION = 2000
MIN_PRESET_BYTES = 100
MAX_PRESET_BYTES = 50 * 1024 * 1024
MAX_PREVIEW_BYTES = 5 * 1024 * 1024
MAX_PREVIEW_DURATION_SECONDS = 60

AUDIO_FOLDER_ALIASES = frozenset({"audio"})
ARTWORK_FOLDER_ALIASES = frozenset({"artwork", "coverart"})
DEMO_FOLDER_ALIASES = frozenset({"demo", "demos"})
DESCRIPTION_FOLDER_ALIASES = frozenset({"description", "descriptioninfo"})
ONE_SHOTS_FOLDER_ALIASES = frozenset({"oneshots", "oneshot", "one shots", "one_shots"})
LOOPS_FOLDER_ALIASES = frozenset({"loops", "loop"})

BANNED_TERMS = ("rhodes", "tribal", "oriental", "urban")
FILENAME_ALLOWED_PATTERN = re.compile(r"^[A-Za-z0-9_\-# ]+$")
LABEL_PACK_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-# ]+ - [A-Za-z0-9_\-# ]+$")
FRACTIONAL_BPM_PATTERN = re.compile(r"\d+\.\d+")
MAX_NORMALIZATION_DB = 0.0
MIN_SAMPLE_NORMALIZATION_DB = -15.0
TARGET_PREVIEW_NORMALIZATION_DB = -1.0
TARGET_DB_TOLERANCE = 0.7
STRICT_DB_TOLERANCE = 0.2

SUPPORTED_PRESET_EXTENSIONS = {
    ".xml",
    ".zip",
    ".nmsv",
    ".phaseplant",
    ".fxp",
    ".serumpreset",
    ".spf",
    ".vital",
}



class QcReportingMixin:
    def get_results(self, submission_id: str) -> QcResultsResponse:
        rows = self._connection.execute(
            """
            SELECT
              report_id,
              submission_id,
              status,
              generated_at,
              rule_set_version,
              policy_version
            FROM qc_reports
            WHERE submission_id = ?
            ORDER BY generated_at ASC, report_id ASC
            """,
            (submission_id,),
        ).fetchall()

        if not rows:
            return QcResultsResponse(
                latest=QcRunResult(
                    run_id=None,
                    submission_id=None,
                    status="not_run",
                    started_at=None,
                    completed_at=None,
                    generated_at=None,
                    rule_set_version=None,
                    policy_version=None,
                    findings=[],
                ),
                history=[],
            )

        findings_by_report_id = self._findings_for_reports([row["report_id"] for row in rows])
        history: list[QcRunResult] = []
        for row in rows:
            report_id = row["report_id"]
            generated_at = self._parse_iso(row["generated_at"])
            history.append(
                QcRunResult(
                    run_id=report_id.rsplit(":", 1)[-1],
                    submission_id=row["submission_id"],
                    status=QcReportStatus(row["status"]),
                    started_at=generated_at,
                    completed_at=generated_at,
                    generated_at=generated_at,
                    rule_set_version=row["rule_set_version"],
                    policy_version=int(row["policy_version"]),
                    findings=findings_by_report_id.get(report_id, []),
                )
            )

        return QcResultsResponse(latest=history[-1], history=history)

    def _resolve_findings(
        self,
        *,
        request: QcEvaluationRequest,
        rules: list[QcRuleDefinition],
        issues_by_rule: dict[str, list[dict[str, Any]]],
    ) -> list[QcFinding]:
        findings: list[QcFinding] = []
        sequence = 0
        for rule in rules:
            for issue in issues_by_rule.get(rule.rule_id, []):
                sequence += 1
                findings.append(
                    QcFinding(
                        finding_id=(
                            f"{request.submission_id}:{request.request_id}:{rule.rule_id}:{sequence}"
                        ),
                        rule_id=rule.rule_id,
                        severity=rule.severity,
                        blocking=rule.blocking,
                        status=(
                            QcFindingStatus.FAILED
                            if rule.blocking
                            else QcFindingStatus.WARNING
                        ),
                        message=str(issue.get("message") or "Rule violation."),
                        remediation=rule.remediation,
                        context=issue.get("context") or {},
                    )
                )
        return findings

    def _findings_for_report(self, report_id: str) -> list[QcFinding]:
        findings_by_report = self._findings_for_reports([report_id])
        return findings_by_report.get(report_id, [])

    def _findings_for_reports(self, report_ids: list[str]) -> dict[str, list[QcFinding]]:
        if not report_ids:
            return {}

        placeholders = ",".join("?" for _ in report_ids)
        rows = self._connection.execute(
            f"""
            SELECT
              report_id,
              finding_id,
              rule_id,
              severity,
              blocking,
              status,
              message,
              remediation,
              context_json
            FROM qc_findings
            WHERE report_id IN ({placeholders})
            ORDER BY report_id ASC, finding_id ASC
            """,
            tuple(report_ids),
        ).fetchall()

        findings_by_report_id: dict[str, list[QcFinding]] = {report_id: [] for report_id in report_ids}
        for row in rows:
            findings_by_report_id.setdefault(row["report_id"], []).append(
                QcFinding(
                    finding_id=row["finding_id"],
                    rule_id=row["rule_id"],
                    severity=row["severity"],
                    blocking=bool(row["blocking"]),
                    status=row["status"],
                    message=row["message"],
                    remediation=row["remediation"],
                    context=json.loads(row["context_json"]),
                )
            )
        return findings_by_report_id

    def _build_report_event(
        self, report: QcReport, *, occurred_at: datetime
    ) -> QcReportGeneratedEvent:
        return QcReportGeneratedEvent(
            event_name=QC_REPORT_GENERATED_EVENT,
            schema_version=1,
            report_id=report.report_id,
            submission_id=report.submission_id,
            status=report.status,
            blocking_failure_count=report.summary.blocking_failures,
            warning_count=report.summary.warnings,
            rule_set_version=report.rule_set_version,
            policy_version=report.policy_version,
            occurred_at=occurred_at,
        )

    def _parse_iso(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
