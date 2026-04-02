"""Structured logging utilities with correlation ID propagation and file persistence."""

from __future__ import annotations

import json
import logging
import os
from contextvars import ContextVar
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

_CORRELATION_ID: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_CONFIGURED = False
_DEFAULT_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"


class JsonLogFormatter(logging.Formatter):
    """Render log records as newline-delimited JSON for machine parsing."""

    _RESERVED_FIELDS = {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "message",
        "asctime",
        "taskName",
    }

    def __init__(self, *, service: str, environment: str) -> None:
        super().__init__()
        self._service = service
        self._environment = environment

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(tz=UTC).isoformat(),
            "level": record.levelname,
            "service": self._service,
            "environment": self._environment,
            "logger": record.name,
            "message": record.getMessage(),
            "correlation_id": get_correlation_id(),
        }

        for key, value in record.__dict__.items():
            if key in self._RESERVED_FIELDS or key.startswith("_"):
                continue
            payload[key] = value

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=True, default=str)


def configure_logging(*, service: str, environment: str) -> Path:
    """Configure root logging once for console + rotating file output."""
    global _CONFIGURED
    if _CONFIGURED:
        return _resolve_log_file_path()

    log_level = os.environ.get("SPLICE_LOG_LEVEL", "INFO").upper()
    log_dir = _resolve_log_file_path().parent
    log_dir.mkdir(parents=True, exist_ok=True)

    formatter = JsonLogFormatter(service=service, environment=environment)
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level, logging.INFO))
    root_logger.handlers.clear()

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    root_logger.addHandler(stream_handler)

    max_bytes = int(os.environ.get("SPLICE_LOG_FILE_MAX_BYTES", str(10 * 1024 * 1024)))
    backup_count = int(os.environ.get("SPLICE_LOG_FILE_BACKUP_COUNT", "5"))
    file_handler = RotatingFileHandler(
        _resolve_log_file_path(),
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)

    _CONFIGURED = True
    return _resolve_log_file_path()


def _resolve_log_file_path() -> Path:
    configured_dir = os.environ.get("SPLICE_LOG_DIR")
    log_dir = Path(configured_dir) if configured_dir else _DEFAULT_LOG_DIR
    log_file_name = os.environ.get("SPLICE_LOG_FILE_NAME", "splice-api.log")
    return log_dir / log_file_name


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def set_correlation_id(correlation_id: str) -> None:
    _CORRELATION_ID.set(correlation_id)


def get_correlation_id() -> str | None:
    return _CORRELATION_ID.get()


def clear_correlation_id() -> None:
    _CORRELATION_ID.set(None)
