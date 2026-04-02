"""SQLite-backed PRD-03/12 intake, manifest, and Dropbox handoff service."""

from __future__ import annotations

import sqlite3

from app.core.db.session import get_connection

from .base import StorageBaseMixin
from .dropbox import DropboxTransferMixin
from .local import LocalWorkspaceMixin
from .manifest import ManifestMixin

DROPBOX_CHUNK_SIZE = 8 * 1024 * 1024
REQUIRED_PACK_FOLDER_ALIASES = frozenset(
    {
        "audio",
        "artwork",
        "coverart",
        "demo",
        "demos",
        "description",
        "descriptioninfo",
        "descriptionandinfo",
    }
)


class IntakeStorageService(LocalWorkspaceMixin, DropboxTransferMixin, ManifestMixin, StorageBaseMixin):
    def __init__(
        self,
        *,
        connection: sqlite3.Connection | None = None,
        job_queue_service: object | None = None,
    ) -> None:
        self._connection = connection or get_connection()
        self._job_queue_service = job_queue_service

    def reset(self) -> None:
        self._connection.execute("DELETE FROM asset_manifest")
        self._connection.execute("DELETE FROM upload_sessions")
