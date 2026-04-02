"""SQLite-backed PRD-05 rules and policy registry."""

from __future__ import annotations

from app.features.qc.contracts import (
    QcRuleDefinition,
    QcSeverity,
)

DEFAULT_RULE_SET_VERSION = "2026.03.phase1-production"
DEFAULT_POLICY_ID = "default-wave2-policy"

METADATA_RULES: tuple[QcRuleDefinition, ...] = (
    QcRuleDefinition(
        rule_id="FOLDER_AUDIO_MISSING",
        title="Audio folder required",
        description="Pack must include an Audio top-level folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="structure",
        remediation="Add an Audio folder at the top level of the pack.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="FOLDER_ARTWORK_MISSING",
        title="Artwork folder required",
        description="Pack must include Artwork or Cover Art top-level folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="structure",
        remediation="Add Artwork or Cover Art at the top level of the pack.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="FOLDER_DEMO_MISSING",
        title="Demo folder required",
        description="Pack must include Demo or Demos top-level folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="structure",
        remediation="Add Demo or Demos at the top level of the pack.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="FOLDER_DESCRIPTION_MISSING",
        title="Description folder required",
        description="Pack must include Description or Description & Info top-level folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="structure",
        remediation="Add Description or Description & Info at the top level of the pack.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DESCRIPTION_LOCATION_INVALID",
        title="Description location invalid",
        description="Description file must be in Description or Description & Info folder.",
        severity=QcSeverity.WARNING,
        blocking=False,
        category="description",
        remediation="Move description file into Description folder.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DESCRIPTION_FORMAT_INVALID",
        title="Description format invalid",
        description="Description file must be .txt or .rtf.",
        severity=QcSeverity.WARNING,
        blocking=False,
        category="description",
        remediation="Export description as .txt or .rtf.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="DESCRIPTION_BANNED_TERM",
        title="Description banned term",
        description="Description content must not include banned terms.",
        severity=QcSeverity.WARNING,
        blocking=False,
        category="description",
        remediation="Remove banned terms from description text.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="ART_LOCATION_INVALID",
        title="Artwork location invalid",
        description="Artwork file must be in Artwork or Cover Art folder.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="artwork",
        remediation="Move artwork into Artwork or Cover Art folder.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="ART_FORMAT_INVALID",
        title="Artwork format invalid",
        description="Artwork file must be JPG or PNG.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="artwork",
        remediation="Convert artwork to JPG or PNG.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="ART_SIZE_EXCEEDED",
        title="Artwork size exceeded",
        description="Artwork file must be 10MB or smaller.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="artwork",
        remediation="Compress artwork to 10MB or less.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="ART_RESOLUTION_OUT_OF_RANGE",
        title="Artwork resolution out of range",
        description="Artwork dimensions must be between 600 and 2000 pixels.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="artwork",
        remediation="Resize artwork to 600-2000px on each side.",
        enabled=True,
    ),

    QcRuleDefinition(
        rule_id="ART_ASPECT_RATIO_NOT_SQUARE",
        title="Artwork aspect ratio not square",
        description="Artwork must be square with 1:1 ratio.",
        severity=QcSeverity.BLOCKING,
        blocking=True,
        category="artwork",
        remediation="Crop artwork to 1:1 aspect ratio.",
        enabled=True,
    ),

)
