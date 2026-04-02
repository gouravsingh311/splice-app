from __future__ import annotations

import io
import sqlite3
import wave
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest
from mido import Message, MidiFile, MidiTrack
from PIL import Image

from app.core.errors import DomainError
from app.features.qc.contracts import QcErrorCode, QcEvaluationRequest, QcReportStatus
from app.features.qc.rules import QcRulesRegistryService
from app.features.qc.service import QcEngineService
from app.features.qc.services.inspection.probing import QcInspectionTimeoutError


def create_engine() -> QcEngineService:
    connection = sqlite3.connect(":memory:", check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA foreign_keys=ON;")
    schema_path = Path(__file__).resolve().parents[1] / "app" / "db_schema.sql"
    connection.executescript(schema_path.read_text(encoding="utf-8"))
    registry = QcRulesRegistryService(
        now_fn=lambda: datetime(2026, 2, 26, tzinfo=UTC),
        connection=connection,
    )
    return QcEngineService(
        rules_registry=registry,
        now_fn=lambda: datetime(2026, 2, 26, 1, 0, tzinfo=UTC),
        connection=connection,
    )


def create_engine_with_connection(connection: sqlite3.Connection) -> QcEngineService:
    registry = QcRulesRegistryService(
        now_fn=lambda: datetime(2026, 2, 26, tzinfo=UTC),
        connection=connection,
    )
    return QcEngineService(
        rules_registry=registry,
        now_fn=lambda: datetime(2026, 2, 26, 1, 0, tzinfo=UTC),
        connection=connection,
    )


def write_wav(
    path: Path,
    *,
    sample_rate: int = 44_100,
    bit_depth: int = 16,
    duration_seconds: float = 0.25,
) -> None:
    frame_count = int(sample_rate * duration_seconds)
    sample_width = bit_depth // 8
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00" * frame_count * sample_width)


def wav_bytes(
    *,
    sample_rate: int = 44_100,
    bit_depth: int = 16,
    duration_seconds: float = 0.25,
) -> bytes:
    buffer = io.BytesIO()
    frame_count = int(sample_rate * duration_seconds)
    sample_width = bit_depth // 8
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00" * frame_count * sample_width)
    return buffer.getvalue()


def write_baseline_pack(tmp_path: Path) -> Path:
    pack_root = tmp_path / "Label - Pack"
    audio_folder = pack_root / "Audio"
    demo_folder = pack_root / "Demo"
    description_folder = pack_root / "Description"
    artwork_folder = pack_root / "Artwork"
    presets_folder = pack_root / "Presets"
    midi_folder = pack_root / "MIDI"

    for folder in [
        audio_folder,
        demo_folder,
        description_folder,
        artwork_folder,
        presets_folder,
        midi_folder,
    ]:
        folder.mkdir(parents=True, exist_ok=True)

    zip_path = audio_folder / "Label - Pack.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr(
            "Label - Pack/One_Shots/Kick_120.wav",
            wav_bytes(duration_seconds=1.5),
        )
        archive.writestr(
            "Label - Pack/Loops/Loop_120.wav",
            wav_bytes(duration_seconds=1.1),
        )

    (demo_folder / "Demo.mp3").write_bytes(b"ID3" + b"\x00" * 4096)
    (description_folder / "pack.txt").write_text("clean description", encoding="utf-8")

    image = Image.new("RGB", (1000, 1000), color=(20, 20, 20))
    image.save(artwork_folder / "cover.jpg", format="JPEG")

    (presets_folder / "BassPreset.fxp").write_bytes(b"P" * 120)
    (presets_folder / "BassPreset.mp3").write_bytes(b"ID3" + b"\x00" * 2048)

    midi_file = MidiFile(type=0)
    track = MidiTrack()
    midi_file.tracks.append(track)
    track.append(Message("note_on", note=60, velocity=64, time=0))
    track.append(Message("note_off", note=60, velocity=64, time=480))
    midi_file.save(midi_folder / "Chord.mid")
    (midi_folder / "Chord.mp3").write_bytes(b"ID3" + b"\x00" * 2048)

    return pack_root


def build_request(
    pack_root: Path | None,
    *,
    request_id: str = "req-1",
    actor_role: str = "creator",
    local_pack_path: str | None = None,
    sample_count: int = 320,
    declared_top_level_folders: list[str] | None = None,
) -> QcEvaluationRequest:
    resolved_local_pack_path = (
        local_pack_path
        if local_pack_path is not None
        else (str(pack_root) if pack_root is not None else None)
    )
    resolved_top_level_folders = declared_top_level_folders or [
        "Artwork",
        "Audio",
        "Demo",
        "Description",
        "Presets",
        "MIDI",
    ]
    return QcEvaluationRequest(
        request_id=request_id,
        submission_id="sub-1",
        actor_id="creator-1",
        actor_role=actor_role,
        pack={
            "pack_name": "Label - Pack",
            "local_pack_path": resolved_local_pack_path,
            "declared_top_level_folders": resolved_top_level_folders,
            "audio_zip": {
                "filename": "Label - Pack.zip",
                "size_bytes": 220_000,
            },
            "sample_count": sample_count,
            "contains_unsupported_name_tokens": False,
        },
    )


