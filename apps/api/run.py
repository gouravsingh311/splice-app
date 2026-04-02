"""PyInstaller entry point for the Splice API.

main.py defines `app = create_app()` but never calls uvicorn.run().
This file is the target for splice_api.spec so the bundled binary
boots a real uvicorn server on startup.

Usage (dev): python run.py
Usage (packaged): the splice_api binary calls this automatically.
"""

from __future__ import annotations

import os

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("SPLICE_API_HOST", "127.0.0.1")
    port = int(os.environ.get("SPLICE_API_PORT", "8000"))

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        log_level=os.environ.get("SPLICE_LOG_LEVEL", "info"),
        reload=False,
    )
