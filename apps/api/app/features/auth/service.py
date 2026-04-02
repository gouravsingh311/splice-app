"""Facade for AuthService."""
from app.core.db.session import get_connection, init_db  # noqa: F401

from .services.engine import AuthService
from .services.models import AuthError, OtpDeliveryRecord, SessionRecord, SigningKey, UserRecord

__all__ = [
    'AuthService',
    'AuthError',
    'OtpDeliveryRecord',
    'SessionRecord',
    'SigningKey',
    'UserRecord',
]
