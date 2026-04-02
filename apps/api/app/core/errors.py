"""Domain-level errors for PRD-07/09 lifecycle and orchestration flows."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class DomainError(Exception):
    """Structured error used across state machine and orchestrator services."""

    code: str
    message: str
    status_code: int = 400
    details: Mapping[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message
