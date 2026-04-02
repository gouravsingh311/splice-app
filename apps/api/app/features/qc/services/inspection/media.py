from __future__ import annotations

import hashlib
import zipfile
from collections import defaultdict
from collections.abc import Callable
from pathlib import Path
from typing import Any

from mido import MidiFile
from PIL import Image, UnidentifiedImageError

from .base import (
    FRACTIONAL_BPM_PATTERN,
    LABEL_PACK_NAME_PATTERN,
    LOOPS_FOLDER_ALIASES,
    MAX_ARTWORK_BYTES,
    MAX_ARTWORK_DIMENSION,
    MAX_AUDIO_ZIP_SIZE_BYTES,
    MAX_DEMO_DURATION_SECONDS,
    MAX_DEMO_SIZE_BYTES,
    MAX_NORMALIZATION_DB,
    MAX_PRESET_BYTES,
    MAX_PREVIEW_BYTES,
    MAX_PREVIEW_DURATION_SECONDS,
    MAX_SAMPLE_COUNT,
    MAX_SAMPLE_DURATION_SECONDS,
    MIN_ARTWORK_DIMENSION,
    MIN_AUDIO_ZIP_SIZE_BYTES,
    MIN_PRESET_BYTES,
    MIN_SAMPLE_BYTES,
    MIN_SAMPLE_NORMALIZATION_DB,
    MIN_SAMPLE_RATE,
    ONE_SHOTS_FOLDER_ALIASES,
    SUPPORTED_PRESET_EXTENSIONS,
    InspectionBaseMixin,
)
from .probing import InspectionProbingMixin, QcInspectionTimeoutError


