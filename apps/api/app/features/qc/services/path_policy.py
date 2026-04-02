"""Path validation for QC pack inspection paths."""

from __future__ import annotations

from pathlib import Path

from app.core.errors import DomainError
from app.features.qc.contracts import QcErrorCode


def resolve_local_pack_path(raw_path: str | None) -> Path | None:
    """Resolve a local pack path for creator QC runs."""

    normalized = str(raw_path or "").strip()
    if not normalized:
        return None

    candidate = Path(normalized).expanduser()
    if not candidate.is_absolute():
        raise DomainError(
            code=QcErrorCode.QC_EVALUATION_NOT_ALLOWED,
            message="local_pack_path must be an absolute path.",
            status_code=403,
            details={"local_pack_path": raw_path, "reason": "path_must_be_absolute"},
        )

    try:
        resolved_candidate = candidate.resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        raise DomainError(
            code=QcErrorCode.QC_EVALUATION_NOT_ALLOWED,
            message="local_pack_path does not reference an accessible pack directory.",
            status_code=403,
            details={"local_pack_path": raw_path, "reason": "path_missing_or_unreadable"},
        ) from exc

    if not resolved_candidate.is_dir():
        raise DomainError(
            code=QcErrorCode.QC_EVALUATION_NOT_ALLOWED,
            message="local_pack_path must reference an existing directory.",
            status_code=403,
            details={"local_pack_path": raw_path, "reason": "path_not_directory"},
        )

    return resolved_candidate
