"""Composite Admin service engine."""

from __future__ import annotations

from .config_logic import AdminConfigLogic
from .history_logic import AdminHistoryLogic
from .integration_logic import AdminIntegrationLogic


class AdminConfigService(AdminConfigLogic, AdminIntegrationLogic, AdminHistoryLogic):
    """
    PRD-14 Admin service engine.
    Unified facade for config CRUD, integration health, and ops history.
    """
    pass
