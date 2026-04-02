"""Airtable synchronization logic and helpers for creator submissions."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.features.creator.contracts import RELEASE_MONTH_PATTERN

logger = get_logger(__name__)

AIRTABLE_TABLE_DEFAULT = "Submissions"
AIRTABLE_VIEW_DEFAULT = "Desktop Completion Lookup v1"
AIRTABLE_FIELD_SUBMISSION_ID = "Submission ID"
AIRTABLE_FIELD_WORKFLOW_STATUS = "Workflow Status"
AIRTABLE_FIELD_NOTIFICATION_DELIVERY_STATUS = "Notification Delivery Status"
AIRTABLE_NOTIFICATION_STATUS_DISABLED = "email_disabled"
AIRTABLE_NOTIFICATION_STATUS_PENDING = "email_pending"
AIRTABLE_NOTIFICATION_STATUS_SENT = "email_sent"
AIRTABLE_NOTIFICATION_STATUS_FAILED = "email_failed"
AIRTABLE_SYNC_STATUSES = frozenset(
    {
        "pending",
        "linked",
        "duplicate_detected",
        "missing_remote",
        "desynced",
        "sync_error",
    }
)

@dataclass(slots=True)
class _MappedAirtableRecord:
    record_id: str
    record_url: str | None
    created_at: str | None
    label_name: str
    pack_name: str
    release_month: str
    notes: str | None
    tags: list[str]
    checksum: str

    @property
    def required_fields_complete(self) -> bool:
        return (
            bool(self.label_name)
            and bool(self.pack_name)
            and bool(self.release_month)
            and bool(re.fullmatch(RELEASE_MONTH_PATTERN, self.release_month))
        )


@dataclass(slots=True)
class _AirtableFetchResult:
    records: list[_MappedAirtableRecord]
    base_id: str
    table_name: str
    view_name: str
    error_code: str | None = None
    error_detail: str | None = None


@dataclass(slots=True)
class _AirtableCreateResult:
    record: _MappedAirtableRecord | None
    base_id: str
    table_name: str
    view_name: str
    error_code: str | None = None
    error_detail: str | None = None


@dataclass(slots=True)
class _AirtableUpdateResult:
    updated: bool
    record_id: str | None
    base_id: str
    table_name: str
    error_code: str | None = None
    error_detail: str | None = None


def _normalize_airtable_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [item.strip() for item in raw.split(",") if item.strip()]

    return []


def _build_airtable_checksum(
    *,
    label_name: str,
    pack_name: str,
    release_month: str,
    notes: str,
    tags: list[str],
) -> str:
    return "::".join(
        (
            label_name.strip(),
            pack_name.strip(),
            release_month.strip(),
            notes.strip(),
            "|".join(tag.strip() for tag in tags if tag.strip()),
        )
    )


def _map_airtable_record(base_id: str, raw_record: dict[str, Any]) -> _MappedAirtableRecord:
    fields = raw_record.get("fields") if isinstance(raw_record.get("fields"), dict) else {}
    label_name = str(fields.get("Label Name") or "").strip()
    pack_name = str(fields.get("Pack Name") or "").strip()
    release_month = str(fields.get("Release Month") or "").strip()
    notes = str(fields.get("Creator Notes") or "").strip() or None
    tags = _normalize_airtable_tags(fields.get("Creator Tags"))
    checksum = _build_airtable_checksum(
        label_name=label_name,
        pack_name=pack_name,
        release_month=release_month,
        notes=notes or "",
        tags=tags,
    )
    record_id = str(raw_record.get("id") or "").strip()
    created_at = (
        str(fields.get("Created At") or raw_record.get("createdTime") or "").strip() or None
    )
    record_url = f"https://airtable.com/{base_id}/{record_id}" if record_id else None
    return _MappedAirtableRecord(
        record_id=record_id,
        record_url=record_url,
        created_at=created_at,
        label_name=label_name,
        pack_name=pack_name,
        release_month=release_month,
        notes=notes,
        tags=tags,
        checksum=checksum,
    )


def _airtable_api_request(
    url: str,
    *,
    api_key: str,
    timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def _airtable_post_request(
    url: str,
    *,
    api_key: str,
    body: dict[str, Any],
    timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    encoded = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=encoded, method="POST")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def _airtable_patch_request(
    url: str,
    *,
    api_key: str,
    body: dict[str, Any],
    timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    encoded = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=encoded, method="PATCH")
    request.add_header("Authorization", f"Bearer {api_key}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def create_airtable_record_for_submission(
    submission_id: str,
    *,
    metadata_row: Any,
) -> _AirtableCreateResult:
    """Create a new Airtable record for this submission using local metadata."""
    api_key = str(os.environ.get("AIRTABLE_API_KEY") or "").strip()
    table_ref = str(os.environ.get("AIRTABLE_SUBMISSIONS_TABLE") or AIRTABLE_TABLE_DEFAULT).strip()
    view_name = str(os.environ.get("AIRTABLE_COMPLETION_VIEW") or AIRTABLE_VIEW_DEFAULT).strip()
    base_id = ""
    table_name = table_ref

    if "/" in table_ref:
        parsed_base_id, parsed_table_ref = table_ref.split("/", 1)
        base_id = parsed_base_id.strip()
        table_name = parsed_table_ref.strip()

    if not api_key:
        return _AirtableCreateResult(
            record=None,
            base_id=base_id or "",
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_AUTH_FAILED",
            error_detail="AIRTABLE_API_KEY is not configured.",
        )
    if not base_id or not table_name:
        return _AirtableCreateResult(
            record=None,
            base_id="",
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail=(
                "AIRTABLE_SUBMISSIONS_TABLE must be configured as "
                "'appXXXXXXXXXXXXXX/tblXXXXXXXXXXXXXX'."
            ),
        )

    pack_name = str(metadata_row["pack_name"] or "").strip() if metadata_row else ""
    label_name = str(metadata_row["label_name"] or "").strip() if metadata_row else ""
    release_month = str(metadata_row["release_month"] or "").strip() if metadata_row else ""
    notes = str(metadata_row["notes"] or "").strip() if metadata_row else ""

    # tags_json parsing
    tags: list[str] = []
    if metadata_row:
        tags_json = metadata_row["tags_json"]
        if tags_json:
            try:
                tags = json.loads(tags_json)
            except json.JSONDecodeError:
                tags = []

    fields: dict[str, Any] = {
        AIRTABLE_FIELD_SUBMISSION_ID: submission_id,
        AIRTABLE_FIELD_WORKFLOW_STATUS: "Draft",
        AIRTABLE_FIELD_NOTIFICATION_DELIVERY_STATUS: AIRTABLE_NOTIFICATION_STATUS_DISABLED,
    }
    if pack_name:
        fields["Pack Name"] = pack_name
    if label_name:
        fields["Label Name"] = label_name
    if release_month:
        fields["Release Month"] = release_month
    if notes:
        fields["Creator Notes"] = notes
    if tags:
        fields["Creator Tags"] = json.dumps(tags, separators=(",", ":"), ensure_ascii=True)

    encoded_table = urllib.parse.quote(table_name, safe="")
    create_url = f"https://api.airtable.com/v0/{base_id}/{encoded_table}"

    try:
        raw = _airtable_post_request(
            create_url,
            api_key=api_key,
            body={"fields": fields},
        )
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        code = "AIRTABLE_UNAVAILABLE"
        if status in {401, 403}:
            code = "AIRTABLE_AUTH_FAILED"
        elif status == 429:
            code = "AIRTABLE_RATE_LIMITED"
        return _AirtableCreateResult(
            record=None,
            base_id=base_id,
            table_name=table_name,
            view_name=view_name,
            error_code=code,
            error_detail=f"Airtable API returned HTTP {status} during create.",
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return _AirtableCreateResult(
            record=None,
            base_id=base_id,
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail=str(exc),
        )

    mapped = _map_airtable_record(base_id, raw)
    return _AirtableCreateResult(
        record=mapped,
        base_id=base_id,
        table_name=table_name,
        view_name=view_name,
    )


def update_airtable_record_fields(
    *,
    base_id: str,
    table_name: str,
    record_id: str,
    fields: dict[str, Any],
) -> _AirtableUpdateResult:
    api_key = str(os.environ.get("AIRTABLE_API_KEY") or "").strip()
    if not api_key:
        return _AirtableUpdateResult(
            updated=False,
            record_id=record_id,
            base_id=base_id,
            table_name=table_name,
            error_code="AIRTABLE_AUTH_FAILED",
            error_detail="AIRTABLE_API_KEY is not configured.",
        )
    if not base_id or not table_name or not record_id:
        return _AirtableUpdateResult(
            updated=False,
            record_id=record_id or None,
            base_id=base_id,
            table_name=table_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail="Airtable update requires base_id, table_name, and record_id.",
        )
    if not fields:
        return _AirtableUpdateResult(
            updated=False,
            record_id=record_id,
            base_id=base_id,
            table_name=table_name,
            error_code=None,
            error_detail=None,
        )

    encoded_table = urllib.parse.quote(table_name, safe="")
    encoded_record = urllib.parse.quote(record_id, safe="")
    request_url = f"https://api.airtable.com/v0/{base_id}/{encoded_table}/{encoded_record}"
    try:
        _airtable_patch_request(
            request_url,
            api_key=api_key,
            body={"fields": fields},
        )
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        code = "AIRTABLE_UNAVAILABLE"
        if status in {401, 403}:
            code = "AIRTABLE_AUTH_FAILED"
        elif status == 429:
            code = "AIRTABLE_RATE_LIMITED"
        elif status == 422:
            code = "AIRTABLE_INVALID_FIELD"
        return _AirtableUpdateResult(
            updated=False,
            record_id=record_id,
            base_id=base_id,
            table_name=table_name,
            error_code=code,
            error_detail=f"Airtable API returned HTTP {status} during update.",
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return _AirtableUpdateResult(
            updated=False,
            record_id=record_id,
            base_id=base_id,
            table_name=table_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail=str(exc),
        )
    return _AirtableUpdateResult(
        updated=True,
        record_id=record_id,
        base_id=base_id,
        table_name=table_name,
    )


def fetch_airtable_records_for_submission(submission_id: str) -> _AirtableFetchResult:
    """Fetch matching records for a submission from Airtable."""
    api_key = str(os.environ.get("AIRTABLE_API_KEY") or "").strip()
    table_ref = str(os.environ.get("AIRTABLE_SUBMISSIONS_TABLE") or AIRTABLE_TABLE_DEFAULT).strip()
    view_name = str(os.environ.get("AIRTABLE_COMPLETION_VIEW") or AIRTABLE_VIEW_DEFAULT).strip()
    base_id = ""
    table_name = table_ref

    if "/" in table_ref:
        parsed_base_id, parsed_table_ref = table_ref.split("/", 1)
        base_id = parsed_base_id.strip()
        table_name = parsed_table_ref.strip()

    if not api_key:
        return _AirtableFetchResult(
            records=[],
            base_id=base_id or "",
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_AUTH_FAILED",
            error_detail="AIRTABLE_API_KEY is not configured.",
        )
    if not base_id or not table_name:
        return _AirtableFetchResult(
            records=[],
            base_id="",
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail=(
                "AIRTABLE_SUBMISSIONS_TABLE must be configured as "
                "'appXXXXXXXXXXXXXX/tblXXXXXXXXXXXXXX'."
            ),
        )

    filter_formula = "{Submission ID}='" + submission_id.replace("'", "\\'") + "'"
    query = urllib.parse.urlencode(
        {
            "view": view_name,
            "filterByFormula": filter_formula,
            "maxRecords": 20,
        }
    )
    encoded_table = urllib.parse.quote(table_name, safe="")
    request_url = f"https://api.airtable.com/v0/{base_id}/{encoded_table}?{query}"

    try:
        payload = _airtable_api_request(request_url, api_key=api_key)
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        code = "AIRTABLE_UNAVAILABLE"
        if status in {401, 403}:
            code = "AIRTABLE_AUTH_FAILED"
        elif status == 429:
            code = "AIRTABLE_RATE_LIMITED"
        return _AirtableFetchResult(
            records=[],
            base_id=base_id,
            table_name=table_name,
            view_name=view_name,
            error_code=code,
            error_detail=f"Airtable API returned HTTP {status}.",
        )
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        return _AirtableFetchResult(
            records=[],
            base_id=base_id,
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail=str(exc),
        )

    raw_records = payload.get("records")
    if not isinstance(raw_records, list):
        return _AirtableFetchResult(
            records=[],
            base_id=base_id,
            table_name=table_name,
            view_name=view_name,
            error_code="AIRTABLE_UNAVAILABLE",
            error_detail="Airtable response is missing records[].",
        )

    mapped_records = [
        _map_airtable_record(base_id, item)
        for item in raw_records
        if isinstance(item, dict)
    ]
    return _AirtableFetchResult(
        records=mapped_records,
        base_id=base_id,
        table_name=table_name,
        view_name=view_name,
    )
