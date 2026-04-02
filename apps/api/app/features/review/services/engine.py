from __future__ import annotations

from .decision import ReviewDecisionMixin
from .queue import ReviewQueueMixin


class ReviewConsoleService(ReviewQueueMixin, ReviewDecisionMixin):
    """Service for review queue reads and reviewer decision actions."""
    pass
