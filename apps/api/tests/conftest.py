from __future__ import annotations

import os
import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

os.environ.setdefault("SPLICE_AUTH_ACCESS_SECRET", "test-auth-secret")
os.environ.setdefault("SPLICE_INTERNAL_API_TOKEN", "test-internal-token")


@pytest.fixture(autouse=True)
def patch_required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPLICE_AUTH_ACCESS_SECRET", "test-auth-secret")
    monkeypatch.setenv("SPLICE_INTERNAL_API_TOKEN", "test-internal-token")


@pytest.fixture
def in_memory_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA foreign_keys=ON;")

    schema_path = Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    connection.executescript(schema_path.read_text(encoding="utf-8"))

    created_at = datetime(2026, 2, 27, tzinfo=UTC).isoformat()
    connection.executemany(
        """
        INSERT INTO submissions (
            id, creator_id, current_state, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            ("sub-100", "creator-1", "under_review", 1, created_at, created_at),
            ("sub-101", "creator-1", "approved", 1, created_at, created_at),
            ("sub-102", "reviewer-1", "rejected", 1, created_at, created_at),
        ],
    )
    connection.executemany(
        """
        INSERT INTO notifications (
            notification_id, type, severity, status, channel, title, message,
            submission_id, recipient_email, read, read_at, attempts, max_attempts,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "ntf-1",
                "qc_failed",
                "warning",
                "sent",
                "in_app",
                "QC requires fixes",
                "Resolve blocking QC findings before review handoff.",
                "sub-100",
                None,
                0,
                None,
                1,
                3,
                created_at,
                created_at,
            ),
            (
                "ntf-2",
                "approved",
                "info",
                "sent",
                "email",
                "Submission approved",
                "Your submission is approved and queued for scheduling.",
                "sub-101",
                "approved@splice.local",
                1,
                created_at,
                1,
                3,
                created_at,
                created_at,
            ),
            (
                "ntf-3",
                "rejected",
                "error",
                "failed",
                "email",
                "Dispatch failed",
                "Email delivery failed. Retry dispatch after checking provider status.",
                "sub-102",
                "app-tester@splice.local",
                0,
                None,
                3,
                5,
                created_at,
                created_at,
            ),
        ],
    )
    connection.commit()
    yield connection
    connection.close()


@pytest.fixture(autouse=True)
def patch_sqlite_connections(
    monkeypatch: pytest.MonkeyPatch,
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    import app.core.db.session as db_module
    import app.features.audit.service as audit_service_module
    import app.features.auth.services.base as auth_base_module
    import app.features.auth.services.engine as auth_engine_module
    import app.features.jobs.services.base as jobs_base_module
    import app.features.notifications.service as notification_service_module
    import app.features.qc.rules.registry as qc_rules_registry_module
    import app.features.qc.services.engine as qc_engine_module
    import app.features.review.services.base as review_base_module
    import app.features.submissions.storage.engine as storage_engine_module

    monkeypatch.setattr(db_module, "get_connection", lambda db_path=None: in_memory_db_connection)
    monkeypatch.setattr(db_module, "init_db", lambda db_path=None: None)

    for db_consumer in [
        audit_service_module,
        auth_base_module,
        auth_engine_module,
        jobs_base_module,
        notification_service_module,
        qc_engine_module,
        qc_rules_registry_module,
        review_base_module,
        storage_engine_module,
    ]:

        if hasattr(db_consumer, "get_connection"):
            monkeypatch.setattr(
                db_consumer, "get_connection", lambda db_path=None: in_memory_db_connection
            )
        if hasattr(db_consumer, "init_db"):
            monkeypatch.setattr(db_consumer, "init_db", lambda db_path=None: None)

@pytest.fixture(autouse=True)
def patch_main_workflow_db(
    monkeypatch: pytest.MonkeyPatch,
    in_memory_db_connection: sqlite3.Connection,
) -> None:
    main_module = sys.modules.get("app.main")
    if main_module is None:
        return

    class TestSubmissionWorkflowService(main_module.SubmissionWorkflowService):
        def __init__(self, *args, **kwargs) -> None:
            kwargs.setdefault("connection", in_memory_db_connection)
            super().__init__(*args, **kwargs)

    class TestObservabilityService(main_module.ObservabilityService):
        def __init__(self, *args, **kwargs) -> None:
            kwargs.setdefault("connection", in_memory_db_connection)
            super().__init__(*args, **kwargs)

    class TestBackgroundJobQueueService(main_module.BackgroundJobQueueService):
        def __init__(self, *args, **kwargs) -> None:
            kwargs.setdefault("connection", in_memory_db_connection)
            kwargs.setdefault("start_executor", False)
            super().__init__(*args, **kwargs)

    class TestReleaseSchedulerService(main_module.ReleaseSchedulerService):
        def __init__(self, *args, **kwargs) -> None:
            kwargs.setdefault("connection", in_memory_db_connection)
            super().__init__(*args, **kwargs)

    class TestAdminConfigService(main_module.AdminConfigService):
        def __init__(self, *args, **kwargs) -> None:
            kwargs.setdefault("connection", in_memory_db_connection)
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(main_module, "SubmissionWorkflowService", TestSubmissionWorkflowService)
    monkeypatch.setattr(main_module, "ObservabilityService", TestObservabilityService)
    monkeypatch.setattr(main_module, "BackgroundJobQueueService", TestBackgroundJobQueueService)
    monkeypatch.setattr(main_module, "ReleaseSchedulerService", TestReleaseSchedulerService)
    monkeypatch.setattr(main_module, "AdminConfigService", TestAdminConfigService)
