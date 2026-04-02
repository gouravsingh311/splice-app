from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from threading import Lock
from typing import Any

from app.core.db.session import get_connection
from app.core.errors import DomainError
from app.core.logging import get_logger
from app.features.audit.service import AuditEventStore
from app.features.notifications.service import NotificationService
from app.features.review.contracts import (
    ReviewActorRole,
    ReviewDecisionItem,
    ReviewErrorCode,
    ReviewFlagItem,
    ReviewQueueItem,
    ReviewSubmissionDetailResponse,
    ReviewSubmissionRequest,
    ReviewTagItem,
)
from app.features.submissions.contracts import SubmissionState
from app.features.submissions.service import SubmissionWorkflowService

logger = get_logger(__name__)


class ReviewBaseMixin:
    """Core persistence and state management for ReviewConsoleService."""

    def __init__(
        self,
        *,
        workflow: SubmissionWorkflowService,
        audit: AuditEventStore,
        notification_service: NotificationService | None = None,
        connection: sqlite3.Connection | None = None,
    ) -> None:
        self.workflow = workflow
        self.audit = audit
        self.notification_service = notification_service
        self._connection = connection or get_connection()
        self._lock = Lock()
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        with self._connection:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS review_decisions (
                  id TEXT PRIMARY KEY,
                  submission_id TEXT NOT NULL,
                  reviewer_id TEXT NOT NULL,
                  decision TEXT NOT NULL,
                  reason_code TEXT,
                  notes TEXT,
                  created_at TEXT NOT NULL
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS review_tags (
                  submission_id TEXT NOT NULL,
                  tag TEXT NOT NULL,
                  added_by TEXT,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY (submission_id, tag)
                )
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS review_flags (
                  submission_id TEXT NOT NULL,
                  flag_type TEXT NOT NULL,
                  severity TEXT NOT NULL,
                  added_by TEXT,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY (submission_id, flag_type)
                )
                """
            )
        self._ensure_review_decision_schema()
        self._migrate_legacy_qc_summary_findings()

    def _ensure_review_decision_schema(self) -> None:
        columns = self._table_columns("review_decisions")
        if not columns:
            return

        with self._connection:
            if "reviewer_id" not in columns and "actor_id" in columns:
                self._connection.execute(
                    "ALTER TABLE review_decisions ADD COLUMN reviewer_id TEXT"
                )
                self._connection.execute(
                    """
                    UPDATE review_decisions
                    SET reviewer_id = actor_id
                    WHERE reviewer_id IS NULL AND actor_id IS NOT NULL
                    """
                )
                columns.add("reviewer_id")
            if "decision" not in columns and "decision_type" in columns:
                self._connection.execute(
                    "ALTER TABLE review_decisions ADD COLUMN decision TEXT"
                )
                self._connection.execute(
                    """
                    UPDATE review_decisions
                    SET decision = decision_type
                    WHERE decision IS NULL AND decision_type IS NOT NULL
                    """
                )
                columns.add("decision")
            if "reason_code" not in columns:
                self._connection.execute(
                    "ALTER TABLE review_decisions ADD COLUMN reason_code TEXT"
                )
                columns.add("reason_code")
            if "notes" not in columns:
                self._connection.execute(
                    "ALTER TABLE review_decisions ADD COLUMN notes TEXT"
                )
                columns.add("notes")

    def _table_columns(self, table_name: str) -> set[str]:
        cursor = self._connection.execute(f"PRAGMA table_info({table_name})")
        return {row[1] for row in cursor.fetchall()}

    def get_submission_detail(self, submission_id: str, payload: ReviewSubmissionRequest) -> ReviewSubmissionDetailResponse:
        self._assert_reviewer_access(payload.actor_id, payload.actor_role)
        row = self._submission_row(submission_id)
        if row is None:
            raise DomainError(
                code=ReviewErrorCode.REVIEW_INVALID_STATE,
                message=f"Submission {submission_id} not found.",
                status_code=404,
                details={"submission_id": submission_id},
            )
        self._assert_submission_scope(
            submission_id=submission_id,
            actor_id=payload.actor_id,
            actor_role=payload.actor_role,
            creator_id=row["creator_id"],
        )

        decisions = self._list_decisions(submission_id)
        tags = self._list_tags(submission_id)
        flags = self._list_flags(submission_id)
        metadata_bundle = self._submission_metadata_bundle(submission_id, row["metadata"])
        pack_name = self._pack_name_for_submission(submission_id, metadata_bundle=metadata_bundle)
        qc_findings = self._extract_qc_findings_raw(submission_id)

        queue_item = ReviewQueueItem(
            submission_id=submission_id,
            pack_name=pack_name,
            creator_id=row["creator_id"],
            submitted_at=self._from_iso(row["created_at"]),
            state=SubmissionState(row["current_state"]),
            age_days=self._age_days(row["created_at"]),
            tags=[t.tag for t in tags],
            flags=flags,
        )

        return ReviewSubmissionDetailResponse(
            submission=queue_item,
            metadata=metadata_bundle,
            qc_findings=qc_findings,
            transitions=[],
            integration_events=[],
            decisions=decisions,
            tags=tags,
            flags=flags,
        )

    def _submission_row(self, submission_id: str) -> sqlite3.Row | None:
        cursor = self._connection.execute(
            """
            SELECT s.*, m.metadata_json as metadata
            FROM submissions s
            LEFT JOIN submission_state_metadata m ON s.id = m.submission_id
            WHERE s.id = ?
            """,
            (submission_id,),
        )
        return cursor.fetchone()

    def _read_submission_metadata(self, submission_id: str) -> dict[str, Any]:
        row = self._connection.execute(
            "SELECT metadata_json FROM submission_state_metadata WHERE submission_id = ?",
            (submission_id,),
        ).fetchone()
        if row is None:
            return {}
        try:
            payload = json.loads(row["metadata_json"] or "{}")
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _list_decisions(self, submission_id: str) -> list[ReviewDecisionItem]:
        cursor = self._connection.execute(
            "SELECT * FROM review_decisions WHERE submission_id = ? ORDER BY created_at DESC",
            (submission_id,),
        )
        return [
            ReviewDecisionItem(
                id=row["id"],
                submission_id=row["submission_id"],
                reviewer_id=str(
                    row["reviewer_id"]
                    if "reviewer_id" in row.keys()
                    else row["actor_id"]
                ),
                decision=self._review_decision_value(row),
                reason_code=self._review_reason_code_value(row),
                notes=row["notes"],
                created_at=self._from_iso(row["created_at"]),
            )
            for row in cursor.fetchall()
        ]

    def _review_decision_value(self, row: sqlite3.Row):
        from app.features.review.contracts import ReviewDecisionType

        raw_value = row["decision"] if "decision" in row.keys() else row["decision_type"]
        return ReviewDecisionType(raw_value)

    def _review_reason_code_value(self, row: sqlite3.Row):
        from app.features.review.contracts import RejectReasonCode

        if "reason_code" not in row.keys():
            return None
        raw_value = row["reason_code"]
        return RejectReasonCode(raw_value) if raw_value else None


    def _list_tags(self, submission_id: str) -> list[ReviewTagItem]:
        cursor = self._connection.execute(
            "SELECT * FROM review_tags WHERE submission_id = ?",
            (submission_id,),
        )
        return [
            ReviewTagItem(
                id=f"tag:{row['submission_id']}:{row['tag']}",
                submission_id=row["submission_id"],
                tag=row["tag"],
                added_by=row["added_by"],
                created_at=self._from_iso(row["created_at"]),
            )
            for row in cursor.fetchall()
        ]

    def _list_flags(self, submission_id: str) -> list[ReviewFlagItem]:
        cursor = self._connection.execute(
            "SELECT * FROM review_flags WHERE submission_id = ?",
            (submission_id,),
        )
        return [
            ReviewFlagItem(
                id=f"flag:{row['submission_id']}:{row['flag_type']}",
                submission_id=row["submission_id"],
                flag_type=row["flag_type"],
                severity=row["severity"],
                added_by=row["added_by"],
                created_at=self._from_iso(row["created_at"]),
            )
            for row in cursor.fetchall()
        ]

    def _tag_lookup(self, submission_id: str) -> list[str]:
        cursor = self._connection.execute(
            "SELECT tag FROM review_tags WHERE submission_id = ?",
            (submission_id,),
        )
        return [row["tag"] for row in cursor.fetchall()]

    def _flag_lookup_objs(self, submission_id: str) -> list[ReviewFlagItem]:
        return self._list_flags(submission_id)

    def _pack_name_for_submission(
        self,
        submission_id: str,
        *,
        metadata_bundle: dict[str, Any] | None = None,
    ) -> str:
        metadata = metadata_bundle or self._submission_metadata_bundle(submission_id)
        pack_name = str(metadata.get("pack_name") or "").strip()
        if pack_name:
            return pack_name
        return "Unknown Pack"

    def _submission_metadata_bundle(
        self,
        submission_id: str,
        state_metadata_json: str | None = None,
    ) -> dict[str, Any]:
        if state_metadata_json is not None:
            try:
                state_metadata = json.loads(state_metadata_json or "{}")
            except Exception:
                state_metadata = {}
        else:
            state_metadata = self._read_submission_metadata(submission_id)
        if not isinstance(state_metadata, dict):
            state_metadata = {}
        creator_meta_row = self._connection.execute(
            """
            SELECT pack_name, label_name, release_month
            FROM submission_metadata
            WHERE submission_id = ?
            LIMIT 1
            """,
            (submission_id,),
        ).fetchone()
        if creator_meta_row is None:
            return dict(state_metadata)
        merged_metadata = dict(state_metadata)
        pack_name = str(creator_meta_row["pack_name"] or "").strip()
        label_name = str(creator_meta_row["label_name"] or "").strip()
        release_month = str(creator_meta_row["release_month"] or "").strip()
        if not merged_metadata.get("pack_name") and pack_name:
            merged_metadata["pack_name"] = pack_name
        if not merged_metadata.get("label_name") and label_name:
            merged_metadata["label_name"] = label_name
        if not merged_metadata.get("preferred_release_month") and release_month:
            merged_metadata["preferred_release_month"] = release_month
        return merged_metadata

    def ensure_submission_transition_metadata(self, submission_id: str) -> dict[str, Any]:
        metadata = self._submission_metadata_bundle(submission_id)
        now = self._now()
        with self._connection:
            self._connection.execute(
                """
                INSERT INTO submission_state_metadata (
                    submission_id,
                    metadata_json,
                    created_at,
                    updated_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(submission_id) DO UPDATE SET
                  metadata_json = excluded.metadata_json,
                  updated_at = excluded.updated_at
                """,
                (
                    submission_id,
                    json.dumps(metadata),
                    now.isoformat(),
                    now.isoformat(),
                ),
            )
        return metadata


    def _extract_qc_findings_raw(self, submission_id: str) -> list[dict[str, Any]]:
        report_row = self._connection.execute(
            """
            SELECT report_id
            FROM qc_reports
            WHERE submission_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (submission_id,),
        ).fetchone()
        if report_row is None:
            return []
        report_id = str(report_row["report_id"])
        finding_rows = self._connection.execute(
            """
            SELECT rule_id, severity, blocking, status, message, remediation, context_json
            FROM qc_findings
            WHERE report_id = ?
            ORDER BY finding_id ASC
            """,
            (report_id,),
        ).fetchall()
        findings: list[dict[str, Any]] = []
        for row in finding_rows:
            context_value: Any = {}
            raw_context = row["context_json"]
            if raw_context:
                try:
                    context_value = json.loads(raw_context)
                except Exception:
                    context_value = {"raw_context": str(raw_context)}
            findings.append(
                {
                    "rule_id": row["rule_id"],
                    "severity": row["severity"],
                    "blocking": bool(row["blocking"]),
                    "status": row["status"],
                    "message": row["message"],
                    "remediation": row["remediation"],
                    "context": context_value,
                }
            )
        return findings

    def _migrate_legacy_qc_summary_findings(self) -> None:
        if not self._table_columns("qc_reports") or not self._table_columns("qc_findings"):
            return
        rows = self._connection.execute(
            """
            SELECT report_id, summary_json
            FROM qc_reports
            ORDER BY created_at ASC
            """
        ).fetchall()
        migrated_rows = 0
        with self._connection:
            for row in rows:
                report_id = str(row["report_id"])
                existing = self._connection.execute(
                    "SELECT COUNT(1) AS count FROM qc_findings WHERE report_id = ?",
                    (report_id,),
                ).fetchone()
                if existing is not None and int(existing["count"] or 0) > 0:
                    continue
                try:
                    parsed_summary = json.loads(row["summary_json"] or "[]")
                except Exception:
                    continue
                if not isinstance(parsed_summary, list):
                    continue
                for index, finding in enumerate(parsed_summary):
                    if not isinstance(finding, dict):
                        continue
                    rule_id = str(
                        finding.get("rule_id")
                        or finding.get("ruleId")
                        or finding.get("event_name")
                        or f"legacy_qc_finding_{index + 1}"
                    )
                    severity = str(finding.get("severity") or "warning").strip().lower()
                    is_blocking = bool(finding.get("blocking") or severity == "blocking")
                    status = str(finding.get("status") or "legacy").strip() or "legacy"
                    message = str(finding.get("message") or "Legacy QC finding migrated from report summary.").strip()
                    remediation = str(finding.get("remediation") or "").strip() or None
                    context_payload = finding.get("context")
                    context_json = json.dumps(context_payload) if isinstance(context_payload, (dict, list)) else None
                    self._connection.execute(
                        """
                        INSERT OR IGNORE INTO qc_findings (
                            finding_id, report_id, rule_id, severity, blocking, status, message, remediation, context_json
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            f"legacy:{report_id}:{index + 1}",
                            report_id,
                            rule_id,
                            severity,
                            1 if is_blocking else 0,
                            status,
                            message,
                            remediation,
                            context_json,
                        ),
                    )
                    migrated_rows += 1
        if migrated_rows > 0:
            logger.info(
                "Migrated legacy QC summary findings into qc_findings table.",
                extra={"migrated_findings_count": migrated_rows},
            )


    def _assert_reviewer_access(self, actor_id: str, role: ReviewActorRole) -> None:
        if role not in {ReviewActorRole.REVIEWER, ReviewActorRole.ADMIN}:
            self._raise_forbidden_access(
                actor_id=actor_id,
                actor_role=role,
                message="Only reviewers/admins can access the review console.",
            )

    def _assert_submission_scope(
        self,
        *,
        submission_id: str,
        actor_id: str,
        actor_role: ReviewActorRole,
        creator_id: str,
    ) -> None:
        if actor_role == ReviewActorRole.ADMIN:
            return
        if actor_id == creator_id:
            self._raise_forbidden_access(
                actor_id=actor_id,
                actor_role=actor_role,
                submission_id=submission_id,
                creator_id=creator_id,
                message="Reviewers cannot access submissions they created.",
            )

    def _queue_item_in_scope(self, *, actor_id: str, actor_role: ReviewActorRole, creator_id: str) -> bool:
        if actor_role == ReviewActorRole.ADMIN:
            return True
        return actor_id != creator_id

    def _raise_forbidden_access(
        self,
        *,
        actor_id: str,
        actor_role: ReviewActorRole,
        submission_id: str | None = None,
        creator_id: str | None = None,
        message: str,
    ) -> None:
        details: dict[str, Any] = {
            "actor_id": actor_id,
            "actor_role": actor_role.value,
        }
        if submission_id is not None:
            details["submission_id"] = submission_id
        if creator_id is not None:
            details["creator_id"] = creator_id
        logger.warning("Review access denied.", extra=details)
        raise DomainError(
            code=ReviewErrorCode.REVIEW_FORBIDDEN,
            message=message,
            status_code=403,
            details=details,
        )

    @staticmethod
    def _now() -> datetime:
        return datetime.now(tz=UTC)

    @staticmethod
    def _from_iso(value: str) -> datetime:
        return datetime.fromisoformat(value)

    @staticmethod
    def _age_days(created_at: str) -> int:
        dt = datetime.fromisoformat(created_at)
        delta = datetime.now(tz=UTC) - dt
        return max(0, delta.days)
