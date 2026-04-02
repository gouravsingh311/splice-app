from __future__ import annotations

import io
import json
import wave
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from mido import Message, MidiFile, MidiTrack
from PIL import Image

from app.main import create_app


def create_client() -> TestClient:
    return TestClient(create_app())


EXPECTED_QC_RESULTS_KEYS = {"latest", "history"}
EXPECTED_QC_RUN_KEYS = {
    "run_id",
    "submission_id",
    "status",
    "started_at",
    "completed_at",
    "generated_at",
    "rule_set_version",
    "policy_version",
    "findings",
}


def wav_bytes(*, sample_rate: int = 44_100, duration_seconds: float = 0.25) -> bytes:
    buffer = io.BytesIO()
    frame_count = int(sample_rate * duration_seconds)
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00" * frame_count * 2)
    return buffer.getvalue()


def write_pack_fixture(tmp_path: Path) -> Path:
    pack_root = tmp_path / "Label - Pack"
    for folder in ["Audio", "Demo", "Description", "Artwork", "Presets", "MIDI"]:
        (pack_root / folder).mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(pack_root / "Audio" / "Label - Pack.zip", "w") as archive:
        archive.writestr(
            "Label - Pack/One_Shots/Kick_120.wav",
            wav_bytes(duration_seconds=1.5),
        )
        archive.writestr(
            "Label - Pack/Loops/Loop_120.wav",
            wav_bytes(duration_seconds=1.1),
        )

    (pack_root / "Demo" / "Demo.mp3").write_bytes(b"ID3" + b"\x00" * 2048)
    (pack_root / "Description" / "pack.txt").write_text("clean description", encoding="utf-8")

    image = Image.new("RGB", (1000, 1000), color=(20, 20, 20))
    image.save(pack_root / "Artwork" / "cover.jpg", format="JPEG")

    (pack_root / "Presets" / "BassPreset.fxp").write_bytes(b"P" * 120)
    (pack_root / "Presets" / "BassPreset.mp3").write_bytes(b"ID3" + b"\x00" * 2048)

    midi_file = MidiFile(type=0)
    track = MidiTrack()
    midi_file.tracks.append(track)
    track.append(Message("note_on", note=60, velocity=64, time=0))
    track.append(Message("note_off", note=60, velocity=64, time=480))
    midi_file.save(pack_root / "MIDI" / "Chord.mid")
    (pack_root / "MIDI" / "Chord.mp3").write_bytes(b"ID3" + b"\x00" * 2048)

    return pack_root


def build_full_qc_policy_payload(
    client: TestClient,
    *,
    request_id: str,
    reason: str,
    actor_id: str = "admin-1",
    actor_role: str = "admin",
    mutate_rule_id: str | None = None,
    mutate_rule_updates: dict[str, object] | None = None,
    disabled_rule_ids: list[str] | None = None,
) -> dict[str, object]:
    snapshot = client.app.state.qc_rules_registry_service.get_active_policy_snapshot()
    rules: list[dict[str, object]] = [
        {
            "rule_id": binding.rule_id,
            "enabled": binding.enabled,
            "blocking_override": binding.blocking_override,
            "params": binding.params,
        }
        for binding in snapshot.rules
    ]
    if mutate_rule_id is not None and mutate_rule_updates is not None:
        for rule in rules:
            if rule["rule_id"] == mutate_rule_id:
                rule.update(mutate_rule_updates)
                break

    return {
        "request_id": request_id,
        "actor_id": actor_id,
        "actor_role": actor_role,
        "reason": reason,
        "expected_policy_version": snapshot.policy_version,
        "policy": {
            "policy_id": snapshot.policy_id,
            "rule_set_version": snapshot.rule_set_version,
            "rules": rules,
            "disabled_rule_ids": disabled_rule_ids or [],
        },
    }


def test_qc_rules_endpoint_returns_policy_snapshot() -> None:
    client = create_client()

    response = client.get("/qc/rules")
    assert response.status_code == 200
    payload = response.json()
    assert payload["policy"]["policy_id"] == "default-wave2-policy"
    assert len(payload["rules"]) >= 3