def patch_mp3_analyzers(
    engine: QcEngineService,
    *,
    bitrate_kbps: int = 320,
    duration_seconds: float = 30.0,
    peak_db: float = -1.0,
) -> None:
    engine._inspect_mp3_file = lambda _path: {
        "bitrate_kbps": bitrate_kbps,
        "duration_seconds": duration_seconds,
    }
    engine._inspect_peak_with_ffmpeg = lambda _path: peak_db


def test_qc_engine_returns_passed_report_for_valid_real_pack(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    engine = create_engine()
    patch_mp3_analyzers(engine)

    result = engine.evaluate(build_request(pack_root))

    assert result.idempotent is False
    assert result.report.status == QcReportStatus.PASSED
    assert result.report.summary.blocking_failures == 0


def test_qc_engine_rejects_creator_without_local_pack_path() -> None:
    engine = create_engine()
    patch_mp3_analyzers(engine)

    with pytest.raises(DomainError) as exc_info:
        engine.evaluate(
            build_request(
                None,
                request_id="req-no-path",
                declared_top_level_folders=["Artwork", "Audio", "Demo", "Description"],
            )
        )

    assert exc_info.value.code == QcErrorCode.QC_EVALUATION_NOT_ALLOWED
    assert exc_info.value.status_code == 403


def test_qc_engine_allows_trusted_system_metadata_fallback_without_local_pack_path() -> None:
    engine = create_engine()
    patch_mp3_analyzers(engine)

    result = engine.evaluate(
        build_request(
            None,
            request_id="req-system-fallback",
            actor_role="system",
            declared_top_level_folders=["Artwork", "Audio", "Demo", "Description"],
            sample_count=2,
        )
    )

    assert result.report.status == QcReportStatus.PASSED
    assert result.report.summary.blocking_failures == 0


def test_qc_engine_allows_pack_path_outside_workspace_root(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path / "outside")
    engine = create_engine()
    patch_mp3_analyzers(engine)

    result = engine.evaluate(build_request(pack_root, request_id="req-path-outside-root"))

    assert result.report.status == QcReportStatus.PASSED


def test_qc_engine_allows_symlinked_pack_path(tmp_path: Path) -> None:
    allowed_root = tmp_path / "allowed"
    allowed_root.mkdir()
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    actual_pack_root = write_baseline_pack(outside_root)
    symlink_pack_root = allowed_root / "Label - Pack"
    symlink_pack_root.symlink_to(actual_pack_root, target_is_directory=True)

    engine = create_engine()
    patch_mp3_analyzers(engine)

    result = engine.evaluate(build_request(symlink_pack_root, request_id="req-symlink-pack"))

    assert result.report.status == QcReportStatus.PASSED


def test_qc_engine_maps_ffmpeg_timeout_to_deterministic_failure(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    engine = create_engine()
    patch_mp3_analyzers(engine)

    def timeout_on_demo(path: Path) -> float:
        if path.name == "Demo.mp3":
            raise QcInspectionTimeoutError("ffmpeg timed out")
        return -1.0

    engine._inspect_peak_with_ffmpeg = timeout_on_demo

    result = engine.evaluate(build_request(pack_root, request_id="req-timeout"))

    timeout_findings = [
        finding
        for finding in result.report.findings
        if finding.rule_id == "DEMO_NORMALIZATION_INVALID"
    ]
    assert timeout_findings
    assert any(finding.context.get("timeout") is True for finding in timeout_findings)
    assert any(finding.context.get("error_code") == "QC_TIMEOUT" for finding in timeout_findings)


def test_qc_engine_rejects_idempotent_payload_conflict(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    engine = create_engine()
    patch_mp3_analyzers(engine)

    first_request = build_request(pack_root, request_id="req-idempotent")
    engine.evaluate(first_request)

    with pytest.raises(DomainError) as exc_info:
        engine.evaluate(
            build_request(
                pack_root,
                request_id="req-idempotent",
                sample_count=999,
            )
        )

    assert exc_info.value.code == QcErrorCode.QC_IDEMPOTENCY_CONFLICT
    assert exc_info.value.status_code == 409


def test_qc_engine_detects_missing_required_top_level_folder(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    (pack_root / "Audio").rename(pack_root / "AudioRenamed")
    engine = create_engine()
    patch_mp3_analyzers(engine)

    result = engine.evaluate(build_request(pack_root, request_id="req-2"))

    assert result.report.status == QcReportStatus.FAILED
    assert any(finding.rule_id == "FOLDER_AUDIO_MISSING" for finding in result.report.findings)


def test_qc_engine_detects_audio_zip_sample_rule_family(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    zip_path = pack_root / "Audio" / "Label - Pack.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("Label - Pack/One_Shots/Kick_120.wav", wav_bytes(sample_rate=44_100))
        archive.writestr("Label - Pack/Loops/Loop72.3.wav", wav_bytes(sample_rate=48_000))
        archive.writestr("Label - Pack/Loops/Loop_copy.wav", wav_bytes(sample_rate=44_100))
        archive.writestr("Label - Pack/Loops/Synth.aiff", b"not-wav-data")

    engine = create_engine()
    patch_mp3_analyzers(engine)
    result = engine.evaluate(build_request(pack_root, request_id="req-3"))
    rule_ids = {finding.rule_id for finding in result.report.findings}

    assert "SAMPLE_RATE_INCONSISTENT" in rule_ids
    assert "SAMPLE_FORMAT_INVALID" in rule_ids
    assert "SAMPLE_FILENAME_FRACTIONAL_BPM" in rule_ids


def test_qc_engine_detects_demo_description_and_artwork_violations(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    (pack_root / "Demo" / "Demo.mp3").write_bytes(b"x" * (11 * 1024 * 1024))
    (pack_root / "Description" / "pack.txt").write_text(
        "This pack has tribal and rhodes references.", encoding="utf-8"
    )
    image = Image.new("RGB", (1200, 1000), color=(20, 20, 20))
    image.save(pack_root / "Artwork" / "cover.jpg", format="JPEG")

    engine = create_engine()
    patch_mp3_analyzers(engine, bitrate_kbps=128, duration_seconds=240.0, peak_db=-3.0)
    result = engine.evaluate(build_request(pack_root, request_id="req-4"))
    rule_ids = {finding.rule_id for finding in result.report.findings}

    assert "DEMO_SIZE_EXCEEDED" in rule_ids
    assert "DEMO_BITRATE_INVALID" in rule_ids
    assert "DESCRIPTION_BANNED_TERM" in rule_ids
    assert "ART_ASPECT_RATIO_NOT_SQUARE" in rule_ids


def test_qc_engine_detects_preset_and_midi_preview_violations(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    (pack_root / "Presets" / "BassPreset.mp3").unlink()
    (pack_root / "Presets" / "Bad?Name.fxp").write_bytes(b"preset-content")

    midi_type_1 = MidiFile(type=1)
    midi_type_1.tracks.append(MidiTrack())
    midi_type_1.save(pack_root / "MIDI" / "TypeOne.mid")

    engine = create_engine()
    patch_mp3_analyzers(engine)
    result = engine.evaluate(build_request(pack_root, request_id="req-5"))
    rule_ids = {finding.rule_id for finding in result.report.findings}

    assert "PRESET_PREVIEW_MISSING" in rule_ids
    assert "PRESET_FILENAME_INVALID" in rule_ids
    assert "MIDI_TYPE_INVALID" in rule_ids


def test_qc_engine_matches_preset_and_midi_previews_case_insensitively(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    (pack_root / "Presets" / "BassPreset.mp3").rename(
        pack_root / "Presets" / "basspreset.mp3"
    )
    (pack_root / "MIDI" / "Chord.mp3").rename(pack_root / "MIDI" / "cHoRd.mp3")

    engine = create_engine()
    patch_mp3_analyzers(engine)
    result = engine.evaluate(build_request(pack_root, request_id="req-6"))
    rule_ids = {finding.rule_id for finding in result.report.findings}

    assert "PRESET_PREVIEW_MISSING" not in rule_ids
    assert "MIDI_PREVIEW_MISSING" not in rule_ids


def test_qc_engine_request_id_is_idempotent(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    engine = create_engine()
    patch_mp3_analyzers(engine)
    request = build_request(pack_root)

    first = engine.evaluate(request)
    second = engine.evaluate(request)

    assert first.idempotent is False
    assert second.idempotent is True
    assert first.report.report_id == second.report.report_id


def test_qc_engine_rejects_rule_set_version_mismatch(tmp_path: Path) -> None:
    pack_root = write_baseline_pack(tmp_path)
    engine = create_engine()
    patch_mp3_analyzers(engine)
    request = build_request(pack_root).model_copy(update={"rule_set_version": "stale-rule-set"})

    with pytest.raises(DomainError) as exc_info:
        engine.evaluate(request)

    assert exc_info.value.code == QcErrorCode.QC_POLICY_VERSION_CONFLICT


def test_qc_engine_results_are_persisted_and_loadable(
    in_memory_db_connection: sqlite3.Connection,
    tmp_path: Path,
) -> None:
    pack_root = write_baseline_pack(tmp_path)
    engine = create_engine_with_connection(in_memory_db_connection)
    patch_mp3_analyzers(engine)
    request = build_request(pack_root)
    engine.evaluate(request)

    restarted = create_engine_with_connection(in_memory_db_connection)
    patch_mp3_analyzers(restarted)
    results = restarted.get_results(request.submission_id)

    assert results.latest.run_id == "req-1"
    assert results.latest.submission_id == "sub-1"
    assert results.latest.status == QcReportStatus.PASSED
    assert results.latest.generated_at == datetime(2026, 2, 26, 1, 0, tzinfo=UTC)
    assert results.latest.rule_set_version == "2026.03.phase1-production"
    assert results.latest.policy_version == 1
    assert len(results.history) == 1
