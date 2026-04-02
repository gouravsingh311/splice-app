"""Facade for IntakeStorageService."""
from app.core.db.session import get_connection  # noqa: F401

from .engine import IntakeStorageService

__all__ = ['IntakeStorageService']
