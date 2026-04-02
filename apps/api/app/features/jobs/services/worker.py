from __future__ import annotations

import sqlite3
from threading import Event, Thread
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .engine import BackgroundJobQueueService


class BackgroundExecutor:
    """Poll due jobs and dispatch registered handlers on a background thread."""

    def __init__(self, *, queue: BackgroundJobQueueService, poll_interval_seconds: int = 5) -> None:
        self._queue = queue
        self._poll_interval_seconds = poll_interval_seconds
        self._stop_event = Event()
        self._thread = Thread(target=self._run, name="splice-background-executor", daemon=True)

    def start(self) -> None:
        if self._thread.is_alive():
            return
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join(timeout=self._poll_interval_seconds + 1)

    def _run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._queue.execute_due_jobs()
            except sqlite3.ProgrammingError as exc:
                if "closed database" in str(exc).lower():
                    self._stop_event.set()
                    return
                raise
            self._stop_event.wait(self._poll_interval_seconds)
