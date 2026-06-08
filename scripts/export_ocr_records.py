#!/usr/bin/env python3
"""Export post-OCR topper answer records from per-PDF OCR aggregates.

This script is intentionally stdlib-only and API-free.  It consumes aggregate
JSON files written by ``scripts/full_openai_ocr.py`` (normally under
``/Volumes/Acer/open-topper/extracted_data/ocr_openai/pdfs``) and writes private
record exports under ``records/``:

* ``topper-answer-records.jsonl`` (always emitted)
* ``topper-answer-records.json`` when JSON output is requested
* ``topper-answer-records.xml`` when XML output is requested
* ``export-summary.json`` (always emitted)

The JSONL/JSON/XML record schema is kept flat at the top level for downstream
indexers while preserving nested aggregate fields such as PYQ hints and known
project mappings.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from collections.abc import Iterable, Iterator, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
REPO_OCR_ROOT = ROOT / "extracted_data" / "ocr_openai"
ACER_PROJECT_ROOT = Path("/Volumes/Acer/open-topper")
ACER_OCR_ROOT = ACER_PROJECT_ROOT / "extracted_data" / "ocr_openai"
DEFAULT_PRIVATE_OCR_ROOT = ACER_OCR_ROOT if ACER_PROJECT_ROOT.exists() else REPO_OCR_ROOT
DEFAULT_OCR_DIR = DEFAULT_PRIVATE_OCR_ROOT / "pdfs"
DEFAULT_OUTPUT_DIR = DEFAULT_PRIVATE_OCR_ROOT / "records"

SCHEMA_VERSION = "topper-answer-ocr-record.v1"
EXPORTER_NAME = "scripts/export_ocr_records.py"

COMPACT_JSON_KWARGS = {
    "ensure_ascii": False,
    "sort_keys": True,
    "separators": (",", ":"),
}
PRETTY_JSON_KWARGS = {
    "ensure_ascii": False,
    "sort_keys": True,
    "indent": 2,
}

PLACEHOLDER_QUESTION_PATTERNS = [
    re.compile(r"^\s*$", re.I),
    re.compile(r"^\s*(?:n/?a|none|null|unknown|unavailable)\s*$", re.I),
    re.compile(r"^\s*q(?:uestion)?\s*\d*[a-z]?\s*$", re.I),
    re.compile(r"question starts not confidently detected", re.I),
    re.compile(r"no question starts? (?:confidently )?detected", re.I),
]

XML_ITEM_TAGS = {
    "page_refs": "page_ref",
    "pyq_mapping_hints": "pyq_mapping_hint",
    "known_project_mappings": "known_project_mapping",
    "value_additions": "value_addition",
    "examiner_remarks": "examiner_remark",
    "diagrams": "diagram",
    "maps": "map",
    "flowcharts": "flowchart",
    "marks_or_scores": "marks_or_score",
    "validation_errors": "validation_error",
    "topper_sources": "topper_source",
    "illegible_regions": "illegible_region",
    "question_starts": "question_start",
}

VALID_RECORD_RULES = [
    "valid_record is true only for emitted records; records filtered by --min-confidence are not emitted and are counted separately.",
    "A valid record must have a stable source identity (pdf_id, sha256, drive_id, pdf_path, or aggregate filename stem).",
    "A valid record must have at least one page_refs entry.",
    "A valid record must have non-empty full_answer_markdown after whitespace trimming.",
    "A valid record must have meaningful question_text; empty placeholders such as 'Question starts not confidently detected' are emitted but not counted as valid records.",
]

PRIVATE_OUTPUT_RULES = [
    f"Default OCR aggregate/export roots resolve under {ACER_OCR_ROOT} when Acer is mounted, otherwise {REPO_OCR_ROOT}.",
    "Raw OCR-derived records are private ingestion artifacts; do not write them under public/, data/app/, or data/pdf-runtime/.",
    "The OCR aggregate input and record output directories must be inside the private Acer/repo OCR root.",
]


class ExportError(RuntimeError):
    """Raised for invalid CLI state or unrecoverable export setup errors."""


class ExportGateError(ExportError):
    """Raised when export quality/count gates fail after files are written."""


class AtomicWriter:
    """Small helper for atomic text output in the destination directory."""

    def __init__(self, final_path: Path):
        self.final_path = final_path
        self.tmp_path: Path | None = None
        self.handle: TextIO | None = None

    def __enter__(self) -> TextIO:
        self.final_path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{self.final_path.name}.",
            suffix=".tmp",
            dir=str(self.final_path.parent),
            text=True,
        )
        self.tmp_path = Path(tmp_name)
        self.handle = os.fdopen(fd, "w", encoding="utf-8", newline="\n")
        return self.handle

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self.handle:
            self.handle.close()
        if exc_type is None and self.tmp_path is not None:
            os.replace(self.tmp_path, self.final_path)
        elif self.tmp_path is not None:
            with contextlib.suppress(FileNotFoundError):
                self.tmp_path.unlink()


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.replace("\u00a0", " ").strip()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value).replace("\u00a0", " ").strip()


def nullable_str(value: Any) -> str | None:
    text = safe_str(value)
    return text if text else None


def first_nonempty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            if value.strip():
                return value.strip()
            continue
        if isinstance(value, (list, dict, tuple, set)):
            if len(value) > 0:
                return value
            continue
        return value
    return None


def ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return [value]
    if isinstance(value, str):
        stripped = value.strip()
        return [stripped] if stripped else []
    return [value]


def ensure_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def coerce_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return int(value)
        return None
    text = safe_str(value)
    if not text:
        return None
    match = re.search(r"-?\d+", text)
    if not match:
        return None
    with contextlib.suppress(ValueError):
        return int(match.group(0))
    return None


def coerce_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    text = safe_str(value)
    if not text:
        return None
    with contextlib.suppress(ValueError):
        number = float(text)
        return number if math.isfinite(number) else None
    return None


def clamp_confidence(value: Any) -> float | None:
    number = coerce_float(value)
    if number is None:
        return None
    return round(max(0.0, min(1.0, number)), 4)


def compact_whitespace(value: Any) -> str:
    return re.sub(r"\s+", " ", safe_str(value)).strip()


def is_meaningful_question_text(value: Any) -> bool:
    text = compact_whitespace(value)
    if not text:
        return False
    if any(pattern.search(text) for pattern in PLACEHOLDER_QUESTION_PATTERNS):
        return False
    alpha_count = sum(1 for ch in text if ch.isalpha())
    if alpha_count < 8 and len(text) < 20:
        return False
    return True


def normalize_json_value(value: Any) -> Any:
    """Keep values JSON-compatible and deterministic without losing content."""

    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and not math.isfinite(value):
            return None
        return value
    if isinstance(value, Mapping):
        return {safe_str(k): normalize_json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [normalize_json_value(item) for item in value]
    return safe_str(value)


def read_json_file(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def aggregate_from_file(path: Path) -> dict[str, Any]:
    data = read_json_file(path)
    if isinstance(data, Mapping):
        return dict(data)
    if isinstance(data, list):
        return {
            "pdf_id": path.stem,
            "questions": data,
            "_aggregate_shape_note": "top-level list treated as questions",
        }
    return {
        "pdf_id": path.stem,
        "questions": [],
        "_aggregate_shape_note": f"unsupported top-level {type(data).__name__}",
    }


def extract_pages(aggregate: Mapping[str, Any]) -> list[dict[str, Any]]:
    candidates = first_nonempty(
        aggregate.get("full_ocr_pages"),
        aggregate.get("ocr_pages"),
        aggregate.get("pages"),
        aggregate.get("page_ocr"),
        aggregate.get("full_pages"),
    )
    raw_pages: list[Any]
    if isinstance(candidates, Mapping):
        raw_pages = []
        for key, value in candidates.items():
            if isinstance(value, Mapping):
                page = dict(value)
                page.setdefault("page_number", key)
                raw_pages.append(page)
    else:
        raw_pages = ensure_list(candidates)

    pages: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_pages, start=1):
        if isinstance(raw, Mapping):
            page = dict(raw)
        else:
            page = {"markdown": safe_str(raw)}
        page_number_source = first_nonempty(
            page.get("page_number"),
            page.get("page"),
            page.get("page_no"),
            page.get("pageIndex"),
            page.get("page_index"),
        )
        page_number = coerce_int(page_number_source)
        has_zero_based_page_index = (
            page.get("page_number") is None
            and page.get("page") is None
            and page.get("page_no") is None
            and ("pageIndex" in page or "page_index" in page)
        )
        if page_number is not None and has_zero_based_page_index:
            # Common zero-based pageIndex/page_index form.
            page_number += 1
        if page_number is None:
            page_number = index
        markdown = safe_str(
            first_nonempty(
                page.get("markdown"),
                page.get("ocr_markdown"),
                page.get("text"),
                page.get("content"),
                page.get("transcription"),
            )
        )
        pages.append(
            {
                "page_number": page_number,
                "markdown": markdown,
                "confidence": clamp_confidence(
                    first_nonempty(page.get("confidence"), page.get("ocr_confidence"), page.get("quality"))
                ),
                "visible_metadata": normalize_json_value(ensure_dict(page.get("visible_metadata"))),
                "question_starts": normalize_json_value(ensure_list(page.get("question_starts"))),
                "answer_signals": normalize_json_value(ensure_dict(page.get("answer_signals"))),
                "illegible_regions": normalize_json_value(ensure_list(page.get("illegible_regions"))),
            }
        )

    deduped: dict[int, dict[str, Any]] = {}
    for page in pages:
        number = int(page["page_number"])
        existing = deduped.get(number)
        if existing is None or (not existing.get("markdown") and page.get("markdown")):
            deduped[number] = page
    return [deduped[key] for key in sorted(deduped)]


def page_count_from(aggregate: Mapping[str, Any], pages: list[dict[str, Any]]) -> int | None:
    count = coerce_int(first_nonempty(aggregate.get("page_count"), aggregate.get("pages_total"), aggregate.get("num_pages")))
    if count is not None and count > 0:
        return count
    if pages:
        return max(int(page["page_number"]) for page in pages)
    return None


def extract_question_list(aggregate: Mapping[str, Any]) -> list[Any]:
    return ensure_list(
        first_nonempty(
            aggregate.get("questions"),
            aggregate.get("answer_records"),
            aggregate.get("answers"),
            aggregate.get("records"),
            aggregate.get("question_index"),
        )
    )


def page_numbers_from_refs(value: Any) -> list[int]:
    numbers: list[int] = []
    for item in ensure_list(value):
        if isinstance(item, Mapping):
            number = coerce_int(first_nonempty(item.get("page_number"), item.get("page"), item.get("page_no")))
        else:
            number = coerce_int(item)
        if number is not None:
            numbers.append(number)
    return sorted(set(number for number in numbers if number > 0))


def normalize_questions(
    aggregate: Mapping[str, Any],
    pages: list[dict[str, Any]],
    page_count: int | None,
) -> list[dict[str, Any]]:
    raw_questions = extract_question_list(aggregate)
    if not raw_questions:
        first_page = min((int(page["page_number"]) for page in pages), default=1 if page_count else None)
        last_page = page_count or max((int(page["page_number"]) for page in pages), default=first_page)
        if first_page is None and last_page is None:
            return []
        return [
            {
                "raw": {},
                "ordinal": 1,
                "question_number": None,
                "question_text": "Question starts not confidently detected",
                "start_page": first_page,
                "end_page": last_page,
                "confidence": clamp_confidence(aggregate.get("ocr_confidence")),
                "fallback_question": True,
            }
        ]

    normalized: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_questions, start=1):
        if isinstance(raw, Mapping):
            question = dict(raw)
        else:
            question = {"question_text": safe_str(raw)}

        q_page_numbers = page_numbers_from_refs(
            first_nonempty(question.get("page_refs"), question.get("pages"), question.get("page_numbers"))
        )
        start_page = coerce_int(
            first_nonempty(
                question.get("start_page"),
                question.get("page_start"),
                question.get("from_page"),
                question.get("page_number"),
                question.get("page"),
                question.get("pageNormalized"),
                min(q_page_numbers) if q_page_numbers else None,
            )
        )
        end_page = coerce_int(
            first_nonempty(
                question.get("end_page"),
                question.get("page_end"),
                question.get("to_page"),
                question.get("last_page"),
                max(q_page_numbers) if q_page_numbers else None,
            )
        )
        normalized.append(
            {
                "raw": question,
                "ordinal": index,
                "question_number": nullable_str(
                    first_nonempty(question.get("question_number"), question.get("number"), question.get("q_no"), question.get("qid"))
                ),
                "question_text": safe_str(
                    first_nonempty(
                        question.get("question_text"),
                        question.get("question"),
                        question.get("prompt"),
                        question.get("extractedQuestion"),
                        question.get("title"),
                    )
                ),
                "start_page": start_page,
                "end_page": end_page,
                "confidence": clamp_confidence(
                    first_nonempty(question.get("confidence"), question.get("question_confidence"), question.get("matchConfidence"))
                ),
                "fallback_question": False,
            }
        )

    # Infer missing end pages from the next known start page.  Preserve original
    # ordinals for stable record IDs, but use page order for span inference.
    by_page_order = sorted(
        normalized,
        key=lambda q: (
            q["start_page"] if q["start_page"] is not None else 10**9,
            q["ordinal"],
        ),
    )
    known_starts = [q["start_page"] for q in by_page_order if q["start_page"] is not None]
    default_first_page = min((int(page["page_number"]) for page in pages), default=1)
    default_last_page = page_count or max((int(page["page_number"]) for page in pages), default=default_first_page)

    for question in normalized:
        if question["start_page"] is None:
            question["start_page"] = default_first_page if len(normalized) == 1 else None
        start_page = question["start_page"]
        if question["end_page"] is None and start_page is not None:
            next_starts = [start for start in known_starts if start is not None and start > start_page]
            question["end_page"] = max(start_page, min(next_starts) - 1) if next_starts else default_last_page
        if question["start_page"] is not None and question["end_page"] is not None:
            if question["end_page"] < question["start_page"]:
                question["end_page"] = question["start_page"]
            if page_count:
                question["start_page"] = max(1, min(page_count, question["start_page"]))
                question["end_page"] = max(question["start_page"], min(page_count, question["end_page"]))

    return normalized


def selected_pages_for_question(
    pages: list[dict[str, Any]],
    start_page: int | None,
    end_page: int | None,
) -> list[dict[str, Any]]:
    if not pages:
        return []
    if start_page is None and end_page is None:
        return pages
    if start_page is None:
        start_page = end_page
    if end_page is None:
        end_page = start_page
    if start_page is None or end_page is None:
        return pages
    return [page for page in pages if start_page <= int(page["page_number"]) <= end_page]


def build_page_refs(
    pdf_id: str | None,
    pdf_path: str | None,
    selected_pages: list[dict[str, Any]],
    start_page: int | None,
    end_page: int | None,
) -> list[dict[str, Any]]:
    numbers: list[int] = [int(page["page_number"]) for page in selected_pages]
    if start_page is not None:
        end = end_page if end_page is not None else start_page
        if end >= start_page and end - start_page <= 5000:
            numbers.extend(range(start_page, end + 1))
        else:
            numbers.append(start_page)

    page_by_number = {int(page["page_number"]): page for page in selected_pages}
    refs: list[dict[str, Any]] = []
    for number in sorted(set(n for n in numbers if n and n > 0)):
        page = page_by_number.get(number, {})
        refs.append(
            {
                "pdf_id": pdf_id,
                "pdf_path": pdf_path,
                "page_number": number,
                "page_label": f"{pdf_id or pdf_path or 'pdf'}#page={number}",
                "ocr_confidence": page.get("confidence"),
            }
        )
    return refs


def build_full_answer_markdown(question: Mapping[str, Any], selected_pages: list[dict[str, Any]]) -> tuple[str, str]:
    raw = ensure_dict(question.get("raw"))
    explicit = safe_str(
        first_nonempty(
            raw.get("full_answer_markdown"),
            raw.get("answer_markdown"),
            raw.get("full_markdown"),
            raw.get("markdown"),
            raw.get("ocr_markdown"),
            raw.get("answer_text"),
        )
    )
    if explicit:
        return explicit.rstrip() + "\n", "question_field"

    chunks: list[str] = []
    for page in selected_pages:
        page_number = page.get("page_number")
        markdown = safe_str(page.get("markdown"))
        if markdown:
            chunks.extend([f"### Page {page_number}", "", markdown.rstrip(), ""])
    if chunks:
        return "\n".join(chunks).rstrip() + "\n", "page_ocr"
    return "", "missing"


def average_confidence(values: Iterable[Any]) -> float | None:
    numbers = [number for number in (clamp_confidence(value) for value in values) if number is not None]
    if not numbers:
        return None
    return round(sum(numbers) / len(numbers), 4)


def choose_record_confidence(
    question: Mapping[str, Any],
    selected_pages: list[dict[str, Any]],
    aggregate: Mapping[str, Any],
) -> float | None:
    return clamp_confidence(
        first_nonempty(
            question.get("confidence"),
            average_confidence(page.get("confidence") for page in selected_pages),
            aggregate.get("ocr_confidence"),
            aggregate.get("confidence"),
        )
    )


def stable_record_id(
    document_identity: str,
    question_number: str | None,
    start_page: int | None,
    end_page: int | None,
    ordinal: int,
) -> str:
    payload = {
        "document_identity": document_identity,
        "question_number": question_number or "",
        "start_page": start_page,
        "end_page": end_page,
        "ordinal": ordinal,
        "schema_version": SCHEMA_VERSION,
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    return f"ocr_{digest[:20]}"


def aggregate_identity(aggregate: Mapping[str, Any], aggregate_path: Path) -> tuple[str | None, str]:
    pdf_id = nullable_str(first_nonempty(aggregate.get("pdf_id"), aggregate.get("id"), aggregate.get("document_id")))
    source_pdf = ensure_dict(aggregate.get("source_pdf"))
    identity = nullable_str(
        first_nonempty(
            aggregate.get("source_identity"),
            source_pdf.get("identity_key"),
            aggregate.get("sha256"),
            source_pdf.get("sha256"),
            pdf_id,
            aggregate.get("drive_id"),
            aggregate.get("pdf_path"),
            aggregate.get("source_url"),
            aggregate_path.stem,
        )
    )
    return pdf_id, identity or aggregate_path.stem


def extract_topper(aggregate: Mapping[str, Any]) -> dict[str, Any]:
    topper = ensure_dict(aggregate.get("topper"))
    return {
        "name": nullable_str(first_nonempty(topper.get("name"), aggregate.get("topper_name"), aggregate.get("topperName"))),
        "confidence": clamp_confidence(topper.get("confidence")),
        "sources": normalize_json_value(ensure_list(topper.get("sources"))),
    }


def extract_exam_metadata(aggregate: Mapping[str, Any]) -> dict[str, Any]:
    exam = ensure_dict(first_nonempty(aggregate.get("exam_metadata"), aggregate.get("exam"), aggregate.get("metadata")))
    fields = [
        "exam",
        "test_name",
        "paper",
        "year",
        "institute",
        "subject",
        "optional_subject",
        "marks",
        "rank",
    ]
    result: dict[str, Any] = {}
    for field in fields:
        value = first_nonempty(exam.get(field), aggregate.get(field))
        result[field] = normalize_json_value(value) if value is not None else None
    for key, value in exam.items():
        result.setdefault(safe_str(key), normalize_json_value(value))
    return result


def list_from_question_or_aggregate(
    question_raw: Mapping[str, Any],
    aggregate: Mapping[str, Any],
    *keys: str,
) -> list[Any]:
    for key in keys:
        if key in question_raw:
            return normalize_json_value(ensure_list(question_raw.get(key)))
    for key in keys:
        if key in aggregate:
            return normalize_json_value(ensure_list(aggregate.get(key)))
    return []


def scalar_from_question_or_aggregate(
    question_raw: Mapping[str, Any],
    aggregate: Mapping[str, Any],
    *keys: str,
) -> Any:
    for key in keys:
        value = question_raw.get(key)
        if value not in (None, ""):
            return normalize_json_value(value)
    for key in keys:
        value = aggregate.get(key)
        if value not in (None, ""):
            return normalize_json_value(value)
    return None


def has_upsc_signal(record: Mapping[str, Any]) -> bool:
    source_pdf = ensure_dict(record.get("source_pdf"))
    exam_metadata = ensure_dict(record.get("exam_metadata"))
    haystack = " ".join(
        safe_str(value)
        for value in [
            record.get("source_site"),
            record.get("pdf_path"),
            record.get("source_url"),
            record.get("paper"),
            record.get("test_name"),
            record.get("institute"),
            record.get("question_text"),
            source_pdf.get("rel_path"),
            source_pdf.get("path"),
            exam_metadata.get("exam"),
            exam_metadata.get("paper"),
            exam_metadata.get("test_name"),
            exam_metadata.get("institute"),
        ]
    ).lower()
    return bool(
        re.search(
            r"\b(upsc|cse|mains?|main\s+examination|general\s+studies|gs[1-4]?|essay|optional|"
            r"anthropology|geography|history|psir|political\s+science|public\s+administration|"
            r"sociology|ethics|vajiram|next\s*ias|vision\s*ias|dr\.?\s*shivin|shubhra)\b",
            haystack,
        )
    )


def validate_record(
    record: Mapping[str, Any],
    document_identity: str | None,
    *,
    strict_complete: bool = False,
    strict_upsc: bool = False,
) -> tuple[bool, list[str]]:
    errors: list[str] = []
    if not document_identity:
        errors.append("missing_source_identity")
    if not ensure_list(record.get("page_refs")):
        errors.append("missing_page_refs")
    if not safe_str(record.get("full_answer_markdown")):
        errors.append("missing_full_answer_markdown")
    if not is_meaningful_question_text(record.get("question_text")):
        errors.append("missing_or_placeholder_question_text")
    if strict_complete:
        if safe_str(record.get("aggregate_status")).lower() != "done":
            errors.append("aggregate_not_done")
        pages_failed = coerce_int(record.get("pages_failed"))
        if pages_failed not in (None, 0):
            errors.append("aggregate_has_failed_pages")
        page_count = coerce_int(record.get("page_count"))
        pages_completed = coerce_int(record.get("pages_completed"))
        if page_count is not None and pages_completed != page_count:
            errors.append("aggregate_incomplete_pages")
    if strict_upsc and not has_upsc_signal(record):
        errors.append("missing_upsc_signal")
    return not errors, errors


def build_records_for_aggregate(
    aggregate_path: Path,
    aggregate: Mapping[str, Any],
    *,
    strict_complete: bool = False,
    strict_upsc: bool = False,
) -> Iterator[dict[str, Any]]:
    pages = extract_pages(aggregate)
    page_count = page_count_from(aggregate, pages)
    questions = normalize_questions(aggregate, pages, page_count)
    pdf_id, document_identity = aggregate_identity(aggregate, aggregate_path)
    pdf_path = nullable_str(
        first_nonempty(
            aggregate.get("pdf_path"),
            ensure_dict(aggregate.get("source_pdf")).get("rel_path"),
            aggregate.get("source_path"),
        )
    )
    source_pdf = normalize_json_value(ensure_dict(aggregate.get("source_pdf")))
    topper = extract_topper(aggregate)
    exam_metadata = extract_exam_metadata(aggregate)
    overall_summary = normalize_json_value(
        first_nonempty(
            aggregate.get("overall_summary"),
            aggregate.get("pdf_summary"),
            aggregate.get("document_summary"),
            aggregate.get("aggregate_summary"),
            aggregate.get("summary"),
        )
    )

    for question in questions:
        raw = ensure_dict(question.get("raw"))
        start_page = coerce_int(question.get("start_page"))
        end_page = coerce_int(question.get("end_page"))
        selected_pages = selected_pages_for_question(pages, start_page, end_page)
        page_ref_details = build_page_refs(pdf_id, pdf_path, selected_pages, start_page, end_page)
        page_refs = [int(ref["page_number"]) for ref in page_ref_details if coerce_int(ref.get("page_number")) is not None]
        markdown, markdown_source = build_full_answer_markdown(question, selected_pages)
        confidence = choose_record_confidence(question, selected_pages, aggregate)
        question_text = safe_str(question.get("question_text"))
        record_id = stable_record_id(
            document_identity=document_identity,
            question_number=nullable_str(question.get("question_number")),
            start_page=start_page,
            end_page=end_page,
            ordinal=int(question.get("ordinal") or 0),
        )
        record: dict[str, Any] = {
            "record_id": record_id,
            "schema_version": SCHEMA_VERSION,
            "record_ordinal": int(question.get("ordinal") or 0),
            "pdf_id": pdf_id,
            "drive_id": nullable_str(aggregate.get("drive_id")),
            "pdf_path": pdf_path,
            "source_pdf": source_pdf,
            "source_identity": nullable_str(first_nonempty(aggregate.get("source_identity"), ensure_dict(aggregate.get("source_pdf")).get("identity_key"))),
            "input_provenance": normalize_json_value(ensure_dict(aggregate.get("input_provenance"))),
            "duplicate_rel_paths": normalize_json_value(ensure_list(aggregate.get("duplicate_rel_paths"))),
            "source_site": nullable_str(aggregate.get("source_site")),
            "source_url": nullable_str(aggregate.get("source_url")),
            "sha256": nullable_str(aggregate.get("sha256")),
            "aggregate_file": str(aggregate_path),
            "aggregate_status": nullable_str(aggregate.get("status")),
            "aggregate_generated_at": nullable_str(aggregate.get("generated_at")),
            "model": nullable_str(aggregate.get("model")),
            "prompt_version": nullable_str(aggregate.get("prompt_version")),
            "page_count": page_count,
            "pages_completed": coerce_int(aggregate.get("pages_completed")),
            "pages_failed": coerce_int(aggregate.get("pages_failed")),
            "topper_name": topper.get("name"),
            "rank": first_nonempty(exam_metadata.get("rank"), aggregate.get("rank")),
            "exam_year": first_nonempty(exam_metadata.get("year"), aggregate.get("exam_year"), aggregate.get("year")),
            "institute": first_nonempty(exam_metadata.get("institute"), aggregate.get("institute")),
            "paper": first_nonempty(exam_metadata.get("paper"), aggregate.get("paper")),
            "test_name": first_nonempty(exam_metadata.get("test_name"), aggregate.get("test_name")),
            "topper": topper,
            "exam_metadata": exam_metadata,
            "question_number": nullable_str(question.get("question_number")),
            "question_text": question_text,
            "question_text_status": "available" if is_meaningful_question_text(question_text) else "missing_or_placeholder",
            "start_page": start_page,
            "end_page": end_page,
            "page_refs": page_refs,
            "page_ref_details": page_ref_details,
            "full_answer_markdown": markdown,
            "full_answer_markdown_source": markdown_source,
            "overall_summary": overall_summary,
            "answer_summary": scalar_from_question_or_aggregate(raw, aggregate, "answer_summary", "summary"),
            "value_additions": list_from_question_or_aggregate(raw, aggregate, "value_additions", "valueAdds", "value_adds"),
            "examiner_remarks": list_from_question_or_aggregate(raw, aggregate, "examiner_remarks", "remarks", "comments"),
            "diagrams": list_from_question_or_aggregate(raw, aggregate, "diagrams", "diagram_assets"),
            "maps": list_from_question_or_aggregate(raw, aggregate, "maps"),
            "flowcharts": list_from_question_or_aggregate(raw, aggregate, "flowcharts"),
            "marks_or_scores": list_from_question_or_aggregate(raw, aggregate, "marks_or_scores", "marks", "scores"),
            "pyq_mapping_hints": list_from_question_or_aggregate(
                raw,
                aggregate,
                "pyq_mapping_hints",
                "pyq_hints",
                "pyqMappingHints",
            ),
            "known_project_mappings": list_from_question_or_aggregate(
                raw,
                aggregate,
                "known_project_mappings",
                "known_mappings",
                "knownProjectMappings",
            ),
            "confidence": confidence,
            "extraction_confidence": confidence,
            "ocr_confidence": clamp_confidence(first_nonempty(aggregate.get("ocr_confidence"), average_confidence(page.get("confidence") for page in selected_pages))),
            "valid_record": False,
            "validation_errors": [],
        }
        valid, errors = validate_record(
            record,
            document_identity,
            strict_complete=strict_complete,
            strict_upsc=strict_upsc,
        )
        record["valid_record"] = valid
        record["validation_errors"] = errors
        yield record


def parse_formats(values: list[str] | None) -> set[str]:
    if not values:
        return {"jsonl", "json", "xml"}
    formats: set[str] = {"jsonl"}
    for value in values:
        for item in value.split(","):
            item = item.strip().lower()
            if not item:
                continue
            if item == "all":
                formats.update({"jsonl", "json", "xml"})
            elif item in {"jsonl", "json", "xml"}:
                formats.add(item)
            else:
                raise ExportError(f"Unsupported --format value: {item!r}")
    return formats


def write_record_json(handle: TextIO, record: Mapping[str, Any]) -> None:
    handle.write(json.dumps(record, **COMPACT_JSON_KWARGS))


def xml_tag(name: Any) -> str:
    tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", safe_str(name) or "field").strip("._-")
    if not tag:
        tag = "field"
    if not re.match(r"^[A-Za-z_]", tag):
        tag = f"field_{tag}"
    # Avoid names that can be confused with XML declarations.
    if tag.lower().startswith("xml"):
        tag = f"field_{tag}"
    return tag


def xml_item_tag(parent_tag: str) -> str:
    if parent_tag in XML_ITEM_TAGS:
        return XML_ITEM_TAGS[parent_tag]
    if parent_tag.endswith("ies") and len(parent_tag) > 3:
        return parent_tag[:-3] + "y"
    if parent_tag.endswith("s") and len(parent_tag) > 1:
        return parent_tag[:-1]
    return "item"


def xml_safe_text(value: Any) -> str:
    text = safe_str(value)
    if not text:
        return ""

    def allowed(ch: str) -> bool:
        code = ord(ch)
        return (
            code in (0x09, 0x0A, 0x0D)
            or 0x20 <= code <= 0xD7FF
            or 0xE000 <= code <= 0xFFFD
            or 0x10000 <= code <= 0x10FFFF
        )

    return "".join(ch for ch in text if allowed(ch))


def add_xml_value(parent: ET.Element, key: str, value: Any) -> None:
    tag = xml_tag(key)
    element = ET.SubElement(parent, tag)
    if value is None:
        element.set("nil", "true")
    elif isinstance(value, bool):
        element.text = "true" if value else "false"
    elif isinstance(value, (str, int, float)):
        element.text = xml_safe_text(value)
    elif isinstance(value, Mapping):
        for child_key, child_value in value.items():
            add_xml_value(element, safe_str(child_key), child_value)
    elif isinstance(value, list):
        item_tag = xml_item_tag(tag)
        for item in value:
            if isinstance(item, Mapping):
                item_element = ET.SubElement(element, item_tag)
                for child_key, child_value in item.items():
                    add_xml_value(item_element, safe_str(child_key), child_value)
            else:
                add_xml_value(element, item_tag, item)
    else:
        element.text = xml_safe_text(value)


def record_to_xml(record: Mapping[str, Any]) -> str:
    element = ET.Element("record")
    for key, value in record.items():
        add_xml_value(element, key, value)
    ET.indent(element, space="  ")
    return ET.tostring(element, encoding="unicode", short_empty_elements=True)


def summary_to_xml(summary: Mapping[str, Any]) -> str:
    element = ET.Element("export_summary")
    for key, value in summary.items():
        add_xml_value(element, key, value)
    ET.indent(element, space="  ")
    return ET.tostring(element, encoding="unicode", short_empty_elements=True)


def init_counts() -> dict[str, int]:
    return {
        "aggregates_found": 0,
        "aggregates_processed": 0,
        "aggregate_read_errors": 0,
        "records_seen": 0,
        "records_emitted": 0,
        "valid_records": 0,
        "invalid_records": 0,
        "filtered_low_confidence": 0,
        "records_with_pyq_hints": 0,
        "records_with_known_mappings": 0,
        "records_with_page_ocr_markdown": 0,
        "records_with_question_field_markdown": 0,
        "records_missing_markdown": 0,
    }


def output_paths(output_dir: Path) -> dict[str, Path]:
    return {
        "jsonl": output_dir / "topper-answer-records.jsonl",
        "json": output_dir / "topper-answer-records.json",
        "xml": output_dir / "topper-answer-records.xml",
        "summary": output_dir / "export-summary.json",
    }


def build_summary(
    *,
    generated_at: str,
    args: argparse.Namespace,
    formats: set[str],
    counts: Mapping[str, int],
    paths: Mapping[str, Path],
    errors: list[dict[str, str]],
    gate_blockers: list[str] | None = None,
) -> dict[str, Any]:
    written_files: dict[str, str] = {"summary": str(paths["summary"])}
    for name in ("jsonl", "json", "xml"):
        if name in formats:
            written_files[name] = str(paths[name])
    return {
        "schema_version": SCHEMA_VERSION,
        "exporter": EXPORTER_NAME,
        "generated_at": generated_at,
        "records_valid": int(counts.get("valid_records", 0)),
        "records_invalid": int(counts.get("invalid_records", 0)),
        "records_emitted": int(counts.get("records_emitted", 0)),
        "input": {
            "ocr_dir": str(args.ocr_dir),
            "limit": args.limit,
        },
        "output": {
            "output_dir": str(args.output_dir),
            "formats": sorted(formats),
            "files": written_files,
        },
        "filters": {
            "min_confidence": args.min_confidence,
            "strict_complete": bool(getattr(args, "strict_complete", False)),
            "strict_upsc": bool(getattr(args, "strict_upsc", False)),
        },
        "acceptance_gates": {
            "production_gates": getattr(args, "production_gates", "none"),
            "fail_empty": bool(getattr(args, "fail_empty", False)),
            "min_valid_records": getattr(args, "min_valid_records", None),
            "fail_on_aggregate_read_errors": bool(getattr(args, "fail_on_aggregate_read_errors", False)),
            "pass": not gate_blockers,
            "blockers": gate_blockers or [],
        },
        "counts": dict(counts),
        "valid_record_rules": VALID_RECORD_RULES,
        "private_output_rules": PRIVATE_OUTPUT_RULES,
        "errors": errors,
    }


def aggregate_paths(ocr_dir: Path, limit: int | None) -> list[Path]:
    if not ocr_dir.exists():
        raise ExportError(f"OCR aggregate directory does not exist: {ocr_dir}")
    if not ocr_dir.is_dir():
        raise ExportError(f"OCR aggregate path is not a directory: {ocr_dir}")
    # The CLI plan passes either the OCR root (.../ocr_openai) or the aggregate
    # directory itself (.../ocr_openai/pdfs). Accept both.
    search_dir = ocr_dir / "pdfs" if (ocr_dir / "pdfs").is_dir() else ocr_dir
    paths = sorted(path for path in search_dir.glob("*.json") if path.is_file())
    if limit is not None:
        paths = paths[:limit]
    return paths


def ensure_private_ocr_path(path: Path, *, label: str) -> None:
    """Refuse public/runtime locations for raw OCR aggregate or record exports."""
    try:
        resolved = path.expanduser().resolve()
    except Exception:
        resolved = path.expanduser()
    forbidden_roots = [
        ROOT / "public",
        ROOT / "data" / "app",
        ROOT / "data" / "pdf-runtime",
    ]
    for forbidden in forbidden_roots:
        try:
            forbidden_resolved = forbidden.resolve()
        except Exception:
            forbidden_resolved = forbidden
        if resolved == forbidden_resolved or forbidden_resolved in resolved.parents:
            raise ExportError(f"Refusing {label} under non-private runtime/public path: {resolved}")
    for root in [ACER_OCR_ROOT, REPO_OCR_ROOT]:
        try:
            allowed = root.resolve()
        except Exception:
            allowed = root
        if resolved == allowed or allowed in resolved.parents:
            return
    raise ExportError(
        f"Refusing {label} outside private OCR roots: {resolved}. "
        f"Use {ACER_OCR_ROOT} for Acer output or {REPO_OCR_ROOT} for tiny repo-private tests."
    )


def record_passes_filters(record: Mapping[str, Any], min_confidence: float | None) -> bool:
    if min_confidence is None:
        return True
    confidence = clamp_confidence(record.get("confidence"))
    return (confidence if confidence is not None else 0.0) >= min_confidence


def export_records(args: argparse.Namespace) -> dict[str, Any]:
    formats = parse_formats(args.formats)
    generated_at = iso_now()
    args.ocr_dir = args.ocr_dir.expanduser()
    args.output_dir = args.output_dir.expanduser()
    ensure_private_ocr_path(args.ocr_dir, label="OCR aggregate input")
    ensure_private_ocr_path(args.output_dir, label="record export output")
    paths = output_paths(args.output_dir)
    counts = init_counts()
    errors: list[dict[str, str]] = []
    selected_paths = aggregate_paths(args.ocr_dir, args.limit)
    counts["aggregates_found"] = len(selected_paths)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    with contextlib.ExitStack() as stack:
        jsonl_handle = stack.enter_context(AtomicWriter(paths["jsonl"])) if "jsonl" in formats else None
        json_handle = stack.enter_context(AtomicWriter(paths["json"])) if "json" in formats else None
        xml_handle = stack.enter_context(AtomicWriter(paths["xml"])) if "xml" in formats else None

        if json_handle:
            json_handle.write("[\n")
        if xml_handle:
            xml_handle.write('<?xml version="1.0" encoding="utf-8"?>\n')
            xml_handle.write(f'<topper_answer_records schema_version="{SCHEMA_VERSION}" generated_at="{generated_at}">\n')

        first_json_record = True
        for aggregate_path in selected_paths:
            try:
                aggregate = aggregate_from_file(aggregate_path)
                counts["aggregates_processed"] += 1
            except Exception as exc:  # noqa: BLE001 - exporter should keep going across bad aggregates
                counts["aggregate_read_errors"] += 1
                errors.append({"path": str(aggregate_path), "error": str(exc)})
                continue

            for record in build_records_for_aggregate(
                aggregate_path,
                aggregate,
                strict_complete=bool(getattr(args, "strict_complete", False)),
                strict_upsc=bool(getattr(args, "strict_upsc", False)),
            ):
                counts["records_seen"] += 1
                if not record_passes_filters(record, args.min_confidence):
                    counts["filtered_low_confidence"] += 1
                    continue
                counts["records_emitted"] += 1
                if record.get("valid_record"):
                    counts["valid_records"] += 1
                else:
                    counts["invalid_records"] += 1
                if ensure_list(record.get("pyq_mapping_hints")):
                    counts["records_with_pyq_hints"] += 1
                if ensure_list(record.get("known_project_mappings")):
                    counts["records_with_known_mappings"] += 1
                markdown_source = record.get("full_answer_markdown_source")
                if markdown_source == "page_ocr":
                    counts["records_with_page_ocr_markdown"] += 1
                elif markdown_source == "question_field":
                    counts["records_with_question_field_markdown"] += 1
                else:
                    counts["records_missing_markdown"] += 1

                if jsonl_handle:
                    write_record_json(jsonl_handle, record)
                    jsonl_handle.write("\n")
                if json_handle:
                    if not first_json_record:
                        json_handle.write(",\n")
                    write_record_json(json_handle, record)
                    first_json_record = False
                if xml_handle:
                    xml_text = record_to_xml(record)
                    xml_handle.write("  " + xml_text.replace("\n", "\n  ") + "\n")

        gate_blockers = evaluate_export_gates(args, counts)
        summary = build_summary(
            generated_at=generated_at,
            args=args,
            formats=formats,
            counts=counts,
            paths=paths,
            errors=errors,
            gate_blockers=gate_blockers,
        )

        if json_handle:
            json_handle.write("\n]\n")
        if xml_handle:
            xml_text = summary_to_xml(summary)
            xml_handle.write("  " + xml_text.replace("\n", "\n  ") + "\n")
            xml_handle.write("</topper_answer_records>\n")

    # Summary is written after data exports so it accurately names all outputs.
    with AtomicWriter(paths["summary"]) as handle:
        json.dump(summary, handle, **PRETTY_JSON_KWARGS)
        handle.write("\n")

    if gate_blockers:
        raise ExportGateError("; ".join(gate_blockers))
    return summary


def evaluate_export_gates(args: argparse.Namespace, counts: Mapping[str, int]) -> list[str]:
    blockers: list[str] = []
    production_profile = getattr(args, "production_gates", "none")
    fail_on_read_errors = bool(getattr(args, "fail_on_aggregate_read_errors", False))
    if production_profile == "acer-internet-local":
        fail_on_read_errors = True
        if int(counts.get("aggregates_found") or 0) <= 0:
            blockers.append("production gate: no aggregate JSON files were found")
        if int(counts.get("records_emitted") or 0) <= 0:
            blockers.append("production gate: no records were emitted")
        if int(counts.get("valid_records") or 0) <= 0:
            blockers.append("production gate: no valid records were emitted")
    if fail_on_read_errors and int(counts.get("aggregate_read_errors") or 0) > 0:
        blockers.append(f"aggregate_read_errors {counts.get('aggregate_read_errors', 0)} > 0")
    if bool(getattr(args, "fail_empty", False)):
        if int(counts.get("aggregates_found") or 0) <= 0:
            blockers.append("--fail-empty requested but no aggregate JSON files were found")
        if int(counts.get("records_emitted") or 0) <= 0:
            blockers.append("--fail-empty requested but no records were emitted")
    min_valid = getattr(args, "min_valid_records", None)
    if min_valid is not None and int(counts.get("valid_records") or 0) < int(min_valid):
        blockers.append(f"valid_records {counts.get('valid_records', 0)} < --min-valid-records {min_valid}")
    return blockers


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export post-OCR topper answer records from per-PDF OCR aggregate JSON files.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--ocr-dir",
        type=Path,
        default=DEFAULT_OCR_DIR,
        help="Directory containing per-PDF OCR aggregate *.json files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for topper-answer-records.* and export-summary.json.",
    )
    parser.add_argument(
        "--format",
        dest="formats",
        action="append",
        help="Output format to include: json, jsonl, xml, all. May be repeated; comma-separated values are also accepted. JSONL and summary are always included.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of aggregate JSON files to process, after filename sorting.",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=None,
        help="Omit records whose computed confidence is below this 0..1 threshold.",
    )
    parser.add_argument(
        "--fail-empty",
        action="store_true",
        help="Exit non-zero if no aggregate files or no records are emitted.",
    )
    parser.add_argument(
        "--min-valid-records",
        type=int,
        default=None,
        help="Exit non-zero if fewer than this many valid records are emitted.",
    )
    parser.add_argument(
        "--strict-complete",
        action="store_true",
        help="Mark records invalid unless their aggregate is done, has zero failed pages, and completed all pages.",
    )
    parser.add_argument(
        "--strict-upsc",
        action="store_true",
        help="Mark records invalid unless source/exam/paper metadata contains a UPSC/topper-copy signal.",
    )
    parser.add_argument(
        "--production-gates",
        choices=["none", "acer-internet-local"],
        default="none",
        help="Apply production acceptance gates to the export summary/exit status.",
    )
    parser.add_argument(
        "--fail-on-aggregate-read-errors",
        action="store_true",
        help="Exit non-zero if any aggregate JSON file cannot be read. Implied by --production-gates acer-internet-local.",
    )
    args = parser.parse_args(argv)

    if args.limit is not None and args.limit < 0:
        parser.error("--limit must be non-negative")
    if args.min_valid_records is not None and args.min_valid_records < 0:
        parser.error("--min-valid-records must be non-negative")
    if args.min_confidence is not None and not (0.0 <= args.min_confidence <= 1.0):
        parser.error("--min-confidence must be between 0 and 1")

    # argparse cannot validate repeated comma-separated --format values without
    # losing the exact UX requested by the task, so validate here.
    try:
        parse_formats(args.formats)
    except ExportError as exc:
        parser.error(str(exc))
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        summary = export_records(args)
    except ExportGateError as exc:
        print(f"ERROR: export gates failed: {exc}", file=sys.stderr)
        return 3
    except ExportError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        return 130

    counts = summary["counts"]
    print(
        "Exported "
        f"{counts['records_emitted']} records "
        f"({counts['valid_records']} valid, {counts['invalid_records']} invalid) "
        f"from {counts['aggregates_processed']} aggregate(s) "
        f"to {args.output_dir}"
    )
    if counts["aggregate_read_errors"]:
        print(f"WARN: {counts['aggregate_read_errors']} aggregate(s) could not be read", file=sys.stderr)
    if counts["filtered_low_confidence"]:
        print(f"Filtered {counts['filtered_low_confidence']} low-confidence record(s)", file=sys.stderr)
    if args.fail_empty and counts["aggregates_found"] == 0:
        print("ERROR: --fail-empty requested but no aggregate JSON files were found", file=sys.stderr)
        return 3
    if args.fail_empty and counts["records_emitted"] == 0:
        print("ERROR: --fail-empty requested but no records were emitted", file=sys.stderr)
        return 3
    if args.min_valid_records is not None and counts["valid_records"] < args.min_valid_records:
        print(
            f"ERROR: only {counts['valid_records']} valid records; "
            f"required at least {args.min_valid_records}",
            file=sys.stderr,
        )
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