def test_qc_evaluate_endpoint_returns_structured_report(tmp_path: Path, monkeypatch) -> None:
    client = create_client()
    pack_root = write_pack_fixture(tmp_path)

    monkeypatch.setattr(
        client.app.state.qc_engine_service,
        "_inspect_mp3_file",
        lambda _path: {"bitrate_kbps": 320, "duration_seconds": 45.0},
    )
    monkeypatch.setattr(
        client.app.state.qc_engine_service,
        "_inspect_peak_with_ffmpeg",
        lambda _path: -1.0,
    )

    response = client.post(
        "/qc/evaluate",
        json={
            "request_id": f"req-{tmp_path.name}",
            "submission_id": f"sub-{tmp_path.name}",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "pack": {
                "pack_name": "Label - Pack",
                "local_pack_path": str(pack_root),
                "declared_top_level_folders": ["Artwork", "Audio", "Demo", "Description"],
                "audio_zip": {"filename": "Label - Pack.zip", "size_bytes": 220000},
                "sample_count": 2,
                "contains_unsupported_name_tokens": False,
            },
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["report"]["status"] == "passed"
    assert payload["report"]["summary"]["blocking_failures"] == 0
    assert payload["applied_policy_id"] == "default-wave2-policy"


def test_qc_results_endpoint_returns_persisted_history(tmp_path: Path, monkeypatch) -> None:
    client = create_client()
    pack_root = write_pack_fixture(tmp_path)

    monkeypatch.setattr(
        client.app.state.qc_engine_service,
        "_inspect_mp3_file",
        lambda _path: {"bitrate_kbps": 320, "duration_seconds": 45.0},
    )
    monkeypatch.setattr(
        client.app.state.qc_engine_service,
        "_inspect_peak_with_ffmpeg",
        lambda _path: -1.0,
    )

    evaluate_payload = {
        "request_id": f"req-history-{tmp_path.name}",
        "submission_id": f"sub-history-{tmp_path.name}",
        "actor_id": "creator-1",
        "actor_role": "creator",
        "pack": {
            "pack_name": "Label - Pack",
            "local_pack_path": str(pack_root),
            "declared_top_level_folders": ["Artwork", "Audio", "Demo", "Description"],
            "audio_zip": {"filename": "Label - Pack.zip", "size_bytes": 220000},
            "sample_count": 2,
            "contains_unsupported_name_tokens": False,
        },
    }
    evaluate = client.post("/qc/evaluate", json=evaluate_payload)
    assert evaluate.status_code == 200
    evaluate_payload_data = evaluate.json()["report"]

    results = client.get(f"/qc/results/sub-history-{tmp_path.name}")
    assert results.status_code == 200
    payload = results.json()
    assert set(payload.keys()) == EXPECTED_QC_RESULTS_KEYS
    assert set(payload["latest"].keys()) == EXPECTED_QC_RUN_KEYS
    assert set(payload["history"][0].keys()) == EXPECTED_QC_RUN_KEYS
    assert payload["latest"]["run_id"] == f"req-history-{tmp_path.name}"
    assert payload["latest"]["submission_id"] == f"sub-history-{tmp_path.name}"
    assert payload["latest"]["status"] == "passed"
    assert payload["latest"]["generated_at"] == evaluate_payload_data["generated_at"]
    assert payload["latest"]["rule_set_version"] == evaluate_payload_data["rule_set_version"]
    assert payload["latest"]["policy_version"] == evaluate_payload_data["policy_version"]
    assert len(payload["history"]) == 1


def test_qc_results_endpoint_returns_deterministic_no_run_envelope() -> None:
    client = create_client()

    response = client.get("/qc/results/sub-no-run")
    assert response.status_code == 200
    payload = response.json()
    expected_latest = {
        "run_id": None,
        "submission_id": None,
        "status": "not_run",
        "started_at": None,
        "completed_at": None,
        "generated_at": None,
        "rule_set_version": None,
        "policy_version": None,
        "findings": [],
    }

    assert set(payload.keys()) == EXPECTED_QC_RESULTS_KEYS
    assert payload == {"latest": expected_latest, "history": []}
    assert set(payload["latest"].keys()) == EXPECTED_QC_RUN_KEYS


def test_qc_evaluate_rejects_invalid_local_pack_path_type() -> None:
    client = create_client()

    response = client.post(
        "/qc/evaluate",
        json={
            "request_id": "req-invalid-1",
            "submission_id": "sub-invalid-1",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "pack": {
                "pack_name": "Label - Pack",
                "local_pack_path": 12345,
                "declared_top_level_folders": ["Artwork", "Audio", "Demo", "Description"],
                "audio_zip": {"filename": "Label - Pack.zip", "size_bytes": 220000},
                "sample_count": 2,
                "contains_unsupported_name_tokens": False,
            },
        },
    )

    assert response.status_code == 422


def test_qc_evaluate_rejects_creator_without_local_pack_path() -> None:
    client = create_client()

    response = client.post(
        "/qc/evaluate",
        json={
            "request_id": "req-missing-path",
            "submission_id": "sub-missing-path",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "pack": {
                "pack_name": "Label - Pack",
                "local_pack_path": None,
                "declared_top_level_folders": ["Artwork", "Audio", "Demo", "Description"],
                "audio_zip": {"filename": "Label - Pack.zip", "size_bytes": 220000},
                "sample_count": 2,
                "contains_unsupported_name_tokens": False,
            },
        },
    )

    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "QC_EVALUATION_NOT_ALLOWED"


def test_admin_policy_update_rejects_non_admin_actor_role() -> None:
    client = create_client()

    response = client.put(
        "/admin/qc/policies/active",
        json={
            "request_id": "req-2",
            "actor_id": "reviewer-1",
            "actor_role": "reviewer",
            "reason": "attempted policy update",
            "expected_policy_version": 1,
            "policy": {
                "policy_id": "default-wave2-policy",
                "rule_set_version": "2026.03.phase1-production",
                "rules": [
                    {
                        "rule_id": "FOLDER_AUDIO_MISSING",
                        "enabled": True,
                        "blocking_override": None,
                    }
                ],
            },
        },
    )

    assert response.status_code == 403
    payload = response.json()
    assert payload["error"]["code"] == "QC_POLICY_FORBIDDEN"


def test_admin_policy_update_returns_audit_and_observability_hooks() -> None:
    client = create_client()

    response = client.put(
        "/admin/qc/policies/active",
        json=build_full_qc_policy_payload(
            client,
            request_id="req-3",
            reason="tune naming warning",
        ),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["policy"]["policy_version"] == 2
    assert payload["audit_hook"]["action"] == "qc.policy.updated.v1"
    assert payload["observability_hook"]["metric_name"] == "qc_policy_update_total"


def test_admin_policy_db_normalization_update_is_persisted_and_used_by_qc(
    tmp_path: Path, monkeypatch
) -> None:
    client = create_client()
    pack_root = write_pack_fixture(tmp_path)

    # Peak chosen to pass default tolerance (0.7 around -1.0dB) and fail strict tolerance (0.2).
    monkeypatch.setattr(
        client.app.state.qc_engine_service,
        "_inspect_mp3_file",
        lambda _path: {"bitrate_kbps": 320, "duration_seconds": 45.0},
    )
    monkeypatch.setattr(
        client.app.state.qc_engine_service,
        "_inspect_peak_with_ffmpeg",
        lambda _path: -1.6,
    )

    base_eval = client.post(
        "/qc/evaluate",
        json={
            "request_id": f"req-policy-propagation-base-{tmp_path.name}",
            "submission_id": f"sub-policy-propagation-base-{tmp_path.name}",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "pack": {
                "pack_name": "Label - Pack",
                "local_pack_path": str(pack_root),
                "declared_top_level_folders": ["Artwork", "Audio", "Demo", "Description"],
                "audio_zip": {"filename": "Label - Pack.zip", "size_bytes": 220000},
                "sample_count": 2,
                "contains_unsupported_name_tokens": False,
            },
        },
    )
    assert base_eval.status_code == 200
    assert base_eval.json()["report"]["status"] == "passed"
    initial_policy_version = base_eval.json()["report"]["policy_version"]

    update_response = client.put(
        "/admin/qc/policies/active",
        json=build_full_qc_policy_payload(
            client,
            request_id=f"req-policy-propagation-update-{tmp_path.name}",
            reason="Tighten demo normalization tolerance",
            mutate_rule_id="DEMO_NORMALIZATION_INVALID",
            mutate_rule_updates={
                "enabled": True,
                "blocking_override": True,
                "params": {
                    "target_peak_db": -1.0,
                    "tolerance_db": 0.2,
                    "strict_enforcement": True,
                },
            },
        ),
    )
    assert update_response.status_code == 200
    assert update_response.json()["policy"]["policy_version"] == initial_policy_version + 1

    connection = client.app.state.qc_rules_registry_service._connection
    persisted = connection.execute(
        """
        SELECT policy_version, rules_json
        FROM qc_policy_versions
        WHERE policy_id = ?
        ORDER BY policy_version DESC
        LIMIT 1
        """,
        ("default-wave2-policy",),
    ).fetchone()
    assert persisted is not None
    assert persisted["policy_version"] == initial_policy_version + 1
    persisted_rules = json.loads(persisted["rules_json"])
    demo_rule = next(
        rule for rule in persisted_rules if rule["rule_id"] == "DEMO_NORMALIZATION_INVALID"
    )
    assert demo_rule["params"]["target_peak_db"] == -1.0
    assert demo_rule["params"]["tolerance_db"] == 0.2
    assert demo_rule["params"]["strict_enforcement"] is True

    post_update_eval = client.post(
        "/qc/evaluate",
        json={
            "request_id": f"req-policy-propagation-post-{tmp_path.name}",
            "submission_id": f"sub-policy-propagation-post-{tmp_path.name}",
            "actor_id": "creator-1",
            "actor_role": "creator",
            "pack": {
                "pack_name": "Label - Pack",
                "local_pack_path": str(pack_root),
                "declared_top_level_folders": ["Artwork", "Audio", "Demo", "Description"],
                "audio_zip": {"filename": "Label - Pack.zip", "size_bytes": 220000},
                "sample_count": 2,
                "contains_unsupported_name_tokens": False,
            },
        },
    )
    assert post_update_eval.status_code == 200
    post_payload = post_update_eval.json()
    assert post_payload["report"]["status"] == "failed"
    assert post_payload["report"]["policy_version"] == initial_policy_version + 1
    assert any(
        finding["rule_id"] == "DEMO_NORMALIZATION_INVALID"
        for finding in post_payload["report"]["findings"]
    )
