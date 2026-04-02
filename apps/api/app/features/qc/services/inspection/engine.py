from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from app.core.errors import DomainError
from app.features.qc.contracts import QcActorRole, QcErrorCode, QcEvaluationRequest

from ..path_policy import resolve_local_pack_path
from .base import (
    ARTWORK_FOLDER_ALIASES,
    AUDIO_FOLDER_ALIASES,
    DEMO_FOLDER_ALIASES,
    DESCRIPTION_FOLDER_ALIASES,
    LABEL_PACK_NAME_PATTERN,
    MAX_AUDIO_ZIP_SIZE_BYTES,
    MAX_SAMPLE_COUNT,
    MIN_AUDIO_ZIP_SIZE_BYTES,
)
from .media import InspectionMediaMixin


class QcInspectionMixin(InspectionMediaMixin):
    """Orchestration of pack-level QC inspection."""

    def _inspect_pack(
        self,
        request: QcEvaluationRequest,
        *,
        normalization_policy: dict[str, dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        from collections import defaultdict
        issues_by_rule: dict[str, list[dict[str, Any]]] = defaultdict(list)

        def add_issue(
            rule_id: str,
            message: str,
            *,
            file_ref: str | None = None,
            **context: Any,
        ) -> None:
            issue_context = dict(context)
            if file_ref is not None:
                issue_context["file_ref"] = file_ref
            issues_by_rule[rule_id].append(
                {
                    "message": message,
                    "context": issue_context,
                }
            )

        pack_path = self._resolve_pack_path(request)
        if pack_path is None:
            if request.actor_role not in {QcActorRole.ADMIN, QcActorRole.SYSTEM}:
                raise DomainError(
                    code=QcErrorCode.QC_EVALUATION_NOT_ALLOWED,
                    message="Creator-triggered QC evaluation requires a valid local_pack_path.",
                    status_code=403,
                    details={
                        "actor_id": request.actor_id,
                        "actor_role": request.actor_role.value,
                        "reason": "metadata_fallback_forbidden",
                    },
                )
            self._inspect_metadata_fallback(request, add_issue)
            return issues_by_rule

        top_level_dirs = [entry for entry in pack_path.iterdir() if entry.is_dir()]
        top_level_name_map = {
            self._canonical_name(folder.name): folder for folder in top_level_dirs
        }

        audio_folder = self._first_folder(top_level_name_map, AUDIO_FOLDER_ALIASES)
        artwork_folder = self._first_folder(top_level_name_map, ARTWORK_FOLDER_ALIASES)
        demo_folder = self._first_folder(top_level_name_map, DEMO_FOLDER_ALIASES)
        description_folder = self._first_folder(top_level_name_map, DESCRIPTION_FOLDER_ALIASES)
        presets_folder = top_level_name_map.get("presets")
        midi_folder = top_level_name_map.get("midi")

        if audio_folder is None:
            add_issue(
                "FOLDER_AUDIO_MISSING",
                "Audio top-level folder is missing.",
                declared_top_level_folders=sorted(folder.name for folder in top_level_dirs),
            )
        if artwork_folder is None:
            add_issue(
                "FOLDER_ARTWORK_MISSING",
                "Artwork/Cover Art top-level folder is missing.",
                declared_top_level_folders=sorted(folder.name for folder in top_level_dirs),
            )
        if demo_folder is None:
            add_issue(
                "FOLDER_DEMO_MISSING",
                "Demo/Demos top-level folder is missing.",
                declared_top_level_folders=sorted(folder.name for folder in top_level_dirs),
            )
        if description_folder is None:
            add_issue(
                "FOLDER_DESCRIPTION_MISSING",
                "Description/Description & Info top-level folder is missing.",
                declared_top_level_folders=sorted(folder.name for folder in top_level_dirs),
            )

        if audio_folder is not None:
            self._inspect_audio_folder(pack_path, audio_folder, add_issue)
        if demo_folder is not None:
            self._inspect_demo_folder(
                pack_path,
                demo_folder,
                add_issue,
                normalization_policy=normalization_policy,
            )
        if description_folder is not None:
            self._inspect_description_folder(pack_path, description_folder, add_issue)
        if artwork_folder is not None:
            self._inspect_artwork_folder(pack_path, artwork_folder, add_issue)
        if presets_folder is not None:
            self._inspect_presets_folder(
                pack_path,
                presets_folder,
                add_issue,
                normalization_policy=normalization_policy,
            )
        if midi_folder is not None:
            self._inspect_midi_folder(
                pack_path,
                midi_folder,
                add_issue,
                normalization_policy=normalization_policy,
            )

        return issues_by_rule

    def _inspect_metadata_fallback(
        self,
        request: QcEvaluationRequest,
        add_issue: Callable[..., None],
    ) -> None:
        pack = request.pack
        normalized_folders = {
            self._canonical_name(name) for name in pack.declared_top_level_folders
        }
        if not any(alias in normalized_folders for alias in AUDIO_FOLDER_ALIASES):
            add_issue(
                "FOLDER_AUDIO_MISSING",
                "Audio top-level folder is missing.",
                declared_top_level_folders=pack.declared_top_level_folders,
            )

        if pack.audio_zip is None:
            add_issue("AUDIO_ZIP_FORMAT", "Audio ZIP metadata is missing.")
            return

        filename = pack.audio_zip.filename
        stem = Path(filename).stem
        if not LABEL_PACK_NAME_PATTERN.fullmatch(stem):
            add_issue(
                "AUDIO_ZIP_NAMING",
                "Audio ZIP filename must match Label Name - Pack Name.zip.",
                file_ref=filename,
            )
        if not self._is_supported_name(stem):
            add_issue(
                "AUDIO_ZIP_UNSUPPORTED_CHARACTERS",
                "Audio ZIP filename contains unsupported characters.",
                file_ref=filename,
            )

        size_bytes = pack.audio_zip.size_bytes
        if size_bytes < MIN_AUDIO_ZIP_SIZE_BYTES:
            add_issue(
                "AUDIO_ZIP_SIZE_TOO_SMALL",
                "Audio ZIP must be larger than 100KB.",
                file_ref=filename,
                size_bytes=size_bytes,
            )
        if size_bytes > MAX_AUDIO_ZIP_SIZE_BYTES:
            add_issue(
                "AUDIO_ZIP_SIZE_TOO_LARGE",
                "Audio ZIP must be smaller than 4GB.",
                file_ref=filename,
                size_bytes=size_bytes,
            )

        if pack.sample_count > MAX_SAMPLE_COUNT:
            add_issue(
                "SAMPLE_COUNT_EXCEEDED",
                "Sample count exceeds max of 1000 files.",
                sample_count=pack.sample_count,
            )
        if pack.contains_unsupported_name_tokens:
            add_issue(
                "SAMPLE_FILENAME_UNSUPPORTED_CHARACTERS",
                "Unsupported naming tokens detected in metadata fallback.",
            )

    def _resolve_pack_path(self, request: QcEvaluationRequest) -> Path | None:
        return resolve_local_pack_path(request.pack.local_pack_path)
