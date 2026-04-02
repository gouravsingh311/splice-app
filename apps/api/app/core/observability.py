"""PRD-15 in-memory metrics and SQLite-backed incident annotations."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from app.core.db.session import get_connection
from app.core.logging import get_correlation_id
from app.features.jobs.contracts import (
    IncidentAnnotationRequest,
    IncidentAnnotationResult,
    IncidentAnnotationSnapshot,
    IncidentFailureClass,
    IncidentRemediationStatus,
    IncidentSeverity,
)

Labels = dict[str, str]
MetricKey = tuple[str, tuple[tuple[str, str], ...]]


class ObservabilityService:
    """Collects in-memory metrics and persists incident annotations in SQLite."""

    def __init__(
        self,
        *,
        service: str,
        environment: str,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self._service = service
        self._environment = environment
        self._connection = connection or get_connection()
        self._counter_values: defaultdict[MetricKey, float] = defaultdict(float)
        self._gauge_values: dict[MetricKey, float] = {}
        self._hist_sum: defaultdict[MetricKey, float] = defaultdict(float)
        self._hist_count: defaultdict[MetricKey, int] = defaultdict(int)
        self._metric_help: dict[str, str] = {}
        self._lock = Lock()
        self._ensure_incident_annotation_schema()

    def increment_counter(
        self, name: str, *, value: float = 1.0, labels: Labels | None = None, help_text: str = ""
    ) -> None:
        metric_key = self._metric_key(name, labels)
        with self._lock:
            self._counter_values[metric_key] += value
            if help_text:
                self._metric_help.setdefault(name, help_text)

    def set_gauge(
        self, name: str, *, value: float, labels: Labels | None = None, help_text: str = ""
    ) -> None:
        metric_key = self._metric_key(name, labels)
        with self._lock:
            self._gauge_values[metric_key] = value
            if help_text:
                self._metric_help.setdefault(name, help_text)

    def observe_histogram(
        self, name: str, *, value: float, labels: Labels | None = None, help_text: str = ""
    ) -> None:
        metric_key = self._metric_key(name, labels)
        with self._lock:
            self._hist_sum[metric_key] += value
            self._hist_count[metric_key] += 1
            if help_text:
                self._metric_help.setdefault(name, help_text)

    def record_http_request(
        self,
        *,
        method: str,
        path: str,
        status_code: int,
        duration_seconds: float,
    ) -> None:
        labels = {
            "method": method,
            "path": path,
            "status": str(status_code),
            "service": self._service,
            "environment": self._environment,
        }
        self.increment_counter(
            "splice_api_http_requests_total",
            labels=labels,
            help_text="Total API requests handled by FastAPI routes.",
        )
        self.observe_histogram(
            "splice_api_http_request_duration_seconds",
            value=duration_seconds,
            labels=labels,
            help_text="FastAPI request duration seconds by route/status.",
        )

    def append_incident_annotation(
        self, payload: IncidentAnnotationRequest
    ) -> IncidentAnnotationResult:
        idempotency_key = payload.idempotency_key or self._derive_annotation_idempotency_key(payload)
        with self._lock:
            if idempotency_key:
                existing = self._fetch_annotation_by_idempotency(idempotency_key)
                if existing is not None:
                    return IncidentAnnotationResult(idempotent=True, annotation=existing)

            annotation = IncidentAnnotationSnapshot(
                id=f"incident:{uuid4().hex}",
                source=payload.source,
                severity=payload.severity,
                note=payload.note,
                linked_entity=payload.linked_entity,
                failure_class=payload.failure_class,
                correlation_id=payload.correlation_id or get_correlation_id(),
                remediation_status=payload.remediation_status,
                remediation_owner=payload.remediation_owner,
                remediation_link=payload.remediation_link,
                audit_event_id=payload.audit_event_id,
                created_at=datetime.now(tz=UTC),
            )

            with self._connection:
                self._connection.execute(
                    """
                    INSERT INTO incident_annotations (
                      id, source, severity, note, linked_entity, failure_class,
                      correlation_id, remediation_status, remediation_owner, remediation_link,
                      audit_event_id, idempotency_key, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        annotation.id,
                        annotation.source,
                        annotation.severity.value,
                        annotation.note,
                        annotation.linked_entity,
                        annotation.failure_class.value if annotation.failure_class else None,
                        annotation.correlation_id,
                        annotation.remediation_status.value,
                        annotation.remediation_owner,
                        annotation.remediation_link,
                        annotation.audit_event_id,
                        idempotency_key,
                        self._dt(annotation.created_at),
                    ),
                )

        self.increment_counter(
            "splice_api_incident_annotations_total",
            labels={"source": payload.source, "severity": payload.severity.value},
            help_text="Count of incident annotations appended by source/severity.",
        )
        return IncidentAnnotationResult(idempotent=False, annotation=annotation)

    def record_failure_class(
        self,
        *,
        failure_class: IncidentFailureClass,
        source: str,
        note: str,
        linked_entity: str,
        correlation_id: str | None = None,
        severity: IncidentSeverity = IncidentSeverity.CRITICAL,
        remediation_link: str | None = None,
        audit_event_id: str | None = None,
        remediation_owner: str | None = None,
    ) -> IncidentAnnotationResult:
        resolved_correlation_id = correlation_id or get_correlation_id()
        self.increment_counter(
            "splice_api_failure_class_total",
            labels={
                "failure_class": failure_class.value,
                "source": source,
                "severity": severity.value,
            },
            help_text="Structured failure telemetry grouped by failure class and source.",
        )
        self.increment_counter(
            "splice_api_failure_context_total",
            labels={
                "failure_class": failure_class.value,
                "correlation_id": resolved_correlation_id or "none",
                "linked_entity": linked_entity,
            },
            help_text="Failure correlation links for alert-to-remediation context.",
        )
        return self.append_incident_annotation(
            IncidentAnnotationRequest(
                source=source,
                severity=severity,
                note=note,
                linked_entity=linked_entity,
                failure_class=failure_class,
                correlation_id=resolved_correlation_id,
                remediation_status=IncidentRemediationStatus.OPEN,
                remediation_owner=remediation_owner,
                remediation_link=remediation_link,
                audit_event_id=audit_event_id,
            )
        )

    def render_metrics(self) -> str:
        with self._lock:
            lines: list[str] = []

            counter_items = sorted(self._counter_values.items(), key=self._sort_metric_key)
            gauge_items = sorted(self._gauge_values.items(), key=self._sort_metric_key)
            hist_sum_items = sorted(self._hist_sum.items(), key=self._sort_metric_key)
            hist_count_items = sorted(self._hist_count.items(), key=self._sort_metric_key)
            metric_help = dict(self._metric_help)

        for metric_name in self._ordered_metric_names(counter_items, gauge_items, hist_sum_items):
            if metric_name in metric_help:
                lines.append(f"# HELP {metric_name} {metric_help[metric_name]}")
            metric_type = self._metric_type_for_name(metric_name, gauge_items)
            lines.append(f"# TYPE {metric_name} {metric_type}")

        for (name, labels), value in counter_items:
            lines.append(f"{name}{self._format_labels(labels)} {value:.6f}")

        for (name, labels), value in gauge_items:
            lines.append(f"{name}{self._format_labels(labels)} {value:.6f}")

        for (name, labels), value in hist_sum_items:
            lines.append(f"{name}_sum{self._format_labels(labels)} {value:.6f}")

        for (name, labels), value in hist_count_items:
            lines.append(f"{name}_count{self._format_labels(labels)} {value}")

        return "\n".join(lines) + "\n"

    def _fetch_annotation_by_idempotency(
        self,
        idempotency_key: str,
    ) -> IncidentAnnotationSnapshot | None:
        cursor = self._connection.execute(
            "SELECT * FROM incident_annotations WHERE idempotency_key = ?",
            (idempotency_key,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return self._row_to_annotation(row)

    def _row_to_annotation(self, row: sqlite3.Row) -> IncidentAnnotationSnapshot:
        return IncidentAnnotationSnapshot(
            id=row["id"],
            source=row["source"],
            severity=IncidentSeverity(row["severity"]),
            note=row["note"],
            linked_entity=row["linked_entity"],
            failure_class=(
                IncidentFailureClass(row["failure_class"]) if row["failure_class"] else None
            ),
            correlation_id=row["correlation_id"],
            remediation_status=IncidentRemediationStatus(
                row["remediation_status"] or IncidentRemediationStatus.OPEN.value
            ),
            remediation_owner=row["remediation_owner"],
            remediation_link=row["remediation_link"],
            audit_event_id=row["audit_event_id"],
            created_at=self._parse_dt(row["created_at"]),
        )

    def _derive_annotation_idempotency_key(self, payload: IncidentAnnotationRequest) -> str:
        stable_payload = {
            "source": payload.source,
            "severity": payload.severity.value,
            "note": payload.note,
            "linked_entity": payload.linked_entity,
            "failure_class": payload.failure_class.value if payload.failure_class else None,
            "correlation_id": payload.correlation_id,
            "audit_event_id": payload.audit_event_id,
            "remediation_link": payload.remediation_link,
        }
        digest = hashlib.sha256(
            json.dumps(stable_payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()
        return f"incident:auto:{digest}"

    def _ensure_incident_annotation_schema(self) -> None:
        with self._connection:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS incident_annotations (
                  id TEXT PRIMARY KEY,
                  source TEXT,
                  severity TEXT,
                  note TEXT,
                  linked_entity TEXT,
                  failure_class TEXT,
                  correlation_id TEXT,
                  remediation_status TEXT,
                  remediation_owner TEXT,
                  remediation_link TEXT,
                  audit_event_id TEXT,
                  idempotency_key TEXT UNIQUE,
                  created_at TEXT
                )
                """
            )

        existing_columns = {
            row["name"]
            for row in self._connection.execute("PRAGMA table_info(incident_annotations)").fetchall()
        }
        for column_name in (
            "failure_class",
            "correlation_id",
            "remediation_status",
            "remediation_owner",
            "remediation_link",
            "audit_event_id",
        ):
            if column_name in existing_columns:
                continue
            with self._connection:
                self._connection.execute(
                    f"ALTER TABLE incident_annotations ADD COLUMN {column_name} TEXT"
                )

    def _metric_key(self, name: str, labels: Labels | None) -> MetricKey:
        normalized_labels = tuple(sorted((labels or {}).items()))
        return name, normalized_labels

    def _sort_metric_key(self, item: tuple[MetricKey, float | int]) -> tuple[str, str]:
        (name, labels), _ = item
        return name, str(labels)

    def _ordered_metric_names(
        self,
        counter_items: list[tuple[MetricKey, float]],
        gauge_items: list[tuple[MetricKey, float]],
        hist_sum_items: list[tuple[MetricKey, float]],
    ) -> list[str]:
        names = {
            name
            for (name, _), _ in [*counter_items, *gauge_items, *hist_sum_items]
        }
        return sorted(names)

    def _metric_type_for_name(
        self,
        metric_name: str,
        gauge_items: list[tuple[MetricKey, float]],
    ) -> str:
        for (name, _labels), _value in gauge_items:
            if name == metric_name:
                return "gauge"
        return "counter"

    def _format_labels(self, labels: tuple[tuple[str, str], ...]) -> str:
        if not labels:
            return ""
        values = [
            f'{key}="{self._escape_label_value(value)}"'
            for key, value in labels
        ]
        return "{" + ",".join(values) + "}"

    def _escape_label_value(self, value: str) -> str:
        escaped = value.replace("\\", "\\\\")
        escaped = escaped.replace('"', '\\"')
        return escaped.replace("\n", "\\n")

    @staticmethod
    def _dt(value: datetime) -> str:
        return value.astimezone(UTC).isoformat()

    @staticmethod
    def _parse_dt(value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed
