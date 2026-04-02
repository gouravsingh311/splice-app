"""SQLite connection and schema initialization helpers."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from app.core.logging import get_logger

DEFAULT_DB_PATH = "./data/splice.db"
_SCHEMA_PATH = Path(__file__).with_name("schema.sql")
logger = get_logger(__name__)


def _resolve_db_path(db_path: str | None = None) -> str:
    return db_path or os.environ.get("SPLICE_DB_PATH", DEFAULT_DB_PATH)


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    """Return a configured SQLite connection for the requested database path."""
    resolved_path = _resolve_db_path(db_path)
    if resolved_path != ":memory:":
        path = Path(resolved_path)
        path.parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(resolved_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA foreign_keys=ON;")
    logger.debug("Opened SQLite connection.", extra={"db_path": resolved_path})
    return connection


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        (table_name,),
    ).fetchone()
    return row is not None


def _column_exists(connection: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(str(row["name"]) == column_name for row in rows)


def _apply_compatibility_migrations(connection: sqlite3.Connection) -> None:
    # Backfill idempotency hash columns for legacy local SQLite files.
    for table_name in ("qc_evaluation_idempotency", "qc_policy_idempotency"):
        if not _table_exists(connection, table_name):
            continue
        if _column_exists(connection, table_name, "request_hash"):
            continue
        connection.execute(
            f"ALTER TABLE {table_name} ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''"
        )
        logger.info(
            "Applied SQLite compatibility migration.",
            extra={"table": table_name, "column": "request_hash"},
        )


def init_db(db_path: str | None = None) -> None:
    """Initialize the SQLite schema if it does not already exist."""
    schema_sql = _SCHEMA_PATH.read_text(encoding="utf-8")
    with get_connection(db_path=db_path) as connection:
        connection.executescript(schema_sql)
        _apply_compatibility_migrations(connection)
    logger.info("Initialized SQLite schema.", extra={"db_path": _resolve_db_path(db_path)})
