"""SQLite-backed PRD-05 rules and policy registry."""

from __future__ import annotations

from app.features.qc.contracts import (
    QcRuleDefinition,
    QcSeverity,
)

DEFAULT_RULE_SET_VERSION = "2026.03.phase1-production"
DEFAULT_POLICY_ID = "default-wave2-policy"

AUDIO_RULES: tuple[QcRuleDefinition, ...] = (
    QcRuleDefinition(
        rule_id="AUDIO_ZIP_FORMAT",
        title="Audio ZIP format",
        description="Audio archive in Audio folder must be a .zip file.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="audio-zip",
        remediation="Ensure Audio folder contains a .zip archive.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="AUDIO_ZIP_LOCATION",
        title="Audio ZIP location",
        description="Audio ZIP must be located inside the Audio top-level folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="audio-zip",
        remediation="Move audio archive into the Audio folder.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="AUDIO_ZIP_NAMING",
        title="Audio ZIP naming",
        description="Audio ZIP filename must match Label Name - Pack Name.zip.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="audio-zip",
        remediation="Rename ZIP to Label Name - Pack Name.zip.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="AUDIO_ZIP_UNSUPPORTED_CHARACTERS",
        title="Audio ZIP unsupported characters",
        description="Audio ZIP filename may only use approved characters.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="audio-zip",
        remediation="Rename ZIP to use letters, numbers, space, _, -, and # only.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="AUDIO_ZIP_SIZE_TOO_SMALL",
        title="Audio ZIP too small",
        description="Audio ZIP must be larger than 100KB.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="audio-zip",
        remediation="Re-export archive so it is larger than 100KB.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="AUDIO_ZIP_SIZE_TOO_LARGE",
        title="Audio ZIP too large",
        description="Audio ZIP must be smaller than 4GB.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="audio-zip",
        remediation="Reduce archive size below 4GB.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_TOP_FOLDER_NAMING",
        title="Sample top folder naming",
        description="Audio ZIP must extract to Label Name - Pack Name top folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Rename extracted top folder to Label Name - Pack Name.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_SUBFOLDER_ONESHOTS_MISSING",
        title="One shots folder required",
        description="Audio ZIP must include a One_Shots subfolder variant.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Add One_Shots folder inside extracted top folder.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_SUBFOLDER_LOOPS_MISSING",
        title="Loops folder required",
        description="Audio ZIP must include a Loops subfolder variant.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Add Loops folder inside extracted top folder.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_COUNT_EXCEEDED",
        title="Sample count exceeded",
        description="Audio ZIP must contain at most 1000 samples.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Reduce total sample files to 1000 or fewer.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_DURATION_EXCEEDED",
        title="Sample duration exceeded",
        description="Each sample must be 3:00 or shorter.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Trim sample durations to 3 minutes or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_RATE_TOO_LOW",
        title="Sample rate too low",
        description="Samples must use sample rate of at least 44.1kHz.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Resample files to at least 44.1kHz.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_RATE_INCONSISTENT",
        title="Sample rate inconsistent",
        description="All samples must use a consistent sample rate.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Use one sample rate across all sample files.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_BIT_DEPTH_INVALID",
        title="Sample bit depth invalid",
        description="Samples must be 16-bit or 24-bit WAV.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Convert WAV files to 16-bit or 24-bit PCM.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_NORMALIZATION_OUT_OF_RANGE",
        title="Sample normalization out of range",
        description="Sample peak should be between -15dB and 0dB.",
        severity=QcSeverity.WARNING,
        blocking=False,
        category="samples",
        remediation="Adjust gain so peaks fall between -15dB and 0dB.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_FORMAT_INVALID",
        title="Sample format invalid",
        description="Sample assets must be WAV files only.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Remove or convert non-WAV sample files.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_DUPLICATE_FOUND",
        title="Duplicate sample found",
        description="Duplicate sample content is not allowed.",
        severity=QcSeverity.WARNING,
        blocking=False,
        category="samples",
        remediation="Remove duplicate sample files.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_CORRUPT_FILE",
        title="Corrupt sample detected",
        description="Corrupt or tiny sample files are not allowed.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Replace corrupt files and remove files smaller than 1KB.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_FILENAME_UNSUPPORTED_CHARACTERS",
        title="Sample filename unsupported characters",
        description="Sample and folder names must use approved characters only.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Rename sample/folder names to use approved characters only.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_FILENAME_BANNED_TERM",
        title="Sample filename banned term",
        description="Sample and folder names must not include banned terms.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Remove banned terms from sample/folder names.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="SAMPLE_FILENAME_FRACTIONAL_BPM",
        title="Sample filename fractional BPM",
        description="Sample names must not include fractional BPM values.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="samples",
        remediation="Rename files to use whole-number BPM values.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DEMO_LOCATION_INVALID",
        title="Demo location invalid",
        description="Demo file must be located in Demo or Demos folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="demo",
        remediation="Move demo file into Demo or Demos folder.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DEMO_FORMAT_INVALID",
        title="Demo format invalid",
        description="Demo file must be MP3.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="demo",
        remediation="Convert demo file to MP3.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DEMO_BITRATE_INVALID",
        title="Demo bitrate invalid",
        description="Demo file must use 320kbps bitrate.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="demo",
        remediation="Re-export demo at 320kbps.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DEMO_SIZE_EXCEEDED",
        title="Demo size exceeded",
        description="Demo file must be 10MB or smaller.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="demo",
        remediation="Reduce demo file size to 10MB or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DEMO_DURATION_EXCEEDED",
        title="Demo duration exceeded",
        description="Demo file must be 3:30 or shorter.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="demo",
        remediation="Trim demo duration to 3:30 or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DEMO_NORMALIZATION_INVALID",
        title="Demo normalization invalid",
        description="Demo peak must be normalized to -1.0dB.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="demo",
        remediation="Normalize demo to -1.0dB peak.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_FILE_TYPE_INVALID",
        title="Preset file type invalid",
        description="Preset files must use a supported extension.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Use a supported preset format.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_FILE_SIZE_OUT_OF_RANGE",
        title="Preset file size out of range",
        description="Preset files must be between 100 bytes and 50MB.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Keep preset file size between 100 bytes and 50MB.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_FILENAME_INVALID",
        title="Preset filename invalid",
        description="Preset filenames must comply with naming policy.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Rename presets to remove unsupported characters/terms.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_PREVIEW_MISSING",
        title="Preset preview missing",
        description="Each preset requires same-name MP3 preview.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Add matching MP3 preview for every preset file.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_PREVIEW_FORMAT_INVALID",
        title="Preset preview format invalid",
        description="Preset preview files must be MP3.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Convert preset previews to MP3.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_PREVIEW_SIZE_EXCEEDED",
        title="Preset preview size exceeded",
        description="Preset preview files must be 5MB or smaller.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Reduce preset preview size to 5MB or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_PREVIEW_DURATION_EXCEEDED",
        title="Preset preview duration exceeded",
        description="Preset preview files must be 1:00 or shorter.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Trim preset preview duration to 1 minute or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_PREVIEW_NORMALIZATION_INVALID",
        title="Preset preview normalization invalid",
        description="Preset preview peak must be -1.0dB.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Normalize preset preview to -1.0dB peak.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="PRESET_PREVIEW_BITRATE_INVALID",
        title="Preset preview bitrate invalid",
        description="Preset preview files must be 320kbps MP3.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="presets",
        remediation="Re-export preset previews at 320kbps.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_FORMAT_INVALID",
        title="MIDI format invalid",
        description="MIDI files must use .mid extension.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Convert MIDI files to .mid.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_TYPE_INVALID",
        title="MIDI type invalid",
        description="MIDI files must be Type 0.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Re-export MIDI files as Type 0.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_PREVIEW_MISSING",
        title="MIDI preview missing",
        description="Each MIDI file requires same-name MP3 preview.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Add matching MP3 preview for every MIDI file.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_PREVIEW_FORMAT_INVALID",
        title="MIDI preview format invalid",
        description="MIDI preview files must be MP3.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Convert MIDI previews to MP3.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_PREVIEW_SIZE_EXCEEDED",
        title="MIDI preview size exceeded",
        description="MIDI preview files must be 5MB or smaller.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Reduce MIDI preview size to 5MB or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_PREVIEW_DURATION_EXCEEDED",
        title="MIDI preview duration exceeded",
        description="MIDI preview files must be 1:00 or shorter.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Trim MIDI preview duration to 1 minute or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_PREVIEW_NORMALIZATION_INVALID",
        title="MIDI preview normalization invalid",
        description="MIDI preview peak must be -1.0dB.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Normalize MIDI preview to -1.0dB peak.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="MIDI_PREVIEW_BITRATE_INVALID",
        title="MIDI preview bitrate invalid",
        description="MIDI preview files must be 320kbps MP3.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="midi",
        remediation="Re-export MIDI previews at 320kbps.",
        enabled=True,
    ),
)
