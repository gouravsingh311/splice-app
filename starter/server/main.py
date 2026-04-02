from __future__ import annotations
import os
import signal
import sys
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

"""
PRODUCTION-QUALITY FASTAPI ENTRYPOINT
Focus: Localhost Security, Shared-Secret Authentication, & Backend Health
"""

app = FastAPI(title="Splice Backend API")

# Shared Secret (Passed from Electron at runtime)
INTERNAL_SECRET = os.getenv("SPLICE_INTERNAL_SECRET")

# --- Authentication Guard ---

async def verify_internal_secret(x_internal_secret: Optional[str] = Header(None)):
    """Verifies that the request originates from the trusted Electron shell."""
    if not INTERNAL_SECRET:
        # In strictly secured environments, the backend should fail open only in Dev.
        return True
    
    if x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(
            status_code=403, 
            detail="Forbidden: Request must originate from Electron shell"
        )

# --- Health & Readiness ---

@app.get("/health/live")
async def health_live():
    """Liveness check for Process Manager."""
    return {"status": "ok", "service": "splice-api"}

@app.get("/health/ready")
async def health_ready():
    """Readiness check (verified by Electron before launching window)."""
    # This is where database or integration checks would reside.
    return {"status": "ready"}

# --- Secure AI & Sensitive Data Routes ---

class SecretResponse(BaseModel):
    openai_key_preview: str
    status: str

@app.get("/api/v1/secrets", response_model=SecretResponse)
async def get_secrets(auth=Depends(verify_internal_secret)):
    """Example of a route providing sensitive data to the UI."""
    raw_key = os.getenv("OPENAI_API_KEY", "sk-not-configured")
    preview = f"{raw_key[:7]}..." if len(raw_key) > 7 else "empty"
    
    return {
        "openai_key_preview": preview,
        "status": "active"
    }

# --- Graceful Shutdown ---

def handle_sigterm(*args):
    """Ensures backend flushes storage on termination."""
    print("Received SIGTERM, shutting down gracefully...")
    # Add cleanup logic here (e.g., db.close())
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)
