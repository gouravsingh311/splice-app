"""Helpers for deterministic QC request idempotency."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any


def _normalize_json_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _normalize_json_value(value[key]) for key in sorted(value)}

    if isinstance(value, list):
        return [_normalize_json_value(item) for item in value]

    if isinstance(value, tuple):
        return [_normalize_json_value(item) for item in value]

    return value


def canonical_request_hash(payload: Any) -> str:
    """Return a stable SHA-256 hash for a request payload."""

    if hasattr(payload, "model_dump"):
        payload = payload.model_dump(mode="json")

    normalized = _normalize_json_value(payload)
    encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
