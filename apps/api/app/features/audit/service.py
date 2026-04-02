"""SQLite-backed append-only audit store for PRD-11 Wave 5."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from datetime import UTC, datetime
from threading import Lock
from typing import Any
from uuid import UUID, uuid4

from app.core.db.session import get_connection

from .contracts import (
    AUDIT_SCHEMA_VERSION,
    AuditAppendRequest,
    AuditEntityType,
    AuditEvent,
    AuditExportFormat,
    AuditExportResponse,
    AuditExportSignatureAlgorithm,
    AuditListResponse,
)

AUDIT_HASH_NAMESPACE = "fileeaters.audit.v1"
AUDIT_EXPORT_SIGNATURE_NAMESPACE = "fileeaters.audit.export.v1"


class AuditEventNotFoundError(KeyError):
    """Raised when an audit event is not found by id."""


class AuditHashChainError(ValueError):
    """Raised when a persisted audit hash chain is tampered with."""


def _stable_json(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)


def _compute_event_hash(payload: dict[str, Any], prev_hash: str | None) -> str:
    digest = hashlib.sha256()
    digest.update(AUDIT_HASH_NAMESPACE.encode("utf-8"))
    digest.update(b"|")
    digest.update((prev_hash or "GENESIS").encode("utf-8"))
    digest.update(b"|")
    digest.update(_stable_json(payload).encode("utf-8"))
    return digest.hexdigest()


def _build_event_hash_payload(
    *,
    event_id: UUID,
    schema_version: int,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str,
    before_json: dict[str, Any] | None,
    after_json: dict[str, Any] | None,
    metadata: dict[str, Any] | None,
    occurred_at: datetime | None,
    request_id: str | None,
    idempotency_key: str | None,
    created_at: datetime,
) -> dict[str, Any]:
    return {
        "id": str(event_id),
        "schema_version": schema_version,
        "actor_id": actor_id,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "before_json": before_json,
        "after_json": after_json,
        "metadata": metadata,
        "occurred_at": _to_iso(occurred_at),
        "request_id": request_id,
        "idempotency_key": idempotency_key,
        "created_at": created_at.isoformat(),
    }


def _compute_export_signature(content: str, signed_at: datetime) -> str:
    digest = hashlib.sha256()
    digest.update(AUDIT_EXPORT_SIGNATURE_NAMESPACE.encode("utf-8"))
    digest.update(b"|")
    digest.update(_to_utc_datetime(signed_at).isoformat().encode("utf-8"))
    digest.update(b"|")
    digest.update(content.encode("utf-8"))
    return digest.hexdigest()


def _to_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _to_iso(value: datetime | None) -> str | None:
    normalized = _to_utc_datetime(value)
    return normalized.isoformat() if normalized else None


def _from_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return _to_utc_datetime(parsed)


def _deterministic_export_timestamp(
    *,
    events: list[AuditEvent],
    from_timestamp: datetime | None,
    to_timestamp: datetime | None,
) -> datetime:
    if events:
        return events[-1].created_at

    if to_timestamp is not None:
        return _to_utc_datetime(to_timestamp)

    if from_timestamp is not None:
        return _to_utc_datetime(from_timestamp)

    return datetime(1970, 1, 1, tzinfo=UTC)


def _format_csv_field(value: Any) -> str:
    if value is None:
        raw_value = ""
    elif isinstance(value, (dict, list)):
        raw_value = _stable_json(value)
    elif isinstance(value, datetime):
        raw_value = value.astimezone(UTC).isoformat()
    else:
        raw_value = str(value)
    escaped = raw_value.replace('"', '""')
    return f'"{escaped}"'


def validate_event_hash_chain(events: Sequence[AuditEvent]) -> None:
    """Raise if any event hash or linkage in the chain is invalid."""

    previous_hash: str | None = None
    for index, event in enumerate(events):
        if event.prev_hash != previous_hash:
            raise AuditHashChainError(
                "audit hash chain linkage mismatch at index "
                f"{index}: expected prev_hash {previous_hash!r}, got {event.prev_hash!r}"
            )

        expected_hash = _compute_event_hash(
            _build_event_hash_payload(
                event_id=event.id,
                schema_version=event.schema_version,
                actor_id=event.actor_id,
                action=event.action.value,
                entity_type=event.entity_type.value,
                entity_id=event.entity_id,
                before_json=event.before_json,
                after_json=event.after_json,
                metadata=event.metadata,
                occurred_at=event.occurred_at,
                request_id=event.request_id,
                idempotency_key=event.idempotency_key,
                created_at=event.created_at,
            ),
            event.prev_hash,
        )
        if event.event_hash != expected_hash:
            raise AuditHashChainError(
                "audit hash mismatch at index "
                f"{index}: expected {expected_hash}, got {event.event_hash}"
            )

        previous_hash = event.event_hash


class AuditEventStore:
    """Append-only, hash-chained audit event store backed by SQLite."""

    def __init__(self, now: callable | None = None) -> None:
        self._connection = get_connection()
        self._lock = Lock()
        self._now = now or (lambda: datetime.now(UTC))
        self._ensure_table()

    def _ensure_table(self) -> None:
        self._connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_events (
              id TEXT PRIMARY KEY,
              actor_id TEXT,
              action TEXT,
              entity_type TEXT,
              entity_id TEXT,
              before_json TEXT,
              after_json TEXT,
              metadata_json TEXT,
              request_id TEXT,
              idempotency_key TEXT UNIQUE,
              prev_hash TEXT,
              event_hash TEXT,
              created_at TEXT NOT NULL
            );
            """
        )
        self._connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at)"
        )
        self._connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_audit_events_lookup
            ON audit_events(actor_id, action, entity_type, entity_id, created_at)
            """
        )
        self._connection.commit()

    def _row_to_event(self, row) -> AuditEvent:
        metadata_bundle = json.loads(row["metadata_json"]) if row["metadata_json"] else {}
        metadata = metadata_bundle.get("metadata") if isinstance(metadata_bundle, dict) else None
        occurred_at = None
        schema_version = AUDIT_SCHEMA_VERSION
        if isinstance(metadata_bundle, dict):
            occurred_at = _from_iso(metadata_bundle.get("_occurred_at"))
            schema_version = int(metadata_bundle.get("_schema_version", AUDIT_SCHEMA_VERSION))

        return AuditEvent(
            id=UUID(row["id"]),
            schema_version=schema_version,
            actor_id=row["actor_id"],
            action=row["action"],
            entity_type=row["entity_type"],
            entity_id=row["entity_id"],
            before_json=json.loads(row["before_json"]) if row["before_json"] else None,
            after_json=json.loads(row["after_json"]) if row["after_json"] else None,
            metadata=metadata,
            occurred_at=occurred_at,
            request_id=row["request_id"],
            idempotency_key=row["idempotency_key"],
            created_at=_from_iso(row["created_at"]),
            prev_hash=row["prev_hash"],
            event_hash=row["event_hash"],
        )

    def _get_last_event_hash(self) -> str | None:
        row = self._connection.execute(
            """
            SELECT event_hash
            FROM audit_events
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
        return row["event_hash"] if row else None

    def append_event(self, request: AuditAppendRequest) -> AuditEvent:
        with self._lock:
            if request.idempotency_key:
                existing = self._connection.execute(
                    """
                    SELECT id, actor_id, action, entity_type, entity_id,
                           before_json, after_json, metadata_json, request_id,
                           idempotency_key, prev_hash, event_hash, created_at
                    FROM audit_events
                    WHERE idempotency_key = ?
                    """,
                    (request.idempotency_key,),
                ).fetchone()
                if existing:
                    return self._row_to_event(existing)

            created_at = _to_utc_datetime(self._now())
            event_id = uuid4()
            prev_hash = self._get_last_event_hash()
            payload = _build_event_hash_payload(
                event_id=event_id,
                schema_version=request.schema_version,
                actor_id=request.actor_id,
                action=request.action.value,
                entity_type=request.entity_type.value,
                entity_id=request.entity_id,
                before_json=request.before_json,
                after_json=request.after_json,
                metadata=request.metadata,
                occurred_at=request.occurred_at,
                request_id=request.request_id,
                idempotency_key=request.idempotency_key,
                created_at=created_at,
            )
            event_hash = _compute_event_hash(payload, prev_hash)

            metadata_bundle = {
                "metadata": request.metadata,
                "_occurred_at": _to_iso(request.occurred_at),
                "_schema_version": request.schema_version,
            }

            self._connection.execute(
                """
                INSERT INTO audit_events (
                  id, actor_id, action, entity_type, entity_id,
                  before_json, after_json, metadata_json, request_id,
                  idempotency_key, prev_hash, event_hash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(event_id),
                    request.actor_id,
                    request.action.value,
                    request.entity_type.value,
                    request.entity_id,
                    _stable_json(request.before_json) if request.before_json is not None else None,
                    _stable_json(request.after_json) if request.after_json is not None else None,
                    _stable_json(metadata_bundle),
                    request.request_id,
                    request.idempotency_key,
                    prev_hash,
                    event_hash,
                    created_at.isoformat(),
                ),
            )
            self._connection.commit()

            row = self._connection.execute(
                """
                SELECT id, actor_id, action, entity_type, entity_id,
                       before_json, after_json, metadata_json, request_id,
                       idempotency_key, prev_hash, event_hash, created_at
                FROM audit_events
                WHERE id = ?
                """,
                (str(event_id),),
            ).fetchone()

            return self._row_to_event(row)

    def get_event(self, event_id: UUID) -> AuditEvent:
        row = self._connection.execute(
            """
            SELECT id, actor_id, action, entity_type, entity_id,
                   before_json, after_json, metadata_json, request_id,
                   idempotency_key, prev_hash, event_hash, created_at
            FROM audit_events
            WHERE id = ?
            """,
            (str(event_id),),
        ).fetchone()
        if not row:
            raise AuditEventNotFoundError(f"audit event not found: {event_id}")
        return self._row_to_event(row)

    def list_events(
        self,
        *,
        actor_id: str | None = None,
        action: str | None = None,
        entity_type: AuditEntityType | None = None,
        entity_id: str | None = None,
        from_timestamp: datetime | None = None,
        to_timestamp: datetime | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> AuditListResponse:
        clauses: list[str] = []
        params: list[object] = []

        if actor_id:
            clauses.append("actor_id = ?")
            params.append(actor_id)
        if action:
            clauses.append("action = ?")
            params.append(action)
        if entity_type:
            clauses.append("entity_type = ?")
            params.append(entity_type.value)
        if entity_id:
            clauses.append("entity_id = ?")
            params.append(entity_id)

        normalized_from = _to_iso(from_timestamp)
        normalized_to = _to_iso(to_timestamp)
        if normalized_from:
            clauses.append("created_at >= ?")
            params.append(normalized_from)
        if normalized_to:
            clauses.append("created_at <= ?")
            params.append(normalized_to)

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        total_row = self._connection.execute(
            f"SELECT COUNT(*) AS total FROM audit_events {where}",
            tuple(params),
        ).fetchone()
        total = int(total_row["total"])

        rows = self._connection.execute(
            f"""
            SELECT id, actor_id, action, entity_type, entity_id,
                   before_json, after_json, metadata_json, request_id,
                   idempotency_key, prev_hash, event_hash, created_at
            FROM audit_events
            {where}
            ORDER BY created_at ASC, id ASC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

        return AuditListResponse(
            events=[self._row_to_event(row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    def export_events(
        self,
        *,
        export_format: AuditExportFormat,
        include_hash_chain: bool,
        actor_id: str | None = None,
        action: str | None = None,
        entity_type: AuditEntityType | None = None,
        entity_id: str | None = None,
        from_timestamp: datetime | None = None,
        to_timestamp: datetime | None = None,
        limit: int = 5000,
    ) -> AuditExportResponse:
        listed = self.list_events(
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
            limit=limit,
            offset=0,
        )

        exported_at = _deterministic_export_timestamp(
            events=listed.events,
            from_timestamp=from_timestamp,
            to_timestamp=to_timestamp,
        )
        file_prefix = f"audit-events-{exported_at.strftime('%Y%m%dT%H%M%SZ')}"

        if export_format == AuditExportFormat.csv:
            headers = [
                "id",
                "created_at",
                "occurred_at",
                "schema_version",
                "actor_id",
                "action",
                "entity_type",
                "entity_id",
                "request_id",
                "idempotency_key",
                "before_json",
                "after_json",
                "metadata",
            ]
            if include_hash_chain:
                headers.extend(["prev_hash", "event_hash"])

            lines = [",".join(headers)]
            for event in listed.events:
                row = [
                    _format_csv_field(event.id),
                    _format_csv_field(event.created_at),
                    _format_csv_field(event.occurred_at),
                    _format_csv_field(event.schema_version),
                    _format_csv_field(event.actor_id),
                    _format_csv_field(event.action.value),
                    _format_csv_field(event.entity_type.value),
                    _format_csv_field(event.entity_id),
                    _format_csv_field(event.request_id),
                    _format_csv_field(event.idempotency_key),
                    _format_csv_field(event.before_json),
                    _format_csv_field(event.after_json),
                    _format_csv_field(event.metadata),
                ]
                if include_hash_chain:
                    row.extend([
                        _format_csv_field(event.prev_hash),
                        _format_csv_field(event.event_hash),
                    ])
                lines.append(",".join(row))

            content = "\n".join(lines)
            signed_at = exported_at
            return AuditExportResponse(
                format=AuditExportFormat.csv,
                mime_type="text/csv",
                file_name=f"{file_prefix}.csv",
                exported_at=exported_at,
                signed_at=signed_at,
                signature_algorithm=AuditExportSignatureAlgorithm.sha256,
                signature=_compute_export_signature(content, signed_at),
                total=listed.total,
                content=content,
            )

        export_payload = []
        for event in listed.events:
            item = event.model_dump(mode="json")
            if not include_hash_chain:
                item.pop("prev_hash", None)
                item.pop("event_hash", None)
            export_payload.append(item)

        content = json.dumps(
            {
                "exported_at": exported_at.isoformat(),
                "total": listed.total,
                "events": export_payload,
            },
            indent=2,
            sort_keys=True,
        )
        signed_at = exported_at

        return AuditExportResponse(
            format=AuditExportFormat.json,
            mime_type="application/json",
            file_name=f"{file_prefix}.json",
            exported_at=exported_at,
            signed_at=signed_at,
            signature_algorithm=AuditExportSignatureAlgorithm.sha256,
            signature=_compute_export_signature(content, signed_at),
            total=listed.total,
            content=content,
        )
