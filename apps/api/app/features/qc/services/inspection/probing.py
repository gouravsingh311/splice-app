from __future__ import annotations

import math
import re
import subprocess
from pathlib import Path

from mutagen.mp3 import MP3

from .base import (
    MIN_SAMPLE_BYTES,
)


class InspectionProbingMixin:
    """Low-level file probing (WAV, MP3, FFmpeg)."""

    _FFMPEG_TIMEOUT_SECONDS = 15

    def _inspect_wav_bytes(self, data: bytes) -> dict[str, float | int]:
        if len(data) < MIN_SAMPLE_BYTES:
            raise ValueError("sample smaller than 1KB")

        if data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
            raise ValueError("not a WAV RIFF file")

        channels = 0
        sample_rate = 0
        bits_per_sample = 0
        data_chunk = b""
        offset = 12
        while offset + 8 <= len(data):
            chunk_id = data[offset : offset + 4]
            chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
            chunk_data_start = offset + 8
            chunk_data_end = chunk_data_start + chunk_size
            if chunk_data_end > len(data):
                break

            chunk_data = data[chunk_data_start:chunk_data_end]
            if chunk_id == b"fmt " and len(chunk_data) >= 16:
                channels = int.from_bytes(chunk_data[2:4], "little")
                sample_rate = int.from_bytes(chunk_data[4:8], "little")
                bits_per_sample = int.from_bytes(chunk_data[14:16], "little")
            elif chunk_id == b"data":
                data_chunk = chunk_data

            offset = chunk_data_end + (chunk_size % 2)

        if channels <= 0 or sample_rate <= 0 or bits_per_sample <= 0:
            raise ValueError("invalid WAV metadata")
        bytes_per_sample = bits_per_sample // 8
        if bytes_per_sample <= 0:
            raise ValueError("invalid WAV bit depth")

        frame_size = channels * bytes_per_sample
        if frame_size <= 0 or len(data_chunk) < frame_size:
            raise ValueError("invalid WAV data chunk")

        frame_count = len(data_chunk) // frame_size
        duration_seconds = frame_count / sample_rate

        peak = self._peak_abs_from_pcm(data_chunk, bits_per_sample, channels)
        peak_db = -120.0 if peak <= 0 else 20 * math.log10(peak)

        return {
            "sample_rate": sample_rate,
            "bit_depth": bits_per_sample,
            "duration_seconds": duration_seconds,
            "peak_db": peak_db,
        }

    def _peak_abs_from_pcm(self, data: bytes, bits_per_sample: int, channels: int) -> float:
        if bits_per_sample == 16:
            max_abs = 0
            step = channels * 2
            for offset in range(0, len(data) - step + 1, step):
                for channel in range(channels):
                    idx = offset + (channel * 2)
                    value = int.from_bytes(data[idx : idx + 2], "little", signed=True)
                    max_abs = max(max_abs, abs(value))
            return max_abs / 32768.0

        if bits_per_sample == 24:
            max_abs = 0
            step = channels * 3
            for offset in range(0, len(data) - step + 1, step):
                for channel in range(channels):
                    idx = offset + (channel * 3)
                    sample_bytes = data[idx : idx + 3]
                    sign_byte = b"\xff" if sample_bytes[2] & 0x80 else b"\x00"
                    value = int.from_bytes(
                        sample_bytes + sign_byte,
                        "little",
                        signed=True,
                    )
                    max_abs = max(max_abs, abs(value))
            return max_abs / 8388608.0

        if bits_per_sample == 32:
            max_abs = 0
            step = channels * 4
            for offset in range(0, len(data) - step + 1, step):
                for channel in range(channels):
                    idx = offset + (channel * 4)
                    value = int.from_bytes(data[idx : idx + 4], "little", signed=True)
                    max_abs = max(max_abs, abs(value))
            return max_abs / 2147483648.0

        raise ValueError("unsupported WAV bit depth")

    def _inspect_mp3_file(self, file_path: Path) -> dict[str, float | int]:
        try:
            mp3 = MP3(file_path)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        bitrate = int(round((mp3.info.bitrate or 0) / 1000))
        duration = float(mp3.info.length or 0)
        return {
            "bitrate_kbps": bitrate,
            "duration_seconds": duration,
        }

    def _inspect_peak_with_ffmpeg(self, file_path: Path) -> float | None:
        try:
            process = subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-nostats",
                    "-i",
                    str(file_path),
                    "-af",
                    "volumedetect",
                    "-f",
                    "null",
                    "-",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=self._FFMPEG_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired as exc:
            raise QcInspectionTimeoutError(
                "ffmpeg peak inspection timed out"
            ) from exc

        output = f"{process.stdout}\n{process.stderr}"
        match = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", output)
        if match is None:
            return None
        return float(match.group(1))


class QcInspectionTimeoutError(RuntimeError):
    """Raised when ffmpeg-based inspection does not complete in time."""
