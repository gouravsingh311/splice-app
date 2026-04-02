"""conftest.py for AI feature tests — overrides the global autouse fixture that is stale."""

import pytest


@pytest.fixture(autouse=True)
def patch_main_workflow_db(monkeypatch):
    """No-op override — SubmissionWorkflowService was removed from app.main."""
    yield
