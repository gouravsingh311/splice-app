from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.features.audit.contracts import (
    AuditAction,
    AuditAppendRequest,
    AuditEntityType,
    AuditExportFormat,
)
from app.features.audit.service import (
    AuditEventStore,
    AuditHashChainError,
    validate_event_hash_chain,
)


def _append_event(
    store: AuditEventStore,
    *,
    idempotency_key: str,
    actor_id: str = "reviewer-1",
) -> None:
    store.append_event(
        AuditAppendRequest(
            actor_id=actor_id,
            action=AuditAction.desktop_ipc_denied,
            entity_type=AuditEntityType.desktop,
            entity_id="fileeaters.audit.security-events.list.v1",
            metadata={"reason": "ROLE_FORBIDDEN"},
            idempotency_key=idempotency_key,
        )
    )


def test_export_signature_is_deterministic_and_time_anchored() -> None:
    timestamps = iter(
        [
            datetime(2026, 3, 1, 0, 0, tzinfo=UTC),
            datetime(2026, 3, 2, 12, 30, tzinfo=UTC),
            datetime(2026, 3, 3, 9, 0, tzinfo=UTC),
            datetime(2026, 3, 3, 9, 0, tzinfo=UTC),
        ]
    )
    store = AuditEventStore(now=lambda: next(timestamps))
    _append_event(store, idempotency_key="export-signature-1")
    _append_event(store, idempotency_key="export-signature-2")

    first = store.export_events(
        export_format=AuditExportFormat.json,
        include_hash_chain=False,
        limit=10,
    )
    second = store.export_events(
        export_format=AuditExportFormat.json,
        include_hash_chain=False,
        limit=10,
    )

    assert first.exported_at == datetime(2026, 3, 2, 12, 30, tzinfo=UTC)
    assert first.signed_at == first.exported_at
    assert first.signature_algorithm == "sha256"
    assert len(first.signature) == 64
    assert first.content == second.content
    assert first.signature == second.signature
    assert second.signed_at == second.exported_at


def test_validate_event_hash_chain_detects_tampering() -> None:
    timestamps = iter(
        [
            datetime(2026, 3, 1, 0, 0, tzinfo=UTC),
            datetime(2026, 3, 1, 0, 1, tzinfo=UTC),
        ]
    )
    store = AuditEventStore(now=lambda: next(timestamps))
    _append_event(store, idempotency_key="tamper-1")
    _append_event(store, idempotency_key="tamper-2")

    first_event = store.list_events(limit=10, offset=0).events[0]
    store._connection.execute(
        "UPDATE audit_events SET event_hash = ? WHERE id = ?",
        ("tampered-hash", str(first_event.id)),
    )
    store._connection.commit()

    tampered_events = store.list_events(limit=10, offset=0).events

    with pytest.raises(AuditHashChainError, match="audit hash"):
        validate_event_hash_chain(tampered_events)