class InspectionMediaMixin(InspectionBaseMixin, InspectionProbingMixin):
    """Folder-level inspection logic for audio, demos, artwork, etc."""

    def _inspect_audio_folder(
        self,
        pack_path: Path,
        audio_folder: Path,
        add_issue: Callable[..., None],
    ) -> None:
        all_files = sorted(path for path in audio_folder.rglob("*") if path.is_file())
        zip_files = [path for path in all_files if path.suffix.lower() == ".zip"]

        if not zip_files:
            add_issue(
                "AUDIO_ZIP_FORMAT",
                "Audio folder must include a .zip archive.",
                file_ref=self._relative_file_ref(pack_path, audio_folder),
            )
            return

        audio_zip_path = zip_files[0]
        zip_stem = audio_zip_path.stem
        zip_file_ref = self._relative_file_ref(pack_path, audio_zip_path)

        if audio_zip_path.parent != audio_folder:
            add_issue(
                "AUDIO_ZIP_LOCATION",
                "Audio ZIP must be directly inside Audio folder.",
                file_ref=zip_file_ref,
            )

        if audio_zip_path.suffix.lower() != ".zip":
            add_issue(
                "AUDIO_ZIP_FORMAT",
                "Audio archive must use .zip extension.",
                file_ref=zip_file_ref,
            )

        if not LABEL_PACK_NAME_PATTERN.fullmatch(zip_stem):
            add_issue(
                "AUDIO_ZIP_NAMING",
                "Audio ZIP filename must match Label Name - Pack Name.zip.",
                file_ref=zip_file_ref,
            )

        if not self._is_supported_name(zip_stem):
            add_issue(
                "AUDIO_ZIP_UNSUPPORTED_CHARACTERS",
                "Audio ZIP filename contains unsupported characters.",
                file_ref=zip_file_ref,
            )

        zip_size = audio_zip_path.stat().st_size
        if zip_size < MIN_AUDIO_ZIP_SIZE_BYTES:
            add_issue(
                "AUDIO_ZIP_SIZE_TOO_SMALL",
                "Audio ZIP must be larger than 100KB.",
                file_ref=zip_file_ref,
                size_bytes=zip_size,
            )
        if zip_size > MAX_AUDIO_ZIP_SIZE_BYTES:
            add_issue(
                "AUDIO_ZIP_SIZE_TOO_LARGE",
                "Audio ZIP must be smaller than 4GB.",
                file_ref=zip_file_ref,
                size_bytes=zip_size,
            )

        try:
            with zipfile.ZipFile(audio_zip_path) as archive:
                info_entries = [entry for entry in archive.infolist() if not entry.is_dir()]
                if not info_entries:
                    add_issue(
                        "SAMPLE_CORRUPT_FILE",
                        "Audio ZIP has no sample files.",
                        file_ref=zip_file_ref,
                    )
                    return

                top_folders = {
                    entry.filename.split("/")[0]
                    for entry in info_entries
                    if "/" in entry.filename
                }
                if len(top_folders) != 1:
                    add_issue(
                        "SAMPLE_TOP_FOLDER_NAMING",
                        "Audio ZIP must extract to exactly one top folder.",
                        file_ref=zip_file_ref,
                    )
                    return

                top_folder_name = next(iter(top_folders))
                if not LABEL_PACK_NAME_PATTERN.fullmatch(top_folder_name):
                    add_issue(
                        "SAMPLE_TOP_FOLDER_NAMING",
                        "Extracted top folder must match Label Name - Pack Name.",
                        file_ref=top_folder_name,
                    )

                lower_child_folders = set()
                for entry in info_entries:
                    parts = entry.filename.split("/")
                    if len(parts) >= 3 and parts[0] == top_folder_name:
                        lower_child_folders.add(self._canonical_name(parts[1]))
                if not any(alias in lower_child_folders for alias in ONE_SHOTS_FOLDER_ALIASES):
                    add_issue(
                        "SAMPLE_SUBFOLDER_ONESHOTS_MISSING",
                        "One_Shots folder is missing inside audio ZIP.",
                        file_ref=top_folder_name,
                    )
                if not any(alias in lower_child_folders for alias in LOOPS_FOLDER_ALIASES):
                    add_issue(
                        "SAMPLE_SUBFOLDER_LOOPS_MISSING",
                        "Loops folder is missing inside audio ZIP.",
                        file_ref=top_folder_name,
                    )

                if len(info_entries) > MAX_SAMPLE_COUNT:
                    add_issue(
                        "SAMPLE_COUNT_EXCEEDED",
                        "Sample count exceeds max of 1000 files.",
                        file_ref=zip_file_ref,
                        sample_count=len(info_entries),
                    )

                sample_rates: set[int] = set()
                hashes: dict[str, list[str]] = defaultdict(list)

                for entry in info_entries:
                    file_ref = entry.filename
                    file_name = Path(entry.filename).name
                    stem = Path(file_name).stem
                    if not self._is_supported_name(stem):
                        add_issue(
                            "SAMPLE_FILENAME_UNSUPPORTED_CHARACTERS",
                            "Sample filename contains unsupported characters.",
                            file_ref=file_ref,
                        )
                    if self._contains_banned_term(stem):
                        add_issue(
                            "SAMPLE_FILENAME_BANNED_TERM",
                            "Sample filename contains banned term.",
                            file_ref=file_ref,
                        )
                    if FRACTIONAL_BPM_PATTERN.search(stem):
                        add_issue(
                            "SAMPLE_FILENAME_FRACTIONAL_BPM",
                            "Sample filename includes fractional BPM value.",
                            file_ref=file_ref,
                        )

                    if entry.file_size < MIN_SAMPLE_BYTES:
                        add_issue(
                            "SAMPLE_CORRUPT_FILE",
                            "Sample file is too small and may be corrupt.",
                            file_ref=file_ref,
                            size_bytes=entry.file_size,
                        )

                    if Path(file_name).suffix.lower() != ".wav":
                        add_issue(
                            "SAMPLE_FORMAT_INVALID",
                            "Sample file must be WAV.",
                            file_ref=file_ref,
                        )
                        continue

                    try:
                        wav_bytes = archive.read(entry)
                        hashes[hashlib.sha256(wav_bytes).hexdigest()].append(file_ref)
                        wav_meta = self._inspect_wav_bytes(wav_bytes)
                    except (RuntimeError, ValueError, OSError, zipfile.BadZipFile) as exc:
                        add_issue(
                            "SAMPLE_CORRUPT_FILE",
                            f"Unable to parse WAV sample: {exc}",
                            file_ref=file_ref,
                        )
                        continue

                    duration_seconds = float(wav_meta["duration_seconds"])
                    sample_rate = int(wav_meta["sample_rate"])
                    bit_depth = int(wav_meta["bit_depth"])
                    peak_db = float(wav_meta["peak_db"])

                    if duration_seconds > MAX_SAMPLE_DURATION_SECONDS:
                        add_issue(
                            "SAMPLE_DURATION_EXCEEDED",
                            "Sample duration exceeds 3 minutes.",
                            file_ref=file_ref,
                            duration_seconds=duration_seconds,
                        )
                    if sample_rate < MIN_SAMPLE_RATE:
                        add_issue(
                            "SAMPLE_RATE_TOO_LOW",
                            "Sample rate must be at least 44.1kHz.",
                            file_ref=file_ref,
                            sample_rate=sample_rate,
                        )
                    sample_rates.add(sample_rate)

                    if bit_depth not in {16, 24}:
                        add_issue(
                            "SAMPLE_BIT_DEPTH_INVALID",
                            "Sample bit depth must be 16-bit or 24-bit WAV.",
                            file_ref=file_ref,
                            bit_depth=bit_depth,
                        )

                    if peak_db < MIN_SAMPLE_NORMALIZATION_DB or peak_db > MAX_NORMALIZATION_DB:
                        add_issue(
                            "SAMPLE_NORMALIZATION_OUT_OF_RANGE",
                            "Sample peak should be between -15dB and 0dB.",
                            file_ref=file_ref,
                            peak_db=peak_db,
                        )

                if len(sample_rates) > 1:
                    add_issue(
                        "SAMPLE_RATE_INCONSISTENT",
                        "All samples must use a consistent sample rate.",
                        file_ref=zip_file_ref,
                        sample_rates=sorted(sample_rates),
                    )

                for duplicate_paths in hashes.values():
                    if len(duplicate_paths) > 1:
                        for duplicate_path in duplicate_paths:
                            add_issue(
                                "SAMPLE_DUPLICATE_FOUND",
                                "Duplicate sample content detected.",
                                file_ref=duplicate_path,
                                duplicates=duplicate_paths,
                            )

        except zipfile.BadZipFile:
            add_issue(
                "AUDIO_ZIP_FORMAT",
                "Audio ZIP is corrupt or unreadable.",
                file_ref=zip_file_ref,
            )

    def _inspect_demo_folder(
        self,
        pack_path: Path,
        demo_folder: Path,
        add_issue: Callable[..., None],
        *,
        normalization_policy: dict[str, dict[str, Any]],
    ) -> None:
        demo_files = sorted(path for path in demo_folder.rglob("*") if path.is_file())
        if not demo_files:
            add_issue(
                "DEMO_LOCATION_INVALID",
                "Demo folder does not contain any files.",
                file_ref=self._relative_file_ref(pack_path, demo_folder),
            )
            return

        for file_path in demo_files:
            file_ref = self._relative_file_ref(pack_path, file_path)
            if file_path.suffix.lower() != ".mp3":
                add_issue(
                    "DEMO_FORMAT_INVALID",
                    "Demo file must be MP3.",
                    file_ref=file_ref,
                )
                continue

            if file_path.stat().st_size > MAX_DEMO_SIZE_BYTES:
                add_issue(
                    "DEMO_SIZE_EXCEEDED",
                    "Demo file must be <= 10MB.",
                    file_ref=file_ref,
                    size_bytes=file_path.stat().st_size,
                )

            try:
                mp3_meta = self._inspect_mp3_file(file_path)
            except RuntimeError as exc:
                add_issue(
                    "DEMO_FORMAT_INVALID",
                    f"Demo MP3 is unreadable: {exc}",
                    file_ref=file_ref,
                )
                continue

            if mp3_meta["bitrate_kbps"] != 320:
                add_issue(
                    "DEMO_BITRATE_INVALID",
                    "Demo bitrate must be exactly 320kbps.",
                    file_ref=file_ref,
                    bitrate_kbps=mp3_meta["bitrate_kbps"],
                )
            if mp3_meta["duration_seconds"] > MAX_DEMO_DURATION_SECONDS:
                add_issue(
                    "DEMO_DURATION_EXCEEDED",
                    "Demo duration must be <= 3m30s.",
                    file_ref=file_ref,
                    duration_seconds=mp3_meta["duration_seconds"],
                )

            try:
                peak_db = self._inspect_peak_with_ffmpeg(file_path)
            except QcInspectionTimeoutError:
                add_issue(
                    "DEMO_NORMALIZATION_INVALID",
                    "Demo peak inspection timed out.",
                    file_ref=file_ref,
                    peak_db=None,
                    timeout=True,
                    error_code="QC_TIMEOUT",
                )
                continue
            normalization = normalization_policy.get("DEMO_NORMALIZATION_INVALID", {})
            if (
                peak_db is None
                or abs(peak_db - normalization["target_db"]) > normalization["tolerance_db"]
            ):
                # This depends on _build_normalization_message which should be
                # in engine.py or base.py. I'll assume it's available via
                # composition or base class inheritance.
                add_issue(
                    "DEMO_NORMALIZATION_INVALID",
                    self._build_normalization_message(
                        "Demo peak",
                        target_db=normalization["target_db"],
                        strict_enforcement=normalization["strict_enforcement"],
                    ),
                    file_ref=file_ref,
                    peak_db=peak_db,
                )

    def _inspect_description_folder(
        self,
        pack_path: Path,
        description_folder: Path,
        add_issue: Callable[..., None],
    ) -> None:
        description_files = sorted(
            path for path in description_folder.rglob("*") if path.is_file()
        )
        if not description_files:
            add_issue(
                "DESCRIPTION_LOCATION_INVALID",
                "Description folder does not contain any files.",
                file_ref=self._relative_file_ref(pack_path, description_folder),
            )
            return

        for file_path in description_files:
            file_ref = self._relative_file_ref(pack_path, file_path)
            extension = file_path.suffix.lower()
            if extension not in {".txt", ".rtf"}:
                add_issue(
                    "DESCRIPTION_FORMAT_INVALID",
                    "Description file must be .txt or .rtf.",
                    file_ref=file_ref,
                )
                continue

            text_content = file_path.read_text(encoding="utf-8", errors="ignore")
            if self._contains_banned_term(text_content):
                add_issue(
                    "DESCRIPTION_BANNED_TERM",
                    "Description contains banned terms.",
                    file_ref=file_ref,
                )

    def _inspect_artwork_folder(
        self,
        pack_path: Path,
        artwork_folder: Path,
        add_issue: Callable[..., None],
    ) -> None:
        artwork_files = sorted(path for path in artwork_folder.rglob("*") if path.is_file())
        if not artwork_files:
            add_issue(
                "ART_LOCATION_INVALID",
                "Artwork folder does not contain any files.",
                file_ref=self._relative_file_ref(pack_path, artwork_folder),
            )
            return

        for file_path in artwork_files:
            file_ref = self._relative_file_ref(pack_path, file_path)
            extension = file_path.suffix.lower()
            if extension not in {".jpg", ".jpeg", ".png"}:
                add_issue(
                    "ART_FORMAT_INVALID",
                    "Artwork file must be JPG or PNG.",
                    file_ref=file_ref,
                )
                continue

            if file_path.stat().st_size > MAX_ARTWORK_BYTES:
                add_issue(
                    "ART_SIZE_EXCEEDED",
                    "Artwork file must be <= 10MB.",
                    file_ref=file_ref,
                    size_bytes=file_path.stat().st_size,
                )

            try:
                with Image.open(file_path) as image:
                    width, height = image.size
            except (UnidentifiedImageError, OSError):
                add_issue(
                    "ART_FORMAT_INVALID",
                    "Artwork file could not be decoded as image.",
                    file_ref=file_ref,
                )
                continue

            if (
                width < MIN_ARTWORK_DIMENSION
                or height < MIN_ARTWORK_DIMENSION
                or width > MAX_ARTWORK_DIMENSION
                or height > MAX_ARTWORK_DIMENSION
            ):
                add_issue(
                    "ART_RESOLUTION_OUT_OF_RANGE",
                    "Artwork dimensions must be between 600 and 2000 pixels.",
                    file_ref=file_ref,
                    width=width,
                    height=height,
                )

            if width != height:
                add_issue(
                    "ART_ASPECT_RATIO_NOT_SQUARE",
                    "Artwork must have a 1:1 aspect ratio.",
                    file_ref=file_ref,
                    width=width,
                    height=height,
                )

    def _inspect_presets_folder(
        self,
        pack_path: Path,
        presets_folder: Path,
        add_issue: Callable[..., None],
        *,
        normalization_policy: dict[str, dict[str, Any]],
    ) -> None:
        files = sorted(path for path in presets_folder.rglob("*") if path.is_file())
        previews_by_stem: dict[str, Path] = {}
        for path in files:
            if path.suffix.lower() != ".mp3":
                continue
            key = self._normalize_preview_stem_key(path.stem)
            previews_by_stem.setdefault(key, path)

        for file_path in files:
            if file_path.suffix.lower() == ".mp3":
                continue

            file_ref = self._relative_file_ref(pack_path, file_path)
            extension = file_path.suffix.lower()
            if extension not in SUPPORTED_PRESET_EXTENSIONS:
                add_issue(
                    "PRESET_FILE_TYPE_INVALID",
                    "Preset file type is not supported.",
                    file_ref=file_ref,
                    extension=extension,
                )

            file_size = file_path.stat().st_size
            if file_size < MIN_PRESET_BYTES or file_size > MAX_PRESET_BYTES:
                add_issue(
                    "PRESET_FILE_SIZE_OUT_OF_RANGE",
                    "Preset file must be between 100 bytes and 50MB.",
                    file_ref=file_ref,
                    size_bytes=file_size,
                )

            if (
                (not self._is_supported_name(file_path.stem))
                or self._contains_banned_term(file_path.stem)
            ):
                add_issue(
                    "PRESET_FILENAME_INVALID",
                    "Preset filename violates naming policy.",
                    file_ref=file_ref,
                )

            preview_path = previews_by_stem.get(
                self._normalize_preview_stem_key(file_path.stem)
            )
            if preview_path is None:
                add_issue(
                    "PRESET_PREVIEW_MISSING",
                    "Preset file requires matching MP3 preview.",
                    file_ref=file_ref,
                )
                continue

            self._inspect_preview_mp3(
                pack_path=pack_path,
                preview_path=preview_path,
                add_issue=add_issue,
                format_rule="PRESET_PREVIEW_FORMAT_INVALID",
                size_rule="PRESET_PREVIEW_SIZE_EXCEEDED",
                duration_rule="PRESET_PREVIEW_DURATION_EXCEEDED",
                normalization_rule="PRESET_PREVIEW_NORMALIZATION_INVALID",
                bitrate_rule="PRESET_PREVIEW_BITRATE_INVALID",
                normalization_policy=normalization_policy,
            )

    def _inspect_midi_folder(
        self,
        pack_path: Path,
        midi_folder: Path,
        add_issue: Callable[..., None],
        *,
        normalization_policy: dict[str, dict[str, Any]],
    ) -> None:
        files = sorted(path for path in midi_folder.rglob("*") if path.is_file())
        previews_by_stem: dict[str, Path] = {}
        for path in files:
            if path.suffix.lower() != ".mp3":
                continue
            key = self._normalize_preview_stem_key(path.stem)
            previews_by_stem.setdefault(key, path)

        for file_path in files:
            extension = file_path.suffix.lower()
            if extension == ".mp3":
                continue

            file_ref = self._relative_file_ref(pack_path, file_path)
            if extension != ".mid":
                add_issue(
                    "MIDI_FORMAT_INVALID",
                    "MIDI file must use .mid extension.",
                    file_ref=file_ref,
                )
                continue

            try:
                midi_type = MidiFile(file_path).type
            except (OSError, EOFError, ValueError) as exc:
                add_issue(
                    "MIDI_FORMAT_INVALID",
                    f"MIDI file is unreadable: {exc}",
                    file_ref=file_ref,
                )
                continue

            if midi_type != 0:
                add_issue(
                    "MIDI_TYPE_INVALID",
                    "MIDI file must be Type 0.",
                    file_ref=file_ref,
                    midi_type=midi_type,
                )

            preview_path = previews_by_stem.get(
                self._normalize_preview_stem_key(file_path.stem)
            )
            if preview_path is None:
                add_issue(
                    "MIDI_PREVIEW_MISSING",
                    "MIDI file requires matching MP3 preview.",
                    file_ref=file_ref,
                )
                continue

            self._inspect_preview_mp3(
                pack_path=pack_path,
                preview_path=preview_path,
                add_issue=add_issue,
                format_rule="MIDI_PREVIEW_FORMAT_INVALID",
                size_rule="MIDI_PREVIEW_SIZE_EXCEEDED",
                duration_rule="MIDI_PREVIEW_DURATION_EXCEEDED",
                normalization_rule="MIDI_PREVIEW_NORMALIZATION_INVALID",
                bitrate_rule="MIDI_PREVIEW_BITRATE_INVALID",
                normalization_policy=normalization_policy,
            )

    def _inspect_preview_mp3(
        self,
        *,
        pack_path: Path,
        preview_path: Path,
        add_issue: Callable[..., None],
        format_rule: str,
        size_rule: str,
        duration_rule: str,
        normalization_rule: str,
        bitrate_rule: str,
        normalization_policy: dict[str, dict[str, Any]],
    ) -> None:
        file_ref = self._relative_file_ref(pack_path, preview_path)
        if preview_path.suffix.lower() != ".mp3":
            add_issue(format_rule, "Preview must be MP3.", file_ref=file_ref)
            return

        if preview_path.stat().st_size > MAX_PREVIEW_BYTES:
            add_issue(
                size_rule,
                "Preview file must be <= 5MB.",
                file_ref=file_ref,
                size_bytes=preview_path.stat().st_size,
            )

        try:
            mp3_meta = self._inspect_mp3_file(preview_path)
        except RuntimeError as exc:
            add_issue(format_rule, f"Preview MP3 is unreadable: {exc}", file_ref=file_ref)
            return

        if mp3_meta["duration_seconds"] > MAX_PREVIEW_DURATION_SECONDS:
            add_issue(
                duration_rule,
                "Preview duration must be <= 1 minute.",
                file_ref=file_ref,
                duration_seconds=mp3_meta["duration_seconds"],
            )
        if mp3_meta["bitrate_kbps"] != 320:
            add_issue(
                bitrate_rule,
                "Preview bitrate must be exactly 320kbps.",
                file_ref=file_ref,
                bitrate_kbps=mp3_meta["bitrate_kbps"],
            )

        try:
            peak_db = self._inspect_peak_with_ffmpeg(preview_path)
        except QcInspectionTimeoutError:
            add_issue(
                normalization_rule,
                "Preview peak inspection timed out.",
                file_ref=file_ref,
                peak_db=None,
                timeout=True,
                error_code="QC_TIMEOUT",
            )
            return
        rule_policy = normalization_policy.get(normalization_rule, {})
        if peak_db is None or abs(peak_db - rule_policy["target_db"]) > rule_policy["tolerance_db"]:
            add_issue(
                normalization_rule,
                self._build_normalization_message(
                    "Preview peak",
                    target_db=rule_policy["target_db"],
                    strict_enforcement=rule_policy["strict_enforcement"],
                ),
                file_ref=file_ref,
                peak_db=peak_db,
            )

    def _build_normalization_message(
        self,
        subject: str,
        target_db: float,
        strict_enforcement: bool,
    ) -> str:
        # This will be overridden or implemented in engine.py or base.py mixin if needed.
        # For now, I'll provide a default implementation or assume it's inherited.
        target_text = f"{target_db:.1f}dB"
        if strict_enforcement:
            return f"{subject} must be strictly normalized to {target_text}."
        return f"{subject} must be normalized to {target_text}."
