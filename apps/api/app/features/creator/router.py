"""FastAPI router for creator workspace features — combines profile and submission routes."""

from __future__ import annotations

from fastapi import APIRouter

from app.features.creator.profile_router import router as profile_router
from app.features.creator.submissions_router import router as submissions_router

router = APIRouter(tags=["creator-workspace"])
router.include_router(profile_router)
router.include_router(submissions_router)
