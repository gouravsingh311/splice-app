"""Facade for BackgroundJobQueueService."""
from app.core.db.session import get_connection  # noqa: F401

from .services.base import JobHandler
from .services.engine import BackgroundJobQueueService
from .services.integrations import register_integration_job_handlers
from .services.worker import BackgroundExecutor

__all__ = [
    "BackgroundJobQueueService",
    "BackgroundExecutor",
    "register_integration_job_handlers",
    "JobHandler",
]
