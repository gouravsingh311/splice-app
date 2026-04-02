from __future__ import annotations

import re
from pathlib import Path

# Constants
MIN_AUDIO_ZIP_SIZE_BYTES = 100 * 1024
MAX_AUDIO_ZIP_SIZE_BYTES = 4 * 1024 * 1024 * 1024
MAX_SAMPLE_COUNT = 1000
MAX_SAMPLE_DURATION_SECONDS = 180
MIN_SAMPLE_RATE = 44_100
MIN_SAMPLE_BYTES = 1024
MAX_DEMO_SIZE_BYTES = 10 * 1024 * 1024
MAX_DEMO_DURATION_SECONDS = 210
MAX_ARTWORK_BYTES = 10 * 1024 * 1024
MIN_ARTWORK_DIMENSION = 600
MAX_ARTWORK_DIMENSION = 2000
MIN_PRESET_BYTES = 100
MAX_PRESET_BYTES = 50 * 1024 * 1024
MAX_PREVIEW_BYTES = 5 * 1024 * 1024
MAX_PREVIEW_DURATION_SECONDS = 60

AUDIO_FOLDER_ALIASES = frozenset({"audio"})
ARTWORK_FOLDER_ALIASES = frozenset({"artwork", "coverart"})
DEMO_FOLDER_ALIASES = frozenset({"demo", "demos"})
DESCRIPTION_FOLDER_ALIASES = frozenset({"description", "descriptioninfo"})
ONE_SHOTS_FOLDER_ALIASES = frozenset({"oneshots", "oneshot", "one shots", "one_shots"})
LOOPS_FOLDER_ALIASES = frozenset({"loops", "loop"})

BANNED_TERMS = ("rhodes", "tribal", "oriental", "urban")
FILENAME_ALLOWED_PATTERN = re.compile(r"^[A-Za-z0-9_\-# ]+$")
LABEL_PACK_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_\-# ]+ - [A-Za-z0-9_\-# ]+$")
FRACTIONAL_BPM_PATTERN = re.compile(r"\d+\.\d+")
MAX_NORMALIZATION_DB = 0.0
MIN_SAMPLE_NORMALIZATION_DB = -15.0
TARGET_PREVIEW_NORMALIZATION_DB = -1.0
TARGET_DB_TOLERANCE = 0.7
STRICT_DB_TOLERANCE = 0.2

SUPPORTED_PRESET_EXTENSIONS = {
    ".xml",
    ".zip",
    ".nmsv",
    ".phaseplant",
    ".fxp",
    ".serumpreset",
    ".spf",
    ".vital",
}


class InspectionBaseMixin:
    """Base utilities for QC inspection."""

    def _canonical_name(self, value: str) -> str:
        normalized = value.strip().lower().replace("&", "and")
        normalized = re.sub(r"\s+", "", normalized)
        normalized = normalized.replace("_", "")
        normalized = normalized.replace("-", "")
        return normalized

    def _relative_file_ref(self, root: Path, target: Path) -> str:
        try:
            return target.relative_to(root).as_posix()
        except ValueError:
            return target.name

    def _is_supported_name(self, value: str) -> bool:
        if not value:
            return False
        return bool(FILENAME_ALLOWED_PATTERN.fullmatch(value))

    def _contains_banned_term(self, value: str) -> bool:
        lower_value = value.lower()
        return any(term in lower_value for term in BANNED_TERMS)

    def _first_folder(
        self,
        top_level_name_map: dict[str, Path],
        aliases: set[str] | frozenset[str],
    ) -> Path | None:
        for alias in aliases:
            if alias in top_level_name_map:
                return top_level_name_map[alias]
        return None

    def _normalize_preview_stem_key(self, stem: str) -> str:
        return str(stem or "").casefold()
