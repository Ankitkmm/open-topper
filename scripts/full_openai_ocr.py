#!/usr/bin/env python3
"""Full OpenAI-compatible vision OCR pipeline for UPSC topper-copy PDFs.

Offline/private worker. It renders every selected PDF page with PyMuPDF, sends
pages to a Responses-compatible vision model, stores page-level JSON caches, and
builds per-PDF Markdown + JSON aggregates. Raw OCR output is intentionally kept
out of public/.

Examples:
  .venv/bin/python scripts/full_openai_ocr.py --estimate
  .venv/bin/python scripts/full_openai_ocr.py --verify-key
  .venv/bin/python scripts/full_openai_ocr.py --pilot --full-after-pilot
  .venv/bin/python scripts/full_openai_ocr.py --full --shard 0/4
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import contextlib
import dataclasses
import datetime as dt
import hashlib
import json
import math
import os
import random
import re
import shutil
import sqlite3
import sys
import textwrap
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping

try:
    import fitz  # PyMuPDF
except Exception as exc:  # Keep --help usable even when the runtime dependency is absent/misconfigured.
    fitz = None  # type: ignore[assignment]
    _FITZ_IMPORT_ERROR: Exception | None = exc
else:
    _FITZ_IMPORT_ERROR = None

if fitz is not None:
    with contextlib.suppress(Exception):
        fitz.TOOLS.mupdf_display_errors(False)
        fitz.TOOLS.mupdf_display_warnings(False)

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
LOCAL_PDFS_DIR = ROOT / "local-pdfs"
REPO_OCR_ROOT = ROOT / "extracted_data" / "ocr_openai"
ACER_PROJECT_ROOT = Path("/Volumes/Acer/open-topper")
ACER_LOCAL_PDFS_DIR = ACER_PROJECT_ROOT / "local-pdfs"
ACER_OCR_ROOT = ACER_PROJECT_ROOT / "extracted_data" / "ocr_openai"
ACER_DOWNLOADED_PDFS_DIR = ACER_OCR_ROOT / "downloaded-pdfs"
ACER_TMP_ROOT = ACER_PROJECT_ROOT / "tmp"
# The latest user instruction asks us to keep the heavy OCR working folder on
# the Acer SSD when it is available. Code/docs still live in this repo.
DEFAULT_OUTPUT_DIR = ACER_OCR_ROOT if ACER_PROJECT_ROOT.exists() else REPO_OCR_ROOT
PROMPT_SCHEMA_VERSION = "full_ocr_v1"
PROMPT_TEMPLATE_HASH = hashlib.sha256(b"full_openai_ocr_page_prompt_v3").hexdigest()[:16]
CACHE_SCHEMA_VERSION = "page_cache_v1"
AGGREGATE_SCHEMA_VERSION = "pdf_aggregate_v1"
IMAGE_FORMAT = "jpeg"
DEFAULT_MAX_OUTPUT_TOKENS = 3500
STALE_IN_PROGRESS_MINUTES = 120
DUPLICATE_PROVENANCE_LIMIT = 25
PRIVATE_TMP_DIR_NAME = "tmp"
AUTH_STATUSES = {401, 403}
RETRY_STATUSES = {408, 409, 425, 429, 500, 502, 503, 504}
DIRECT_OPENAI_HOSTS = {"api.openai.com", "platform.openai.com"}
SMOKE_NONCE_PREFIX = "OCR_SMOKE"
INPUT_SCOPE = "acer-internet-and-local-v1"

GENERIC_MODEL_EXCLUSIONS = ("embedding", "tts", "transcribe", "whisper", "realtime", "audio", "moderation", "image-", "dall")
VISION_MODEL_HINTS = ("gpt-5", "gpt-4.1", "gpt-4o", "o4", "o3", "vision", "omni")
STOP_WORDS = {
    "the", "a", "an", "and", "or", "of", "in", "on", "to", "for", "with", "by", "from", "is", "are",
    "was", "were", "be", "been", "being", "as", "at", "it", "its", "this", "that", "these", "those", "into",
    "between", "through", "under", "over", "their", "has", "have", "had", "not", "no", "but", "if", "then",
    "than", "which", "what", "why", "how", "do", "does", "did", "can", "could", "should", "would", "will",
    "discuss", "examine", "critically", "analyse", "analyze", "comment", "evaluate", "explain", "describe",
    "highlight", "elucidate", "illustrate", "role", "impact", "significance", "importance", "need", "challenges",
    "issues", "measures", "india", "indian", "upsc", "marks", "mark", "words", "word", "question", "paper",
    "mains", "answer", "write", "about", "bring", "out", "q", "qa", "qb", "qc", "qd", "qe",
}


class OcrError(Exception):
    pass


def require_fitz() -> Any:
    if fitz is None:
        detail = f" Import failed: {_FITZ_IMPORT_ERROR}" if _FITZ_IMPORT_ERROR else ""
        raise OcrError(f"PyMuPDF (`fitz`) is required for PDF inspection/rendering. Run with the repo .venv Python or install PyMuPDF.{detail}")
    return fitz


class AuthError(OcrError):
    pass


class ApiError(OcrError):
    def __init__(self, status: int | None, message: str, payload: Any | None = None, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.payload = payload
        self.headers = headers or {}


class JsonParseError(OcrError):
    pass


class PageProcessingError(OcrError):
    def __init__(self, message: str, usage: dict[str, int] | None = None, api_calls: int = 0, status_history: list[int | str] | None = None, repair_calls: int = 0):
        super().__init__(message)
        self.usage = normalize_usage(usage or {})
        self.api_calls = int(api_calls or 0)
        self.status_history = status_history or []
        self.repair_calls = int(repair_calls or 0)


@dataclasses.dataclass(frozen=True)
class RenderSettings:
    scale: float
    image_format: str
    jpeg_quality: int

    def fingerprint_dict(self) -> dict[str, Any]:
        return {"scale": self.scale, "image_format": self.image_format, "jpeg_quality": self.jpeg_quality}


@dataclasses.dataclass
class Config:
    output_dir: Path
    input_dirs: list[Path]
    api_key: str
    base_url: str
    base_url_host: str
    model: str
    prompt_version: str
    concurrency: int
    render: RenderSettings
    max_retries: int
    rpm_limit: int | None
    input_price_per_1m: float | None
    output_price_per_1m: float | None
    save_images: bool
    force_pages: bool
    dry_run: bool
    max_output_tokens: int
    include_reasoning: bool
    min_free_gb: float
    request_timeout: int
    api_mode: bool
    allow_direct_openai: bool
    source_metadata_index: Any | None = None
    inventory_errors: list[dict[str, Any]] = dataclasses.field(default_factory=list)
    inventory_duplicates: list[dict[str, Any]] = dataclasses.field(default_factory=list)
    tmp_dir: Path | None = None

    @property
    def v1_base(self) -> str:
        normalized = self.base_url.rstrip("/")
        return normalized if normalized.endswith("/v1") else f"{normalized}/v1"

    @property
    def prompt_fingerprint(self) -> str:
        return prompt_fingerprint_for(self.model, self.prompt_version, self.render, self.max_output_tokens, self.base_url_host)


@dataclasses.dataclass
class PdfInfo:
    pdf_id: str
    drive_id: str | None
    path: Path
    rel_path: str
    page_count: int
    byte_size: int
    mtime_ns: int
    text_word_count: int
    metadata_score: int
    has_extracted_name: bool
    has_known_links: bool
    priority_rank: int = 0
    source_site: str | None = None
    source_url: str | None = None
    sha256: str | None = None
    source_metadata: dict[str, Any] = dataclasses.field(default_factory=dict)
    identity_key: str | None = None
    duplicate_rel_paths: list[str] = dataclasses.field(default_factory=list)
    input_provenance: dict[str, Any] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class PageTask:
    pdf: PdfInfo
    page_number: int
    run_id: str
    known_context: dict[str, Any]


@dataclasses.dataclass
class PageResult:
    task: PageTask
    cache_payload: dict[str, Any]
    latency_ms: int
    usage: dict[str, int]
    api_calls: int = 0
    retry_attempts: int = 0
    rate_limited_attempts: int = 0
    repair_calls: int = 0


@dataclasses.dataclass
class RunStats:
    pages_attempted: int = 0
    pages_completed: int = 0
    pages_failed: int = 0
    pages_skipped_cached: int = 0
    pdfs_processed: int = 0
    pdfs_failed: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    latencies_ms: list[int] = dataclasses.field(default_factory=list)
    auth_error: str | None = None
    repeated_429: int = 0
    api_calls_made: int = 0
    retry_attempts: int = 0
    rate_limited_attempts: int = 0
    repair_calls: int = 0

    def merge_usage(self, usage: dict[str, int]) -> None:
        self.input_tokens += int(usage.get("input_tokens") or 0)
        self.output_tokens += int(usage.get("output_tokens") or 0)
        self.total_tokens += int(usage.get("total_tokens") or 0)

    @property
    def parse_success_rate(self) -> float:
        total = self.pages_completed + self.pages_failed
        return self.pages_completed / total if total else 1.0

    @property
    def hard_failure_rate(self) -> float:
        total = self.pages_completed + self.pages_failed
        return self.pages_failed / total if total else 0.0


class RateLimiter:
    def __init__(self, rpm: int | None):
        self.rpm = rpm if rpm and rpm > 0 else None
        self.lock = threading.Lock()
        self.timestamps: list[float] = []
        self.cooldown_until = 0.0

    def wait(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                if now < self.cooldown_until:
                    sleep_for = self.cooldown_until - now
                elif not self.rpm:
                    return
                else:
                    self.timestamps = [ts for ts in self.timestamps if ts >= now - 60]
                    if len(self.timestamps) < self.rpm:
                        self.timestamps.append(now)
                        return
                    sleep_for = max(0.1, 60 - (now - self.timestamps[0]))
            time.sleep(min(sleep_for, 5))

    def pause_for(self, seconds: float) -> None:
        """Apply a global cooldown so all workers respect severe 429/Retry-After pressure."""
        seconds = max(0.0, min(float(seconds), 300.0))
        if seconds <= 0:
            return
        with self.lock:
            self.cooldown_until = max(self.cooldown_until, time.monotonic() + seconds)


class Manifest:
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.db_path = output_dir / "manifest.sqlite"
        self.events_path = output_dir / "events.jsonl"
        self.lock = threading.RLock()
        output_dir.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path, timeout=45, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def close(self) -> None:
        with self.lock:
            self.conn.close()

    def _init_db(self) -> None:
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=NORMAL")
            self.conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                  run_id TEXT PRIMARY KEY,
                  mode TEXT NOT NULL,
                  started_at TEXT NOT NULL,
                  finished_at TEXT,
                  base_url_host TEXT,
                  model TEXT,
                  prompt_version TEXT,
                  render_json TEXT,
                  concurrency INTEGER,
                  shard TEXT,
                  status TEXT NOT NULL,
                  stats_json TEXT
                );
                CREATE TABLE IF NOT EXISTS pdfs (
                  pdf_id TEXT PRIMARY KEY,
                  drive_id TEXT,
                  rel_path TEXT NOT NULL,
                  page_count INTEGER NOT NULL,
                  byte_size INTEGER NOT NULL,
                  source_site TEXT,
                  source_url TEXT,
                  sha256 TEXT,
                  priority_rank INTEGER,
                  status TEXT NOT NULL,
                  pages_completed INTEGER DEFAULT 0,
                  pages_failed INTEGER DEFAULT 0,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS pages (
                  pdf_id TEXT NOT NULL,
                  page_number INTEGER NOT NULL,
                  status TEXT NOT NULL,
                  retry_count INTEGER DEFAULT 0,
                  model TEXT,
                  prompt_version TEXT,
                  render_json TEXT,
                  fingerprint TEXT,
                  latency_ms INTEGER,
                  usage_json TEXT,
                  error TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (pdf_id, page_number, fingerprint)
                );
                CREATE TABLE IF NOT EXISTS events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  ts TEXT NOT NULL,
                  run_id TEXT,
                  severity TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  pdf_id TEXT,
                  page_number INTEGER,
                  message TEXT NOT NULL,
                  metadata_json TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);
                CREATE INDEX IF NOT EXISTS idx_pages_pdf ON pages(pdf_id);
                CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
                """
            )
            # Lightweight migrations for older manifests.
            for col, typ in [("source_site", "TEXT"), ("source_url", "TEXT"), ("sha256", "TEXT")]:
                with contextlib.suppress(sqlite3.OperationalError):
                    self.conn.execute(f"ALTER TABLE pdfs ADD COLUMN {col} {typ}")
            self.conn.commit()

    def reclaim_stale_in_progress(self, minutes: int = STALE_IN_PROGRESS_MINUTES) -> int:
        threshold = iso_now(dt.datetime.now(dt.UTC) - dt.timedelta(minutes=minutes))
        with self.lock:
            cur = self.conn.execute(
                "UPDATE pages SET status='queued', error='reclaimed stale in_progress page', updated_at=? WHERE status='in_progress' AND updated_at < ?",
                (iso_now(), threshold),
            )
            self.conn.commit()
            return cur.rowcount

    def start_run(self, run_id: str, mode: str, config: Config, shard: str | None) -> None:
        with self.lock:
            self.conn.execute(
                """
                INSERT OR REPLACE INTO runs
                (run_id, mode, started_at, finished_at, base_url_host, model, prompt_version, render_json, concurrency, shard, status, stats_json)
                VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'running', NULL)
                """,
                (run_id, mode, iso_now(), config.base_url_host, config.model, config.prompt_version, json_dumps(config.render.fingerprint_dict()), config.concurrency, shard),
            )
            self.conn.commit()

    def finish_run(self, run_id: str, status: str, stats: dict[str, Any]) -> None:
        with self.lock:
            self.conn.execute("UPDATE runs SET finished_at=?, status=?, stats_json=? WHERE run_id=?", (iso_now(), status, json_dumps(stats), run_id))
            self.conn.commit()

    def update_run_model(self, run_id: str, model: str) -> None:
        if model:
            with self.lock:
                self.conn.execute("UPDATE runs SET model=? WHERE run_id=?", (model, run_id))
                self.conn.commit()

    def upsert_pdf(self, pdf: PdfInfo, status: str = "queued") -> None:
        with self.lock:
            self.conn.execute(
                """
                INSERT INTO pdfs
                (pdf_id, drive_id, rel_path, page_count, byte_size, source_site, source_url, sha256, priority_rank, status, pages_completed, pages_failed, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
                ON CONFLICT(pdf_id) DO UPDATE SET
                  drive_id=excluded.drive_id, rel_path=excluded.rel_path, page_count=excluded.page_count,
                  byte_size=excluded.byte_size, source_site=excluded.source_site, source_url=excluded.source_url,
                  sha256=excluded.sha256, priority_rank=excluded.priority_rank, status=excluded.status, updated_at=excluded.updated_at
                """,
                (pdf.pdf_id, pdf.drive_id, pdf.rel_path, pdf.page_count, pdf.byte_size, pdf.source_site, pdf.source_url, pdf.sha256, pdf.priority_rank, status, iso_now()),
            )
            self.conn.commit()

    def upsert_pdf_error(self, pdf_id: str, drive_id: str | None, rel_path: str, byte_size: int, error: str) -> None:
        with self.lock:
            self.conn.execute(
                """
                INSERT INTO pdfs
                (pdf_id, drive_id, rel_path, page_count, byte_size, source_site, source_url, sha256, priority_rank, status, pages_completed, pages_failed, updated_at)
                VALUES (?, ?, ?, 0, ?, 'local', NULL, NULL, NULL, 'error', 0, 0, ?)
                ON CONFLICT(pdf_id) DO UPDATE SET
                  drive_id=excluded.drive_id, rel_path=excluded.rel_path, page_count=0,
                  byte_size=excluded.byte_size, source_site='local', source_url=NULL,
                  sha256=NULL, status='error', pages_completed=0, pages_failed=0, updated_at=excluded.updated_at
                """,
                (pdf_id, drive_id, rel_path, byte_size, iso_now()),
            )
            self.conn.commit()

    def update_pdf_counts(self, pdf_id: str, status: str, completed: int, failed: int) -> None:
        with self.lock:
            self.conn.execute("UPDATE pdfs SET status=?, pages_completed=?, pages_failed=?, updated_at=? WHERE pdf_id=?", (status, completed, failed, iso_now(), pdf_id))
            self.conn.commit()

    def mark_page(self, pdf: PdfInfo, page_number: int, status: str, config: Config, retry_count: int = 0, latency_ms: int | None = None, usage: dict[str, Any] | None = None, error: str | None = None) -> None:
        with self.lock:
            self.conn.execute(
                """
                INSERT INTO pages
                (pdf_id, page_number, status, retry_count, model, prompt_version, render_json, fingerprint, latency_ms, usage_json, error, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(pdf_id, page_number, fingerprint) DO UPDATE SET
                  status=excluded.status, retry_count=excluded.retry_count, latency_ms=excluded.latency_ms,
                  usage_json=excluded.usage_json, error=excluded.error, updated_at=excluded.updated_at
                """,
                (pdf.pdf_id, page_number, status, retry_count, config.model, config.prompt_version, json_dumps(config.render.fingerprint_dict()), config.prompt_fingerprint, latency_ms, json_dumps(usage or {}), truncate(error, 2000) if error else None, iso_now()),
            )
            self.conn.commit()

    def claim_page(self, pdf: PdfInfo, page_number: int, config: Config, run_id: str | None = None, stale_minutes: int = STALE_IN_PROGRESS_MINUTES) -> bool:
        """Atomically claim one page for OCR unless another fresh worker owns it."""
        now = iso_now()
        threshold = iso_now(dt.datetime.now(dt.UTC) - dt.timedelta(minutes=stale_minutes))
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                row = self.conn.execute(
                    "SELECT status, updated_at FROM pages WHERE pdf_id=? AND page_number=? AND fingerprint=?",
                    (pdf.pdf_id, page_number, config.prompt_fingerprint),
                ).fetchone()
                if row and row["status"] == "in_progress" and safe_str(row["updated_at"]) >= threshold:
                    self.conn.commit()
                    return False
                self.conn.execute(
                    """
                    INSERT INTO pages
                    (pdf_id, page_number, status, retry_count, model, prompt_version, render_json, fingerprint, latency_ms, usage_json, error, updated_at)
                    VALUES (?, ?, 'in_progress', 0, ?, ?, ?, ?, NULL, ?, ?, ?)
                    ON CONFLICT(pdf_id, page_number, fingerprint) DO UPDATE SET
                      status='in_progress', retry_count=0, latency_ms=NULL, usage_json=excluded.usage_json,
                      error=excluded.error, updated_at=excluded.updated_at
                    """,
                    (
                        pdf.pdf_id,
                        page_number,
                        config.model,
                        config.prompt_version,
                        json_dumps(config.render.fingerprint_dict()),
                        config.prompt_fingerprint,
                        json_dumps({}),
                        f"claimed by {run_id}" if run_id else None,
                        now,
                    ),
                )
                self.conn.commit()
                return True
            except Exception:
                self.conn.rollback()
                raise

    def event(self, severity: str, event_type: str, message: str, run_id: str | None = None, pdf_id: str | None = None, page_number: int | None = None, metadata: dict[str, Any] | None = None) -> None:
        safe_message = redact_sensitive(message)
        safe_metadata = redact_for_json(metadata or {})
        payload = {"ts": iso_now(), "run_id": run_id, "severity": severity, "event_type": event_type, "pdf_id": pdf_id, "page_number": page_number, "message": safe_message, "metadata": safe_metadata}
        with self.lock:
            self.conn.execute(
                "INSERT INTO events (ts, run_id, severity, event_type, pdf_id, page_number, message, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (payload["ts"], run_id, severity, event_type, pdf_id, page_number, safe_message, json_dumps(safe_metadata)),
            )
            self.conn.commit()
            self.events_path.parent.mkdir(parents=True, exist_ok=True)
            with self.events_path.open("a", encoding="utf-8") as fh:
                fh.write(json_dumps(payload) + "\n")

    def export_json(self) -> dict[str, Any]:
        with self.lock:
            runs = [dict(row) for row in self.conn.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT 20")]
            pdf_status = [dict(row) for row in self.conn.execute("SELECT status, COUNT(*) AS count FROM pdfs GROUP BY status ORDER BY status")]
            page_status = [dict(row) for row in self.conn.execute("SELECT status, COUNT(*) AS count FROM pages GROUP BY status ORDER BY status")]
            recent_events = [dict(row) for row in self.conn.execute("SELECT ts, severity, event_type, pdf_id, page_number, message FROM events ORDER BY id DESC LIMIT 50")]
        return {"generated_at": iso_now(), "sqlite_path": display_path(self.db_path), "runs": runs, "pdf_status": pdf_status, "page_status": page_status, "recent_events": recent_events}


class EnrichmentIndex:
    def __init__(self) -> None:
        self.records_by_drive: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.records_by_rel_path: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.official_links_by_answer_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.mapping_candidates: list[dict[str, Any]] = []
        self.mapping_candidates_by_paper: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.loaded_files: list[str] = []

    @classmethod
    def load(cls) -> "EnrichmentIndex":
        idx = cls()
        idx._load_canonical()
        idx._load_official_links()
        idx._load_mapping_candidates()
        return idx

    def _load_canonical(self) -> None:
        path = ROOT / "data" / "app" / "topper-answer-canonical.json"
        data = read_json_file(path, None)
        if not isinstance(data, dict) or not isinstance(data.get("records"), list):
            return
        self.loaded_files.append(str(path.relative_to(ROOT)))
        for rec in data["records"]:
            if not isinstance(rec, dict):
                continue
            drive_id = safe_str(rec.get("sourceDriveId"))
            rel_path = normalize_rel_path(safe_str(rec.get("localPdfPath")))
            if drive_id:
                self.records_by_drive[drive_id].append(rec)
            if rel_path:
                self.records_by_rel_path[rel_path].append(rec)

    def _load_official_links(self) -> None:
        path = ROOT / "data" / "app" / "official-pyq-links.json"
        data = read_json_file(path, None)
        links = data.get("links") if isinstance(data, dict) else None
        if not isinstance(links, dict):
            return
        self.loaded_files.append(str(path.relative_to(ROOT)))
        for official_id, items in links.items():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                answer_id = safe_str(item.get("topperAnswerId"))
                if not answer_id:
                    continue
                enriched = dict(item)
                enriched.setdefault("officialQuestionId", official_id)
                self.official_links_by_answer_id[answer_id].append(enriched)

    def _load_mapping_candidates(self) -> None:
        path = ROOT / "data" / "mappings" / "index.json"
        data = read_json_file(path, None)
        if not isinstance(data, list):
            return
        self.loaded_files.append(str(path.relative_to(ROOT)))
        for item in data:
            if not isinstance(item, dict):
                continue
            text = safe_str(item.get("questionText"))
            tokens = tokenize_question(text)
            if len(tokens) < 3:
                continue
            candidate = {
                "canonicalQuestionId": item.get("canonicalQuestionId"),
                "questionText": text,
                "paper": safe_str(item.get("paper")),
                "estimatedYear": item.get("estimatedYear"),
                "topperCount": item.get("topperCount"),
                "file": item.get("file"),
                "token_set": set(tokens),
            }
            self.mapping_candidates.append(candidate)
            paper_key = normalize_key(candidate["paper"])
            if paper_key:
                self.mapping_candidates_by_paper[paper_key].append(candidate)

    def records_for_pdf(self, pdf: PdfInfo) -> list[dict[str, Any]]:
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        buckets: list[list[dict[str, Any]]] = []
        if pdf.drive_id:
            buckets.append(self.records_by_drive.get(pdf.drive_id, []))
        buckets.append(self.records_by_rel_path.get(pdf.rel_path, []))
        # Also try basename/drive-style relative paths for external mirrors.
        buckets.append(self.records_by_rel_path.get(f"local-pdfs/{pdf.path.name}", []))
        for bucket in buckets:
            for rec in bucket:
                key = safe_str(rec.get("answerId")) or json_dumps(rec, sort_keys=True)[:200]
                if key not in seen:
                    seen.add(key)
                    result.append(rec)
        return result

    def known_links_for_records(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for rec in records:
            answer_id = safe_str(rec.get("answerId"))
            for link in self.official_links_by_answer_id.get(answer_id, []):
                key = f"{link.get('officialQuestionId')}::{link.get('topperAnswerId')}"
                if key not in seen:
                    seen.add(key)
                    result.append(link)
        return result

    def mapping_hints(self, question_text: str, paper: str | None = None, limit: int = 5) -> list[dict[str, Any]]:
        tokens = tokenize_question(question_text)
        if len(tokens) < 3:
            return []
        token_set = set(tokens)
        paper_key = normalize_key(paper or "")
        candidates = self.mapping_candidates_by_paper.get(paper_key) if paper_key else None
        if not candidates:
            candidates = self.mapping_candidates
        scored: list[tuple[float, dict[str, Any], list[str]]] = []
        for candidate in candidates:
            shared = token_set & candidate["token_set"]
            if len(shared) < 2:
                continue
            jaccard = len(shared) / max(1, len(token_set | candidate["token_set"]))
            cover = len(shared) / max(1, min(len(token_set), len(candidate["token_set"])))
            score = 0.55 * cover + 0.35 * jaccard + strong_phrase_bonus(question_text, candidate["questionText"])
            if score >= 0.22:
                scored.append((score, candidate, sorted(shared, key=lambda s: (-len(s), s))[:12]))
        scored.sort(key=lambda row: row[0], reverse=True)
        return [
            {
                "canonicalQuestionId": cand.get("canonicalQuestionId"),
                "questionText": cand.get("questionText"),
                "paper": cand.get("paper"),
                "estimatedYear": cand.get("estimatedYear"),
                "topperCount": cand.get("topperCount"),
                "confidence": round(min(score, 0.99), 3),
                "reason": f"shared terms: {', '.join(shared[:8])}",
                "source": "data/mappings/index.json token hint",
            }
            for score, cand, shared in scored[:limit]
        ]


class SourceMetadataIndex:
    """Private downloader/source provenance for the Acer internet+local corpus.

    OCR itself never crawls the internet.  The separate downloader writes
    private manifests under ``OCR_OUTPUT_DIR`` and this worker consumes those
    manifests only for private provenance/dedupe summaries.  Source URLs are not
    placed in prompts or public app data.
    """

    def __init__(self) -> None:
        self.by_path: dict[str, dict[str, Any]] = {}
        self.by_sha: dict[str, dict[str, Any]] = {}
        self.loaded_files: list[str] = []

    @classmethod
    def load(cls, output_dir: Path) -> "SourceMetadataIndex":
        idx = cls()
        for path in [
            output_dir / "download-manifest.json",
            output_dir / "sources" / "download-manifest.json",
            output_dir / "sources" / "discovered-sources.json",
        ]:
            data = read_json_file(path, None)
            if data is None:
                continue
            loaded = 0
            if isinstance(data, dict):
                values = data.get("items") or data.get("downloads") or data.get("candidates") or []
            else:
                values = data
            if not isinstance(values, list):
                continue
            for item in values:
                if isinstance(item, dict):
                    idx.add_item(item)
                    loaded += 1
            if loaded:
                idx.loaded_files.append(display_path(path))
        return idx

    def add_item(self, item: dict[str, Any]) -> None:
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        merged: dict[str, Any] = {
            **metadata,
            "download_status": item.get("status"),
            "local_path": first_nonempty(item.get("local_path"), item.get("pdf_path"), item.get("path")),
            "source_site": first_nonempty(item.get("source_site"), metadata.get("source_site"), metadata.get("source")),
            "source_url": first_nonempty(item.get("source_url"), item.get("pdf_url"), item.get("url"), item.get("candidate_url"), metadata.get("initial_url")),
            "final_url": first_nonempty(item.get("final_url"), metadata.get("final_url")),
            "source_page": first_nonempty(item.get("source_page"), metadata.get("source_page")),
            "topper_name": first_nonempty(item.get("topper_name"), metadata.get("topper_name"), metadata.get("name")),
            "rank": first_nonempty(item.get("rank"), metadata.get("rank")),
            "year": first_nonempty(item.get("year"), metadata.get("year"), metadata.get("exam_year")),
            "paper": first_nonempty(item.get("paper"), metadata.get("paper"), item.get("subject"), metadata.get("subject")),
            "subject": first_nonempty(item.get("subject"), metadata.get("subject")),
            "institute": first_nonempty(item.get("institute"), metadata.get("institute"), metadata.get("source_label")),
            "medium": first_nonempty(item.get("medium"), metadata.get("medium")),
            "filename_hint": item.get("filename_hint"),
            "object_key": item.get("object_key"),
        }
        local_path = safe_str(merged.get("local_path"))
        if local_path:
            path = Path(local_path).expanduser()
            with contextlib.suppress(Exception):
                self.by_path[str(path.resolve())] = merged
            self.by_path[str(path)] = merged
        sha = safe_str(first_nonempty(item.get("sha256"), metadata.get("sha256")))
        if sha:
            self.by_sha[sha] = merged

    def lookup(self, path: Path, sha256: str | None = None) -> dict[str, Any]:
        keys = [str(path)]
        with contextlib.suppress(Exception):
            keys.insert(0, str(path.resolve()))
        for key in keys:
            if key in self.by_path:
                return dict(self.by_path[key])
        if sha256 and sha256 in self.by_sha:
            return dict(self.by_sha[sha256])
        return {}


def main(argv: list[str] | None = None) -> int:
    load_env_file(ENV_FILE)
    args = parse_args(argv)
    if args.shard:
        try:
            shard_index, shard_total = parse_shard(args.shard)
            args.shard = f"{shard_index}/{shard_total}"
        except Exception as exc:
            print(f"ERROR: {redact_sensitive(exc)}", file=sys.stderr)
            return 2
    try:
        config = build_config(args)
    except Exception as exc:
        print(f"ERROR: {redact_sensitive(exc)}", file=sys.stderr)
        return 2

    selected_modes = [name for name, enabled in [("verify-key", args.verify_key), ("estimate", args.estimate), ("pilot", args.pilot), ("full", args.full), ("rebuild-aggregates", args.rebuild_aggregates)] if enabled]
    if not selected_modes:
        print("ERROR: choose one mode: --verify-key, --estimate, --pilot, --full, or --rebuild-aggregates", file=sys.stderr)
        return 2
    if len(selected_modes) > 1:
        print("ERROR: choose exactly one primary mode. Use --pilot --full-after-pilot for gated continuation.", file=sys.stderr)
        return 2
    if args.full_after_pilot and not args.pilot:
        print("ERROR: --full-after-pilot requires --pilot", file=sys.stderr)
        return 2
    if args.verify_key and args.dry_run:
        print("ERROR: --verify-key performs API calls; use --estimate for no-API checks", file=sys.stderr)
        return 2

    try:
        ensure_private_output_dir(config.output_dir, allow_unsafe=args.allow_unsafe_output_dir)
        if config.tmp_dir is not None:
            ensure_private_tmp_dir(config.tmp_dir)
    except Exception as exc:
        print(f"ERROR: {redact_sensitive(exc)}", file=sys.stderr)
        return 2

    config.output_dir.mkdir(parents=True, exist_ok=True)
    if config.tmp_dir is not None:
        config.tmp_dir.mkdir(parents=True, exist_ok=True)
        os.environ["TMPDIR"] = str(config.tmp_dir)
    (config.output_dir / "page-cache").mkdir(parents=True, exist_ok=True)
    (config.output_dir / "pdfs").mkdir(parents=True, exist_ok=True)
    if config.save_images:
        (config.output_dir / "images").mkdir(parents=True, exist_ok=True)

    try:
        manifest = Manifest(config.output_dir)
    except Exception as exc:
        print(f"ERROR: could not open SQLite manifest in {display_path(config.output_dir)}: {redact_sensitive(exc)}", file=sys.stderr)
        return 1
    try:
        reclaimed = manifest.reclaim_stale_in_progress()
        if reclaimed:
            manifest.event("info", "reclaim_stale_pages", f"Reclaimed {reclaimed} stale in_progress pages")

        needs_inventory = args.estimate or args.pilot or args.full or args.rebuild_aggregates
        if needs_inventory:
            enrichment = EnrichmentIndex.load()
            print(f"Loaded enrichment files: {', '.join(enrichment.loaded_files) if enrichment.loaded_files else 'none'}")
            print(f"Input dirs: {', '.join(display_path(p) for p in config.input_dirs)}")
            if args.only_pdf:
                inventory = build_targeted_inventory(args.only_pdf, enrichment, config, manifest)
            else:
                inventory = build_inventory(enrichment, config, manifest)
            inventory = apply_priority_order(inventory)
            selected_inventory = select_inventory(inventory, args)
            write_inventory_summary(config, inventory, selected_inventory)
            enforce_production_heavy_run_guard(args, config, selected_inventory)
        else:
            enrichment = EnrichmentIndex()
            inventory = build_smoke_inventory(args, config)
            selected_inventory = inventory

        shard_label = args.shard or None

        if args.estimate:
            run_id = new_run_id("estimate")
            manifest.start_run(run_id, "estimate", config, shard_label)
            summary = run_estimate(run_id, inventory, selected_inventory, config, manifest, args)
            summary["status"] = "complete"
            manifest.finish_run(run_id, "complete", summary)
            atomic_write_json(config.output_dir / "run-summary.json", summary)
            write_manifest_exports(config.output_dir, manifest)
            print_estimate(summary)
            return 0

        if args.verify_key:
            run_id = new_run_id("verify")
            manifest.start_run(run_id, "verify-key", config, shard_label)
            try:
                verification = verify_key_and_model(config, selected_inventory or inventory, manifest, run_id)
                if verification.get("model"):
                    config.model = verification["model"]
                    manifest.update_run_model(run_id, config.model)
                if "include_reasoning" in verification:
                    config.include_reasoning = bool(verification["include_reasoning"])
                verify_summary = build_verify_summary(config, verification)
                atomic_write_json(config.output_dir / "verify-summary.json", verify_summary)
                manifest.finish_run(run_id, "complete", verification)
                print(f"Verification passed: model={config.model} base_url_host={config.base_url_host}")
            except Exception as exc:
                metadata = {"error": redact_sensitive(exc), "traceback": redact_sensitive(traceback.format_exc(limit=5))}
                manifest.event("error", "verify_key_failed", redact_sensitive(exc), run_id=run_id, metadata=metadata)
                manifest.finish_run(run_id, "failed", metadata)
                write_manifest_exports(config.output_dir, manifest)
                print(f"ERROR: key/model verification failed: {redact_sensitive(exc)}", file=sys.stderr)
                return 1
            finally:
                write_manifest_exports(config.output_dir, manifest)
            if args.verify_key:
                return 0

        if (args.pilot or args.full) and not args.dry_run:
            require_matching_verify_summary(config)

        if args.pilot:
            run_id = new_run_id("pilot")
            manifest.start_run(run_id, "pilot", config, shard_label)
            pilot_limit = args.pilot_limit if args.pilot_limit is not None else args.limit_pdfs
            pilot_pdfs = select_pilot_pdfs(selected_inventory or inventory, pilot_limit)
            pilot_exit_code = 0
            if args.dry_run:
                summary = dry_run_summary(run_id, "pilot", pilot_pdfs, inventory, config, args)
                summary["status"] = "complete"
                atomic_write_json(config.output_dir / "pilot-summary.json", summary)
                manifest.finish_run(run_id, "complete", summary)
                print_run_summary(summary)
            else:
                stats = run_batch(run_id, pilot_pdfs, inventory, config, manifest, enrichment, mode="pilot")
                summary = build_pilot_summary(run_id, pilot_pdfs, inventory, config, stats)
                gates = evaluate_pilot_gates(summary, config)
                summary["gates"] = gates
                terminal = run_terminal_status(summary, gated=True)
                summary["status"] = terminal
                atomic_write_json(config.output_dir / "pilot-summary.json", summary)
                manifest.finish_run(run_id, terminal, summary)
                print_pilot_summary(summary)
                if not gates["pass"]:
                    pilot_exit_code = 1
                if args.full_after_pilot:
                    if gates["pass"]:
                        print("Pilot gates passed; continuing to full run because --full-after-pilot was supplied.")
                        full_run_id = new_run_id("full")
                        manifest.start_run(full_run_id, "full-after-pilot", config, shard_label)
                        full_stats = run_batch(full_run_id, selected_inventory, inventory, config, manifest, enrichment, mode="full")
                        full_summary = build_run_summary(full_run_id, "full", selected_inventory, inventory, config, full_stats)
                        full_terminal = run_terminal_status(full_summary)
                        full_summary["status"] = full_terminal
                        atomic_write_json(config.output_dir / "run-summary.json", full_summary)
                        manifest.finish_run(full_run_id, full_terminal, full_summary)
                        print_run_summary(full_summary)
                        if full_terminal != "complete":
                            pilot_exit_code = 1
                    else:
                        print("Pilot gates failed; not starting full run.", file=sys.stderr)
            write_manifest_exports(config.output_dir, manifest)
            return pilot_exit_code

        if args.full:
            run_id = new_run_id("full")
            manifest.start_run(run_id, "full", config, shard_label)
            if args.dry_run:
                summary = dry_run_summary(run_id, "full", selected_inventory, inventory, config, args)
                summary["status"] = "complete"
                manifest.finish_run(run_id, "complete", summary)
                atomic_write_json(config.output_dir / "run-summary.json", summary)
                print_run_summary(summary)
            else:
                if not args.force_full_without_pilot:
                    require_passing_pilot_before_full(config)
                stats = run_batch(run_id, selected_inventory, inventory, config, manifest, enrichment, mode="full")
                summary = build_run_summary(run_id, "full", selected_inventory, inventory, config, stats)
                terminal = run_terminal_status(summary)
                summary["status"] = terminal
                atomic_write_json(config.output_dir / "run-summary.json", summary)
                manifest.finish_run(run_id, terminal, summary)
                print_run_summary(summary)
            write_manifest_exports(config.output_dir, manifest)
            return 0 if args.dry_run or safe_str(summary.get("status")) == "complete" else 1

        if args.rebuild_aggregates:
            if not config.model:
                inferred_model = infer_unique_cache_model(selected_inventory, config)
                if inferred_model:
                    config.model = inferred_model
                    print(f"Inferred OCR model from page cache for aggregate rebuild: {config.model}")
            run_id = new_run_id("aggregate")
            manifest.start_run(run_id, "rebuild-aggregates", config, shard_label)
            summary = rebuild_aggregates(run_id, selected_inventory, inventory, config, manifest, enrichment)
            manifest.finish_run(run_id, safe_str(summary.get("status")) or ("failed" if summary.get("failed") else "complete"), summary)
            atomic_write_json(config.output_dir / "run-summary.json", summary)
            write_manifest_exports(config.output_dir, manifest)
            print_run_summary(summary)
            return 0 if safe_str(summary.get("status")) == "complete" else 1

        return 0
    except Exception as exc:
        message = redact_sensitive(exc)
        with contextlib.suppress(Exception):
            manifest.event("error", "run_failed", message, metadata={"traceback": redact_sensitive(traceback.format_exc(limit=5))})
            write_manifest_exports(config.output_dir, manifest)
        print(f"ERROR: {message}", file=sys.stderr)
        return 1
    finally:
        manifest.close()


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Private, resumable OpenAI-compatible vision OCR for topper-copy PDFs", formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--verify-key", action="store_true", help="Verify OPENAI_API_KEY/base URL/model and run one vision smoke test")
    parser.add_argument("--estimate", action="store_true", help="Inventory PDFs/cache and estimate remaining work without API calls")
    parser.add_argument("--pilot", action="store_true", help="OCR all pages of selected pilot PDFs")
    parser.add_argument("--full", action="store_true", help="OCR all selected PDFs/pages")
    parser.add_argument("--full-after-pilot", action="store_true", help="After --pilot, continue to --full only if gates pass")
    parser.add_argument("--force-full-without-pilot", action="store_true", default=env_bool("OCR_FORCE_FULL_WITHOUT_PILOT", False), help="Dangerous override: allow non-dry --full without a passing pilot-summary.json for the same settings")
    parser.add_argument("--rebuild-aggregates", action="store_true", help="Rebuild per-PDF Markdown/JSON from page cache without API calls")
    parser.add_argument("--allow-direct-openai", action="store_true", default=env_bool("OCR_ALLOW_DIRECT_OPENAI", False), help="Explicit opt-in for direct api.openai.com API-backed OCR. Without this, verify/pilot/full require OPENAI_BASE_URL/--base-url to point at a non-direct OpenAI-compatible endpoint.")
    parser.add_argument("--allow-unsafe-output-dir", action="store_true", default=env_bool("OCR_ALLOW_UNSAFE_OUTPUT_DIR", False), help="Deprecated/no-op safety flag; output is still restricted to extracted_data/ocr_openai.")
    parser.add_argument("--input-dir", action="append", default=[], help="Explicit private PDF input root; may be repeated. Must resolve under Acer downloaded-pdfs, Acer local-pdfs mirror, or repo local-pdfs. Defaults to Acer downloaded-pdfs + Acer local-pdfs mirror + repo local-pdfs when present.")
    parser.add_argument("--only-pdf", action="append", default=[], help="Restrict to a PDF path or drive ID; may be repeated")
    parser.add_argument("--limit-pdfs", type=int, default=None, help="Limit selected PDFs after priority/shard filtering")
    parser.add_argument("--shard", default="", help="Shard selector i/N, applied after priority ordering")
    parser.add_argument("--output-dir", default=os.environ.get("OCR_OUTPUT_DIR", str(DEFAULT_OUTPUT_DIR)), help="Private output directory")
    parser.add_argument("--tmp-dir", default=os.environ.get("OCR_TMP_DIR") or "", help="Private temporary working directory for OCR helper files. Defaults to TMPDIR when it is private (for example /Volumes/Acer/open-topper/tmp), otherwise <output-dir>/tmp.")
    parser.add_argument("--base-url", default=None, help="Override OPENAI_BASE_URL for this run")
    parser.add_argument("--model", default=None, help="Override OCR_OPENAI_MODEL for this run")
    parser.add_argument("--concurrency", type=int, default=env_int("OCR_CONCURRENCY", 4), help="Page-level OCR worker count")
    parser.add_argument("--render-scale", type=float, default=env_float("OCR_RENDER_SCALE", 2.0), help="PyMuPDF render scale")
    parser.add_argument("--jpeg-quality", type=int, default=env_int("OCR_JPEG_QUALITY", 82), help="JPEG quality for rendered pages")
    parser.add_argument("--max-retries", type=int, default=env_int("OCR_MAX_RETRIES", 6), help="Max retries per API call")
    parser.add_argument("--rpm-limit", type=int, default=env_optional_int("OCR_RPM_LIMIT"), help="Optional requests-per-minute limiter")
    parser.add_argument("--prompt-version", default=os.environ.get("OCR_PROMPT_VERSION", PROMPT_SCHEMA_VERSION), help="Prompt/cache version")
    parser.add_argument("--pilot-limit", type=int, default=None, help="Limit pilot PDF count without limiting later --full-after-pilot run")
    parser.add_argument("--force-pages", action="store_true", default=env_bool("OCR_FORCE_PAGES", False), help="Re-OCR pages even if cache exists")
    parser.add_argument("--save-images", action="store_true", default=env_bool("OCR_SAVE_IMAGES", False), help="Persist rendered page images")
    parser.add_argument("--dry-run", action="store_true", help="Show selected work without API calls")
    parser.add_argument("--max-output-tokens", type=int, default=env_int("OCR_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS), help="Responses max_output_tokens")
    parser.add_argument("--min-free-gb", type=float, default=env_float("OCR_MIN_FREE_GB", 5.0), help="Minimum free disk on the private OCR output volume before API-backed OCR")
    parser.add_argument("--request-timeout", type=int, default=env_int("OCR_REQUEST_TIMEOUT", 180), help="HTTP timeout seconds")
    return parser.parse_args(argv)


def build_config(args: argparse.Namespace) -> Config:
    output_dir = Path(getattr(args, "output_dir", os.environ.get("OCR_OUTPUT_DIR", str(DEFAULT_OUTPUT_DIR)))).expanduser()
    if not output_dir.is_absolute():
        output_dir = ROOT / output_dir
    tmp_dir = resolve_tmp_dir(getattr(args, "tmp_dir", "") or "", output_dir)
    input_dirs = resolve_input_dirs(args)

    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    cli_base_url = safe_str(getattr(args, "base_url", None))
    env_base_url = os.environ.get("OPENAI_BASE_URL", "").strip()
    raw_base_url = cli_base_url or env_base_url
    api_mode = bool(getattr(args, "verify_key", False) or ((getattr(args, "pilot", False) or getattr(args, "full", False)) and not getattr(args, "dry_run", False)))
    allow_direct = bool(getattr(args, "allow_direct_openai", False))
    if not raw_base_url:
        if api_mode:
            raise ValueError(
                "OPENAI_BASE_URL/--base-url is required for API-backed OCR modes. "
                "Direct api.openai.com is never auto-selected; use --base-url https://api.openai.com "
                "plus --allow-direct-openai only when you explicitly intend direct OpenAI billing."
            )
        raw_base_url = "https://cache-host-unset.invalid"
    base_url = raw_base_url.rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    if api_mode and (not parsed.scheme or not parsed.netloc):
        raise ValueError(f"OPENAI_BASE_URL must be absolute, got: {raw_base_url!r}")
    if not api_mode and (not parsed.scheme or not parsed.netloc):
        print(f"WARNING: ignoring invalid OPENAI_BASE_URL for no-API mode: {raw_base_url!r}", file=sys.stderr)
        base_url = "https://cache-host-unset.invalid"
        parsed = urllib.parse.urlparse(base_url)
    host_only = parsed.hostname or parsed.netloc
    if parsed.port:
        host_only = f"{host_only}:{parsed.port}"
    if api_mode and parsed.scheme not in {"http", "https"}:
        raise ValueError(f"OPENAI_BASE_URL must use http(s), got scheme {parsed.scheme!r}")
    if api_mode and parsed.scheme == "http" and not is_loopback_host(parsed.hostname):
        raise ValueError("OPENAI_BASE_URL must use https for API-backed modes unless it is a local loopback proxy.")
    if api_mode and (parsed.hostname or "").lower() in DIRECT_OPENAI_HOSTS:
        if not allow_direct:
            raise ValueError(
                "Refusing API-backed OCR against direct api.openai.com without --allow-direct-openai "
                "(or OCR_ALLOW_DIRECT_OPENAI=1). This prevents accidental paid direct OpenAI runs."
            )
        print("WARNING: API-backed OCR is using direct api.openai.com because --allow-direct-openai was supplied.", file=sys.stderr)
    model = safe_str(getattr(args, "model", None)) or os.environ.get("OCR_OPENAI_MODEL", "").strip()
    if api_mode and not model:
        raise ValueError(
            "OCR_OPENAI_MODEL/--model is required for --verify-key, non-dry --pilot, and non-dry --full. "
            "No paid model is auto-selected from /v1/models."
        )

    return Config(
        output_dir=output_dir,
        input_dirs=input_dirs,
        api_key=api_key,
        base_url=base_url,
        base_url_host=host_only,
        model=model,
        prompt_version=getattr(args, "prompt_version", PROMPT_SCHEMA_VERSION),
        concurrency=max(1, int(getattr(args, "concurrency", 4))),
        render=RenderSettings(scale=float(getattr(args, "render_scale", 2.0)), image_format=IMAGE_FORMAT, jpeg_quality=int(getattr(args, "jpeg_quality", 82))),
        max_retries=max(0, int(getattr(args, "max_retries", 6))),
        rpm_limit=getattr(args, "rpm_limit", None),
        input_price_per_1m=parse_optional_float(os.environ.get("OCR_INPUT_PRICE_PER_1M")),
        output_price_per_1m=parse_optional_float(os.environ.get("OCR_OUTPUT_PRICE_PER_1M")),
        save_images=bool(getattr(args, "save_images", False)),
        force_pages=bool(getattr(args, "force_pages", False)),
        dry_run=bool(getattr(args, "dry_run", False)),
        max_output_tokens=max(256, int(getattr(args, "max_output_tokens", DEFAULT_MAX_OUTPUT_TOKENS))),
        include_reasoning=True,
        min_free_gb=float(getattr(args, "min_free_gb", 25.0)),
        request_timeout=max(10, int(getattr(args, "request_timeout", 180))),
        api_mode=api_mode,
        allow_direct_openai=allow_direct,
        source_metadata_index=SourceMetadataIndex.load(output_dir),
        tmp_dir=tmp_dir,
    )


def resolve_tmp_dir(raw_value: str, output_dir: Path) -> Path:
    """Resolve a temp root that keeps all helper scratch files private.

    The worker itself uses destination-directory atomic writes for JSON/Markdown,
    but external operators often set TMPDIR for PyMuPDF/cache-heavy shells.  Make
    that setting explicit in run manifests and refuse accidental writes to /tmp
    or other public/non-private roots for OCR-related scratch state.
    """
    env_tmpdir = os.environ.get("TMPDIR", "").strip()
    selected = raw_value
    if not selected and env_tmpdir:
        env_path = Path(env_tmpdir).expanduser()
        if not env_path.is_absolute():
            env_path = ROOT / env_path
        if path_is_under_private_ocr_root(env_path.resolve()):
            selected = env_tmpdir
    if selected:
        tmp_dir = Path(selected).expanduser()
        if not tmp_dir.is_absolute():
            tmp_dir = ROOT / tmp_dir
    else:
        tmp_dir = output_dir / PRIVATE_TMP_DIR_NAME
    return tmp_dir


def resolve_input_dirs(args: argparse.Namespace) -> list[Path]:
    raw_values: list[str] = []
    raw_values.extend(getattr(args, "input_dir", None) or [])
    # OCR_INPUT_DIRS is accepted for operator convenience. Every root is still
    # validated as a private OCR input root: Acer downloaded PDFs, the Acer
    # local-pdfs mirror, or the repo local-pdfs corpus. The active default is
    # the Acer internet + local corpus, with all heavy artifacts on the Acer SSD
    # when mounted.
    env_dirs = os.environ.get("OCR_INPUT_DIRS", "").strip()
    if env_dirs:
        raw_values.extend(part.strip() for part in re.split(r"[,;]", env_dirs) if part.strip())
    if not raw_values:
        raw_values = [
            str(ACER_DOWNLOADED_PDFS_DIR),
            str(ACER_LOCAL_PDFS_DIR),
            str(LOCAL_PDFS_DIR),
        ]
    result: list[Path] = []
    seen: set[Path] = set()
    for raw in raw_values:
        path = Path(raw.strip()).expanduser()
        if not path.is_absolute():
            path = ROOT / path
        try:
            resolved = path.resolve()
        except Exception:
            resolved = path
        ensure_private_input_path(resolved)
        if resolved not in seen:
            seen.add(resolved)
            result.append(resolved)
    return result


def ensure_private_input_path(resolved: Path) -> None:
    """Allow only private Acer-downloaded PDFs or the local-pdfs corpus/mirror."""
    public = (ROOT / "public").resolve()
    if resolved == public or public in resolved.parents or "public" in resolved.parts:
        raise ValueError(f"Refusing input PDFs under public/: {resolved}")
    for root in [ACER_DOWNLOADED_PDFS_DIR, ACER_LOCAL_PDFS_DIR, LOCAL_PDFS_DIR]:
        try:
            allowed = root.resolve()
        except Exception:
            allowed = root
        if resolved == allowed or allowed in resolved.parents:
            return
    raise ValueError(
        "Refusing input outside the active private OCR corpus roots: "
        f"{resolved}. Use {ACER_DOWNLOADED_PDFS_DIR}, {ACER_LOCAL_PDFS_DIR}, or {LOCAL_PDFS_DIR.resolve()}."
    )


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key not in os.environ or os.environ.get(key, "").strip() == "":
            os.environ[key] = value


def ensure_private_output_dir(output_dir: Path, allow_unsafe: bool = False) -> None:
    resolved = output_dir.resolve()
    public = (ROOT / "public").resolve()
    if resolved == public or public in resolved.parents or "public" in resolved.parts:
        raise ValueError(f"Refusing to write OCR output under public/: {resolved}")
    if allow_unsafe:
        print(
            "WARNING: --allow-unsafe-output-dir is deprecated and will not bypass the private output guard.",
            file=sys.stderr,
        )
    for root in [ACER_OCR_ROOT, REPO_OCR_ROOT]:
        try:
            allowed = root.resolve()
        except Exception:
            allowed = root
        if resolved == allowed or allowed in resolved.parents:
            return
    raise ValueError(
        f"Refusing to write raw OCR output outside private OCR roots: {resolved}. "
        f"Use {ACER_OCR_ROOT} for Acer SSD output or {REPO_OCR_ROOT} for tiny repo-private tests."
    )


def ensure_private_tmp_dir(tmp_dir: Path) -> None:
    resolved = tmp_dir.resolve()
    public = (ROOT / "public").resolve()
    if resolved == public or public in resolved.parents or "public" in resolved.parts:
        raise ValueError(f"Refusing OCR tmp under public/: {resolved}")
    for root in [ACER_TMP_ROOT, ACER_OCR_ROOT / PRIVATE_TMP_DIR_NAME, REPO_OCR_ROOT / PRIVATE_TMP_DIR_NAME, ACER_OCR_ROOT, REPO_OCR_ROOT]:
        try:
            allowed = root.resolve()
        except Exception:
            allowed = root
        if resolved == allowed or allowed in resolved.parents:
            return
    raise ValueError(
        f"Refusing OCR tmp outside private tmp/OCR roots: {resolved}. "
        f"Use {ACER_TMP_ROOT} or <OCR_OUTPUT_DIR>/{PRIVATE_TMP_DIR_NAME}."
    )


def path_is_under_private_ocr_root(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    for root in [ACER_TMP_ROOT, ACER_OCR_ROOT, REPO_OCR_ROOT]:
        try:
            allowed = root.resolve()
        except Exception:
            allowed = root
        if resolved == allowed or allowed in resolved.parents:
            return True
    return False


def build_inventory(enrichment: EnrichmentIndex, config: Config, manifest: Manifest | None = None) -> list[PdfInfo]:
    pdf_paths: list[Path] = []
    for input_dir in config.input_dirs:
        if not input_dir.exists():
            print(f"WARN: input dir does not exist, skipping: {input_dir}", file=sys.stderr)
            continue
        if input_dir.is_file() and input_dir.suffix.lower() == ".pdf":
            pdf_paths.append(input_dir)
        else:
            pdf_paths.extend(sorted(input_dir.rglob("*.pdf")))
    unique_paths: list[Path] = []
    seen: set[Path] = set()
    for path in pdf_paths:
        try:
            key = path.resolve()
        except Exception:
            key = path
        ensure_private_input_path(key)
        if key not in seen:
            seen.add(key)
            unique_paths.append(path)
    if not unique_paths:
        raise FileNotFoundError(
            "No PDFs found under input dirs: "
            f"{', '.join(map(str, config.input_dirs))}. "
            f"Expected Acer downloaded PDFs under {ACER_DOWNLOADED_PDFS_DIR}, the Acer mirror under {ACER_LOCAL_PDFS_DIR}, or the repo local corpus under {LOCAL_PDFS_DIR}."
        )

    inventory: list[PdfInfo] = []
    for i, path in enumerate(unique_paths, start=1):
        try:
            inventory.append(build_pdf_info(path, enrichment, config))
        except Exception as exc:
            record_inventory_error(path, config, manifest, exc)
            print(f"WARN: recording unreadable PDF metadata {path}: {exc}", file=sys.stderr)
        if i % 250 == 0:
            print(f"  inventoried {i}/{len(unique_paths)} PDFs...", file=sys.stderr)
    return dedupe_inventory_by_content(inventory, config)


def build_targeted_inventory(tokens: list[str], enrichment: EnrichmentIndex, config: Config, manifest: Manifest | None = None) -> list[PdfInfo]:
    paths = resolve_pdf_tokens(tokens, config)
    if not paths:
        raise ValueError(f"--only-pdf matched no files: {tokens}")
    inventory: list[PdfInfo] = []
    seen: set[Path] = set()
    for path in paths:
        try:
            key = path.resolve()
        except Exception:
            key = path
        if key in seen:
            continue
        seen.add(key)
        if not path.exists() or path.suffix.lower() != ".pdf":
            continue
        try:
            inventory.append(build_pdf_info(path, enrichment, config))
        except Exception as exc:
            record_inventory_error(path, config, manifest, exc)
            print(f"WARN: recording unreadable targeted PDF metadata {path}: {exc}", file=sys.stderr)
    if not inventory and not config.inventory_errors:
        raise ValueError(f"--only-pdf matched no readable PDFs: {tokens}")
    return dedupe_inventory_by_content(inventory, config)


def dedupe_inventory_by_content(inventory: list[PdfInfo], config: Config) -> list[PdfInfo]:
    """Collapse mirrored/duplicate inputs while preserving source provenance.

    Operators may pass both the repo ``local-pdfs`` tree and the Acer mirror via
    ``OCR_INPUT_DIRS``.  The physical files should not be OCRed twice, but we
    still retain the provenance of every matching input file in summaries and
    aggregate/page-cache payloads.  SHA-256 is the primary identity because it is
    stable across mirrors even when mtimes differ.
    """
    config.inventory_duplicates = []
    grouped: dict[str, list[PdfInfo]] = defaultdict(list)
    for pdf in inventory:
        key = pdf_identity_key(pdf)
        grouped[key].append(dataclasses.replace(pdf, identity_key=key))

    unique: list[PdfInfo] = []
    for key, group in grouped.items():
        representative = choose_inventory_representative(group, config)
        provenance = input_provenance_for(key, representative, group)
        duplicate_rel_paths = sorted(
            {
                other.rel_path
                for other in group
                if other.rel_path != representative.rel_path
            }
        )
        unique.append(dataclasses.replace(
            representative,
            identity_key=key,
            duplicate_rel_paths=duplicate_rel_paths,
            input_provenance=provenance,
        ))
        if len(group) > 1:
            config.inventory_duplicates.append({
                "identity_key": key,
                "dedupe_basis": key.split(":", 1)[0],
                "representative_pdf_id": representative.pdf_id,
                "representative_path": representative.rel_path,
                "duplicate_count": len(group) - 1,
                "all_rel_paths": sorted({pdf.rel_path for pdf in group}),
                "all_physical_paths": [display_path(pdf.path) for pdf in group],
            })
    if config.inventory_duplicates:
        print(
            f"INFO: content/provenance dedupe collapsed {sum(item['duplicate_count'] for item in config.inventory_duplicates)} duplicate input PDF(s).",
            file=sys.stderr,
        )
    assert_unique_pdf_ids(unique)
    return unique


def assert_unique_pdf_ids(inventory: list[PdfInfo]) -> None:
    by_pdf_id: dict[str, list[PdfInfo]] = defaultdict(list)
    for pdf in inventory:
        by_pdf_id[pdf.pdf_id].append(pdf)
    conflicts = {
        pdf_id: rows
        for pdf_id, rows in by_pdf_id.items()
        if len({pdf.identity_key or pdf_identity_key(pdf) for pdf in rows}) > 1
    }
    if not conflicts:
        return
    examples = []
    for pdf_id, rows in list(conflicts.items())[:8]:
        examples.append({
            "pdf_id": pdf_id,
            "identities": sorted({pdf.identity_key or pdf_identity_key(pdf) for pdf in rows}),
            "paths": [display_path(pdf.path) for pdf in rows],
        })
    raise OcrError(
        "Input inventory contains the same pdf_id with different content hashes. "
        "This usually means the repo local-pdfs corpus and Acer mirror disagree; "
        f"use one input root or resync the mirror. Examples: {json_dumps(examples)}"
    )


def pdf_identity_key(pdf: PdfInfo) -> str:
    if pdf.sha256:
        return f"sha256:{pdf.sha256}"
    if pdf.drive_id:
        return f"drive:{pdf.drive_id}"
    return f"path:{normalize_rel_path(pdf.rel_path)}"


def choose_inventory_representative(group: list[PdfInfo], config: Config) -> PdfInfo:
    input_rank: dict[Path, int] = {}
    for idx, input_dir in enumerate(config.input_dirs):
        with contextlib.suppress(Exception):
            input_rank[input_dir.resolve()] = idx

    def configured_input_order(path: Path) -> int:
        try:
            resolved = path.resolve()
        except Exception:
            resolved = path
        best = len(input_rank) + 100
        for root, rank in input_rank.items():
            if resolved == root or root in resolved.parents:
                best = min(best, rank)
        return best

    def score(pdf: PdfInfo) -> tuple[Any, ...]:
        # Lower tuple wins. Prefer the first configured input root, richer
        # metadata, stable Drive IDs, and deterministic path order.
        return (
            configured_input_order(pdf.path),
            -pdf.metadata_score,
            -int(bool(pdf.drive_id)),
            -int(pdf.has_extracted_name),
            -int(pdf.has_known_links),
            pdf.rel_path,
            display_path(pdf.path),
        )

    return sorted(group, key=score)[0]


def input_provenance_for(key: str, representative: PdfInfo, group: list[PdfInfo]) -> dict[str, Any]:
    return {
        "identity_key": key,
        "dedupe_basis": key.split(":", 1)[0],
        "representative_rel_path": representative.rel_path,
        "representative_physical_path": display_path(representative.path),
        "duplicate_count": max(0, len(group) - 1),
        "all_rel_paths": sorted({pdf.rel_path for pdf in group}),
        "all_physical_paths": [display_path(pdf.path) for pdf in group],
    }


def record_inventory_error(path: Path, config: Config, manifest: Manifest | None, exc: Exception) -> None:
    """Record an unreadable PDF as a terminal PDF-level error instead of silently dropping it."""
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    stat_size = 0
    with contextlib.suppress(Exception):
        stat_size = int(path.stat().st_size)
    drive_id = extract_drive_id(path.name)
    rel_path = source_rel_path(path)
    if drive_id:
        pdf_id = f"drive_{drive_id}"
    else:
        stable = hashlib.sha1(str(resolved).encode("utf-8", errors="replace")).hexdigest()[:10]
        pdf_id = f"unreadable_{sanitize_id(path.stem)[:72]}_{stable}"
    error = truncate(redact_sensitive(exc), 2000)
    payload = {
        "pdf_id": pdf_id,
        "drive_id": drive_id,
        "path": rel_path,
        "byte_size": stat_size,
        "status": "terminal_pdf_error",
        "error": error,
    }
    if not any(item.get("pdf_id") == pdf_id for item in config.inventory_errors):
        config.inventory_errors.append(payload)
    if manifest:
        manifest.upsert_pdf_error(pdf_id, drive_id, rel_path, stat_size, error)
        manifest.event("error", "pdf_inventory_error", f"Terminal unreadable PDF metadata/rendering error: {error}", pdf_id=pdf_id, metadata={"path": rel_path, "byte_size": stat_size})


def resolve_pdf_tokens(tokens: list[str], config: Config) -> list[Path]:
    resolved: list[Path] = []
    for token in tokens:
        raw = safe_str(token)
        if not raw:
            continue
        path = Path(raw).expanduser()
        if not path.is_absolute():
            candidate_paths = [ROOT / path, ACER_LOCAL_PDFS_DIR / path.name]
            path = next((candidate for candidate in candidate_paths if candidate.exists()), candidate_paths[0])
        if path.exists() and path.suffix.lower() == ".pdf":
            try:
                path_resolved = path.resolve()
            except Exception:
                path_resolved = path
            ensure_private_input_path(path_resolved)
            resolved.append(path)
            continue
        drive_id = extract_drive_id(raw) or (raw.replace("drive_", "") if re.fullmatch(r"[A-Za-z0-9_-]{10,}", raw.replace("drive_", "")) else None)
        for input_dir in config.input_dirs:
            if not input_dir.exists():
                continue
            if input_dir.is_file() and input_dir.suffix.lower() == ".pdf":
                if drive_id and (drive_id == extract_drive_id(input_dir.name) or drive_id in input_dir.name):
                    ensure_private_input_path(input_dir.resolve())
                    resolved.append(input_dir)
                elif Path(raw).name in {input_dir.name, input_dir.stem}:
                    ensure_private_input_path(input_dir.resolve())
                    resolved.append(input_dir)
                continue
            if drive_id:
                for candidate in sorted(input_dir.rglob(f"drive_{drive_id}.pdf")) + sorted(input_dir.rglob(f"*{drive_id}*.pdf")):
                    ensure_private_input_path(candidate.resolve())
                    resolved.append(candidate)
            for candidate in sorted(input_dir.rglob(Path(raw).name)):
                ensure_private_input_path(candidate.resolve())
                resolved.append(candidate)
    return resolved


def build_pdf_info(path: Path, enrichment: EnrichmentIndex, config: Config) -> PdfInfo:
    ensure_private_input_path(path.resolve())
    stat = path.stat()
    page_count, text_word_count = inspect_pdf(path)
    drive_id = extract_drive_id(path.name)
    rel_path = source_rel_path(path)
    sha = file_sha256(path)
    source_meta = {}
    if config.source_metadata_index is not None and hasattr(config.source_metadata_index, "lookup"):
        with contextlib.suppress(Exception):
            source_meta = config.source_metadata_index.lookup(path, sha) or {}
    source_site = infer_source_site(path, config, source_meta)
    source_url = nullable_str(first_nonempty(source_meta.get("source_url"), source_meta.get("final_url")))
    if drive_id:
        pdf_id = f"drive_{drive_id}"
    else:
        stable_key = source_url or rel_path
        prefix = sanitize_id(source_site or "pdf")
        pdf_id = f"{prefix}_{sanitize_id(path.stem)[:72]}_{hashlib.sha1(stable_key.encode('utf-8')).hexdigest()[:10]}"
    pseudo = PdfInfo(
        pdf_id=pdf_id,
        drive_id=drive_id,
        path=path,
        rel_path=rel_path,
        page_count=page_count,
        byte_size=stat.st_size,
        mtime_ns=stat.st_mtime_ns,
        text_word_count=text_word_count,
        metadata_score=0,
        has_extracted_name=False,
        has_known_links=False,
        source_site=source_site,
        source_url=source_url,
        sha256=sha,
        source_metadata=source_meta,
        identity_key=f"sha256:{sha}" if sha else None,
        input_provenance={
            "identity_key": f"sha256:{sha}" if sha else None,
            "dedupe_basis": "sha256" if sha else None,
            "representative_rel_path": rel_path,
            "representative_physical_path": display_path(path),
            "duplicate_count": 0,
            "all_rel_paths": [rel_path],
            "all_physical_paths": [display_path(path)],
        },
    )
    records = enrichment.records_for_pdf(pseudo)
    known_links = enrichment.known_links_for_records(records)
    has_extracted_name = any(safe_str(rec.get("topperName")) and safe_str(rec.get("nameStatus")).lower() == "extracted" for rec in records)
    named_count = sum(1 for rec in records if safe_str(rec.get("topperName")) and safe_str(rec.get("nameStatus")).lower() != "unavailable")
    metadata_score = (len(records) * 3) + (10 if has_extracted_name else 0) + (4 if named_count else 0) + (8 if known_links else 0)
    return dataclasses.replace(pseudo, metadata_score=metadata_score, has_extracted_name=has_extracted_name, has_known_links=bool(known_links))


def infer_source_site(path: Path, config: Config, meta: Any | None = None) -> str:
    ensure_private_input_path(path.resolve())
    if isinstance(meta, dict):
        for key in ["source_site", "source", "source_label", "adapter"]:
            value = safe_str(meta.get(key))
            if value:
                return normalize_key(value).replace("_", "-") or "downloaded"
    with contextlib.suppress(Exception):
        rel = path.resolve().relative_to(ACER_DOWNLOADED_PDFS_DIR.resolve())
        if rel.parts:
            return safe_str(rel.parts[0]) or "downloaded"
    _ = config
    return "local"


def source_rel_path(path: Path) -> str:
    """Return a stable corpus-relative path for repo and Acer mirror inputs.

    The Acer SSD may be used for the physical PDF reads to save MacBook disk
    pressure, but cache/aggregate identity should remain the same as the
    repo-local corpus path (`local-pdfs/...`) so project metadata joins and
    reruns are stable across the two mirrors.
    """
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    for root in [LOCAL_PDFS_DIR, ACER_LOCAL_PDFS_DIR]:
        with contextlib.suppress(Exception):
            rel = resolved.relative_to(root.resolve())
            return normalize_rel_path(str(Path("local-pdfs") / rel))
    with contextlib.suppress(Exception):
        rel = resolved.relative_to(ACER_DOWNLOADED_PDFS_DIR.resolve())
        return normalize_rel_path(str(Path("downloaded-pdfs") / rel))
    with contextlib.suppress(Exception):
        return normalize_rel_path(str(resolved.relative_to(ROOT.resolve())))
    return normalize_rel_path(path.name)


def file_sha256(path: Path, chunk_size: int = 1024 * 1024 * 4) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_pdf(path: Path) -> tuple[int, int]:
    fz = require_fitz()
    with fz.open(path) as doc:
        page_count = len(doc)
        word_count = 0
        for page_index in range(min(page_count, 5)):
            with contextlib.suppress(Exception):
                word_count += len((doc[page_index].get_text("text") or "").split())
        return page_count, word_count


def apply_priority_order(inventory: list[PdfInfo]) -> list[PdfInfo]:
    def key(pdf: PdfInfo) -> tuple[Any, ...]:
        return (-pdf.metadata_score, -int(pdf.has_extracted_name), -int(pdf.has_known_links), pdf.page_count, pdf.byte_size, pdf.rel_path)
    ordered = sorted(inventory, key=key)
    return [dataclasses.replace(pdf, priority_rank=i + 1) for i, pdf in enumerate(ordered)]


def select_inventory(inventory: list[PdfInfo], args: argparse.Namespace) -> list[PdfInfo]:
    selected = inventory
    if args.only_pdf:
        wanted = {normalize_only_pdf_token(token) for token in args.only_pdf}
        selected = [pdf for pdf in selected if pdf_matches_tokens(pdf, wanted)]
        if not selected:
            raise ValueError(f"--only-pdf matched no inventory rows: {args.only_pdf}")
    if args.shard:
        shard_index, shard_total = parse_shard(args.shard)
        selected = [pdf for idx, pdf in enumerate(selected) if idx % shard_total == shard_index]
    if args.limit_pdfs is not None:
        selected = selected[: max(0, args.limit_pdfs)]
    return selected


def build_smoke_inventory(args: argparse.Namespace, config: Config) -> list[PdfInfo]:
    candidates: list[Path] = []
    if args.only_pdf:
        candidates.extend(resolve_pdf_tokens(args.only_pdf, config))
    if not candidates:
        for input_dir in config.input_dirs:
            if input_dir.exists():
                with contextlib.suppress(StopIteration):
                    candidates.append(next(iter(sorted(input_dir.rglob("*.pdf")))))
                    break
    inventory: list[PdfInfo] = []
    for path in candidates[:1]:
        try:
            inventory.append(build_pdf_info(path, EnrichmentIndex(), config))
        except Exception as exc:
            print(f"WARN: could not inspect smoke-test PDF {path}: {exc}", file=sys.stderr)
    return inventory


def select_pilot_pdfs(inventory: list[PdfInfo], limit: int | None = None) -> list[PdfInfo]:
    if not inventory:
        return []
    if limit is not None:
        return inventory[: max(0, limit)]
    selected: list[PdfInfo] = []
    def add(pdf: PdfInfo | None) -> None:
        if pdf and all(existing.pdf_id != pdf.pdf_id for existing in selected):
            selected.append(pdf)
    sorted_by_pages = sorted(inventory, key=lambda pdf: (pdf.page_count, pdf.byte_size, pdf.rel_path))
    add(next((pdf for pdf in sorted_by_pages if pdf.page_count > 0), None))
    add(sorted_by_pages[len(sorted_by_pages) // 2] if sorted_by_pages else None)
    add(max(inventory, key=lambda pdf: (pdf.page_count, pdf.byte_size)))
    add(max(inventory, key=lambda pdf: (pdf.text_word_count, -pdf.page_count, -pdf.byte_size), default=None))
    for pdf in inventory:
        if len(selected) >= 4:
            break
        add(pdf)
    return selected


def run_estimate(run_id: str, all_inventory: list[PdfInfo], selected: list[PdfInfo], config: Config, manifest: Manifest, args: argparse.Namespace) -> dict[str, Any]:
    total_pages = sum(pdf.page_count for pdf in all_inventory)
    selected_pages = sum(pdf.page_count for pdf in selected)
    cache_counts = count_cache(selected, config)
    total_discovered_pdfs = len(all_inventory) + len(config.inventory_errors)
    shard_summary = None
    if args.shard:
        shard_index, shard_total = parse_shard(args.shard)
        shard_summary = {
            "selected_shard": f"{shard_index}/{shard_total}",
            "all_shards": [
                {"shard": f"{shard}/{shard_total}", "pdfs": len(rows), "pages": sum(p.page_count for p in rows)}
                for shard in range(shard_total)
                for rows in [[pdf for idx, pdf in enumerate(all_inventory) if idx % shard_total == shard]]
            ],
        }
    summary = {
        "run_id": run_id,
        "mode": "estimate",
        "generated_at": iso_now(),
        "api_calls_made": 0,
        "target": [display_path(p) for p in config.input_dirs],
        "all_pdfs": total_discovered_pdfs,
        "readable_pdfs": len(all_inventory),
        "unreadable_pdfs": len(config.inventory_errors),
        "inventory_errors": config.inventory_errors[:50],
        "all_pages": total_pages,
        "all_size_gb": round(sum(pdf.byte_size for pdf in all_inventory) / (1024 ** 3), 3),
        "selected_pdfs": len(selected),
        "selected_pages": selected_pages,
        "selected_size_gb": round(sum(pdf.byte_size for pdf in selected) / (1024 ** 3), 3),
        "output_dir": display_path(config.output_dir),
        "tmp_dir": display_path(config.tmp_dir) if config.tmp_dir else None,
        "expected_outputs": {"manifest_sqlite": display_path(config.output_dir / "manifest.sqlite"), "manifest_json": display_path(config.output_dir / "manifest.json"), "events_jsonl": display_path(config.output_dir / "events.jsonl"), "pdfs_dir": display_path(config.output_dir / "pdfs"), "page_cache_dir": display_path(config.output_dir / "page-cache")},
        "current_settings": {"model": config.model or None, "model_note": None if config.model else "OCR_OPENAI_MODEL unset; cache cannot be considered valid for current settings because model is part of the cache fingerprint.", "prompt_version": config.prompt_version, "render": config.render.fingerprint_dict(), "fingerprint": config.prompt_fingerprint},
        "cache": cache_counts,
        "input_dedupe": {
            "duplicate_groups": len(config.inventory_duplicates),
            "duplicate_pdf_files_collapsed": sum(int(item.get("duplicate_count") or 0) for item in config.inventory_duplicates),
            "examples": config.inventory_duplicates[:DUPLICATE_PROVENANCE_LIMIT],
        },
        "projected_cost": estimate_cost(cache_counts["remaining_pages"], None, config),
        "largest_by_pages": [pdf_summary(pdf) for pdf in sorted(all_inventory, key=lambda pdf: (pdf.page_count, pdf.byte_size), reverse=True)[:10]],
        "largest_by_size": [pdf_summary(pdf) for pdf in sorted(all_inventory, key=lambda pdf: pdf.byte_size, reverse=True)[:10]],
        "source_site_counts": Counter(pdf.source_site or "unknown" for pdf in all_inventory),
        "shard_summary": shard_summary,
        "selected_preview": [pdf_summary(pdf) for pdf in selected[:20]],
    }
    manifest.event("info", "estimate_complete", "Estimate completed without API calls", run_id=run_id, metadata={"selected_pages": selected_pages})
    return summary


def verify_key_and_model(config: Config, inventory: list[PdfInfo], manifest: Manifest, run_id: str) -> dict[str, Any]:
    if not config.api_key:
        raise AuthError("OPENAI_API_KEY is missing. Put the key in .env.local or the environment before OCR.")
    if not config.model:
        raise ValueError("OCR_OPENAI_MODEL/--model is required; verification will not auto-select a paid OCR model.")
    models_url = f"{config.v1_base}/models"
    model_ids: list[str] = []
    model_list_error: str | None = None
    manifest.event("info", "verify_models_start", f"Fetching model list from {config.base_url_host}", run_id=run_id)
    try:
        model_ids = extract_model_ids(http_json("GET", models_url, config.api_key, timeout=config.request_timeout))
    except AuthError:
        raise
    except ApiError as exc:
        model_list_error = str(exc)
        manifest.event("error", "models_fetch_failed", "Model list failed; verification requires GET /v1/models to succeed", run_id=run_id, metadata={"status": exc.status, "error": truncate(redact_sensitive(exc), 1000)})
        raise ValueError(f"/v1/models failed for {config.base_url_host}; verification requires model-list success before OCR: {redact_sensitive(exc)}") from exc
    if not model_ids:
        manifest.event("error", "models_empty", "Model list returned no model IDs; verification requires a non-empty /v1/models result", run_id=run_id)
        raise ValueError(f"/v1/models returned no model IDs for {config.base_url_host}; verification requires a non-empty model list before OCR.")
    candidates = [config.model]
    if model_ids and config.model not in model_ids:
        raise ValueError(f"OCR_OPENAI_MODEL/--model {config.model!r} was not present in /v1/models for {config.base_url_host}.")

    nonce = f"{SMOKE_NONCE_PREFIX}_{sha256_json({'run_id': run_id, 'host': config.base_url_host, 'ts': iso_now()})[:10]}".upper()
    smoke_image = render_smoke_image(nonce)
    errors: list[str] = []
    include_reasoning = config.include_reasoning
    for candidate in candidates:
        try:
            response, include_reasoning = call_responses(
                config,
                model=candidate,
                content=[{"type": "input_text", "text": f"Return strict JSON only as {{\"ok\": true, \"visible_text\": string}}. Read the visible nonce in the image exactly; it starts with {SMOKE_NONCE_PREFIX}."}, {"type": "input_image", "image_url": smoke_image}],
                max_output_tokens=200,
                include_reasoning=include_reasoning,
            )
            text = extract_response_text(response)
            parsed = parse_json_text(text)
            visible_text = safe_str(parsed.get("visible_text"))
            if parsed.get("ok") is not True:
                raise JsonParseError(f"Smoke response did not return ok=true: {truncate(text, 500)}")
            if normalize_smoke_text(nonce) not in normalize_smoke_text(visible_text):
                raise JsonParseError(f"Smoke response did not read nonce {nonce!r}; visible_text={truncate(visible_text, 300)!r}")
            manifest.event("info", "vision_smoke_passed", f"Vision smoke test passed for model {candidate}", run_id=run_id)
            return {"verified_at": iso_now(), "base_url": config.base_url, "base_url_host": config.base_url_host, "model": candidate, "models_seen": len(model_ids), "model_list_error": redact_sensitive(model_list_error), "model_list_contains_selected": candidate in model_ids if model_ids else None, "include_reasoning": include_reasoning, "prompt_version": config.prompt_version, "render": config.render.fingerprint_dict(), "max_output_tokens": config.max_output_tokens, "prompt_fingerprint": prompt_fingerprint_for(candidate, config.prompt_version, config.render, config.max_output_tokens, config.base_url_host), "smoke_test": {"ok": True, "nonce": nonce, "visible_text": visible_text}, "input_scope": INPUT_SCOPE}
        except Exception as exc:
            errors.append(f"{candidate}: {redact_sensitive(exc)}")
            manifest.event("warning", "vision_smoke_candidate_failed", f"Vision smoke failed for {candidate}: {redact_sensitive(exc)}", run_id=run_id)
            if config.model:
                break
    raise ValueError("No candidate model passed the vision smoke test. " + " | ".join(errors[:6]))


def run_batch(run_id: str, selected_pdfs: list[PdfInfo], all_inventory: list[PdfInfo], config: Config, manifest: Manifest, enrichment: EnrichmentIndex, mode: str) -> RunStats:
    check_disk_free(config.output_dir, config.min_free_gb)
    rate_limiter = RateLimiter(config.rpm_limit)
    stop_event = threading.Event()
    stats = RunStats()
    if not selected_pdfs:
        manifest.event("warning", "batch_empty", f"No PDFs selected for {mode}", run_id=run_id)
        return stats

    for pdf_index, pdf in enumerate(selected_pdfs, start=1):
        if stop_event.is_set():
            break
        manifest.upsert_pdf(pdf, status="running")
        records = enrichment.records_for_pdf(pdf)
        known_links = enrichment.known_links_for_records(records)
        context = build_known_context(pdf, records, known_links)
        valid_pages, invalid_pages = cache_status_for_pdf(pdf, config)
        pages_to_process = list(range(1, pdf.page_count + 1)) if config.force_pages else invalid_pages
        skipped = pdf.page_count - len(pages_to_process)
        stats.pages_skipped_cached += max(0, skipped)
        print(f"[{mode}] PDF {pdf_index}/{len(selected_pdfs)} {pdf.rel_path} pages={pdf.page_count} cached={skipped} todo={len(pages_to_process)}")
        manifest.event("info", "pdf_start", f"Starting {pdf.rel_path}", run_id=run_id, pdf_id=pdf.pdf_id, metadata={"page_count": pdf.page_count, "cached": skipped, "todo": len(pages_to_process)})

        completed_for_pdf = len(valid_pages) if not config.force_pages else 0
        failed_for_pdf = 0
        if valid_pages and not config.force_pages:
            sync_cached_pages_to_manifest(pdf, valid_pages, config, manifest)
        if pages_to_process:
            with concurrent.futures.ThreadPoolExecutor(max_workers=config.concurrency) as executor:
                future_to_task: dict[concurrent.futures.Future[PageResult], PageTask] = {}
                for page_number in pages_to_process:
                    if stop_event.is_set():
                        break
                    task = PageTask(pdf=pdf, page_number=page_number, run_id=run_id, known_context=context)
                    if not manifest.claim_page(pdf, page_number, config, run_id=run_id):
                        manifest.event("info", "page_claim_skipped", "Skipping page already in_progress in another fresh worker", run_id=run_id, pdf_id=pdf.pdf_id, page_number=page_number)
                        continue
                    future_to_task[executor.submit(process_page, task, config, rate_limiter, stop_event)] = task
                    stats.pages_attempted += 1
                for future in concurrent.futures.as_completed(future_to_task):
                    task = future_to_task[future]
                    try:
                        result = future.result()
                        manifest.mark_page(task.pdf, task.page_number, "done", config, latency_ms=result.latency_ms, usage=result.usage)
                        stats.pages_completed += 1
                        stats.merge_usage(result.usage)
                        stats.latencies_ms.append(result.latency_ms)
                        stats.api_calls_made += result.api_calls
                        stats.retry_attempts += result.retry_attempts
                        stats.rate_limited_attempts += result.rate_limited_attempts
                        stats.repair_calls += result.repair_calls
                        completed_for_pdf += 1
                    except AuthError as exc:
                        stats.auth_error = redact_sensitive(exc)
                        stop_event.set()
                        failed_for_pdf += 1
                        stats.pages_failed += 1
                        manifest.mark_page(task.pdf, task.page_number, "error", config, error=redact_sensitive(exc))
                        manifest.event("error", "auth_error_abort", redact_sensitive(exc), run_id=run_id, pdf_id=task.pdf.pdf_id, page_number=task.page_number)
                    except Exception as exc:
                        failed_for_pdf += 1
                        stats.pages_failed += 1
                        if isinstance(exc, PageProcessingError):
                            stats.api_calls_made += exc.api_calls
                            stats.retry_attempts += max(0, exc.api_calls - exc.repair_calls - 1)
                            stats.rate_limited_attempts += sum(1 for status in exc.status_history if safe_int(status, -1) == 429)
                            stats.repair_calls += exc.repair_calls
                            stats.merge_usage(exc.usage)
                        if isinstance(exc, ApiError) and exc.status == 429:
                            stats.repeated_429 += 1
                        manifest.mark_page(task.pdf, task.page_number, "error", config, error=redact_sensitive(exc))
                        manifest.event("error", "page_failed", redact_sensitive(exc), run_id=run_id, pdf_id=task.pdf.pdf_id, page_number=task.page_number, metadata={"traceback": redact_sensitive(traceback.format_exc(limit=3))})
                    finally:
                        if (stats.pages_completed + stats.pages_failed) and (stats.pages_completed + stats.pages_failed) % 25 == 0:
                            print(f"  progress pages done={stats.pages_completed} failed={stats.pages_failed} cached={stats.pages_skipped_cached}")
                    if stop_event.is_set():
                        for fut in future_to_task:
                            fut.cancel()
                        break
        try:
            aggregate = build_pdf_aggregate(pdf, config, enrichment)
            if aggregate:
                write_pdf_outputs(config, aggregate)
        except Exception as exc:
            failed_for_pdf += 1
            manifest.event("error", "aggregate_failed", redact_sensitive(exc), run_id=run_id, pdf_id=pdf.pdf_id)
            print(f"WARN: aggregate failed for {pdf.rel_path}: {redact_sensitive(exc)}", file=sys.stderr)
        pdf_status = "done" if completed_for_pdf >= pdf.page_count and failed_for_pdf == 0 else ("error" if failed_for_pdf else "partial")
        manifest.update_pdf_counts(pdf.pdf_id, pdf_status, completed_for_pdf, failed_for_pdf)
        stats.pdfs_processed += 1
        if failed_for_pdf:
            stats.pdfs_failed += 1
        manifest.event("info", "pdf_finish", f"Finished {pdf.rel_path} with status={pdf_status}", run_id=run_id, pdf_id=pdf.pdf_id, metadata={"completed": completed_for_pdf, "failed": failed_for_pdf})
    return stats


def process_page(task: PageTask, config: Config, rate_limiter: RateLimiter, stop_event: threading.Event) -> PageResult:
    if stop_event.is_set():
        raise OcrError("Run is stopping")
    start = time.monotonic()
    image_url = render_page_data_url(task.pdf.path, task.page_number, config.render)
    if config.save_images:
        save_rendered_image(config, task.pdf, task.page_number, image_url)
    content = [{"type": "input_text", "text": build_page_prompt(task)}, {"type": "input_image", "image_url": image_url}]
    response, include_reasoning, api_calls, status_history = call_responses_with_retries(config, content, rate_limiter, stop_event, max_output_tokens=config.max_output_tokens)
    if include_reasoning != config.include_reasoning:
        config.include_reasoning = include_reasoning
    incomplete_reason = response_incomplete_reason(response)
    text = extract_response_text(response)
    usage = normalize_usage(response.get("usage") if isinstance(response, dict) else {})
    repair_used = False
    repair_calls = 0
    if incomplete_reason:
        raise PageProcessingError(f"Responses API indicated incomplete/truncated OCR output: {incomplete_reason}", usage=usage, api_calls=api_calls, status_history=status_history, repair_calls=repair_calls)
    try:
        parsed = parse_json_text(text)
    except Exception as parse_exc:
        try:
            parsed, repair_usage, repair_api_calls, repair_status_history = repair_json_response(config, text, rate_limiter, stop_event)
            usage = add_usage(usage, repair_usage)
            api_calls += repair_api_calls
            status_history.extend(repair_status_history)
            repair_used = True
            repair_calls += repair_api_calls
        except Exception as repair_exc:
            raise PageProcessingError(str(repair_exc), usage=usage, api_calls=api_calls, status_history=status_history, repair_calls=repair_calls) from parse_exc
    try:
        normalized = normalize_page_payload(parsed)
        if not normalized["ocr_markdown"].strip() and not normalized["illegible_regions"]:
            raise JsonParseError("OCR response had empty ocr_markdown and no illegible/blank-page explanation")
    except Exception as exc:
        raise PageProcessingError(str(exc), usage=usage, api_calls=api_calls, status_history=status_history, repair_calls=repair_calls) from exc
    latency_ms = int((time.monotonic() - start) * 1000)
    retry_attempts = max(0, api_calls - repair_calls - 1)
    rate_limited_attempts = sum(1 for status in status_history if safe_int(status, -1) == 429)
    payload = build_page_cache_payload(task, config, normalized, usage, latency_ms, api_metadata={
        "response_id": safe_str(response.get("id")) if isinstance(response, dict) else None,
        "status": safe_str(response.get("status")) if isinstance(response, dict) else None,
        "status_history": status_history,
        "api_calls": api_calls,
        "retry_attempts": retry_attempts,
        "rate_limited_attempts": rate_limited_attempts,
        "repair_used": repair_used,
        "repair_calls": repair_calls,
    })
    write_page_cache(config, payload)
    return PageResult(
        task=task,
        cache_payload=payload,
        latency_ms=latency_ms,
        usage=usage,
        api_calls=api_calls,
        retry_attempts=retry_attempts,
        rate_limited_attempts=rate_limited_attempts,
        repair_calls=repair_calls,
    )


def call_responses_with_retries(config: Config, content: list[dict[str, Any]], rate_limiter: RateLimiter, stop_event: threading.Event, max_output_tokens: int) -> tuple[dict[str, Any], bool, int, list[int | str]]:
    include_reasoning = config.include_reasoning
    last_error: Exception | None = None
    api_calls = 0
    status_history: list[int | str] = []
    for attempt in range(config.max_retries + 1):
        if stop_event.is_set():
            raise OcrError("Run is stopping")
        try:
            rate_limiter.wait()
            api_calls += 1
            response, include_reasoning = call_responses(config, config.model, content, max_output_tokens, include_reasoning)
            status_history.append(200)
            return response, include_reasoning, api_calls, status_history
        except AuthError:
            raise
        except ApiError as exc:
            last_error = exc
            status_history.append(exc.status or "api_error")
            if exc.status in AUTH_STATUSES:
                raise AuthError(str(exc))
            if is_reasoning_param_error(exc) and include_reasoning:
                include_reasoning = False
                continue
            if exc.status not in RETRY_STATUSES:
                raise
            if attempt >= config.max_retries:
                raise
            sleep_for = retry_sleep_seconds(exc, attempt)
            if exc.status == 429:
                # Throttle all workers, not just this one, so a shared key/proxy
                # does not get hammered by concurrent retry storms.
                rate_limiter.pause_for(sleep_for)
            time.sleep(sleep_for)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            status_history.append("network_error")
            if attempt >= config.max_retries:
                raise ApiError(None, f"Network error after retries: {exc}") from exc
            time.sleep(backoff_with_jitter(attempt))
    raise ApiError(None, f"API call failed after retries: {last_error}")


def call_responses(config: Config, model: str, content: list[dict[str, Any]], max_output_tokens: int, include_reasoning: bool) -> tuple[dict[str, Any], bool]:
    normalized_content = []
    for part in content:
        if isinstance(part, dict) and part.get("type") == "input_image" and "detail" not in part:
            part = {**part, "detail": "high"}
        normalized_content.append(part)
    payload: dict[str, Any] = {"model": model, "input": [{"role": "user", "content": normalized_content}], "max_output_tokens": max_output_tokens, "store": False}
    if include_reasoning:
        payload["reasoning"] = {"effort": "low"}
    try:
        return http_json("POST", f"{config.v1_base}/responses", config.api_key, payload=payload, timeout=config.request_timeout), include_reasoning
    except ApiError as exc:
        if include_reasoning and is_reasoning_param_error(exc):
            payload.pop("reasoning", None)
            return http_json("POST", f"{config.v1_base}/responses", config.api_key, payload=payload, timeout=config.request_timeout), False
        raise


def repair_json_response(config: Config, invalid_text: str, rate_limiter: RateLimiter, stop_event: threading.Event) -> tuple[dict[str, Any], dict[str, int], int, list[int | str]]:
    repair_prompt = "Return strict JSON only. Repair this OCR response into shape {\"ocr_markdown\": string, \"visible_metadata\": object, \"question_starts\": array, \"answer_signals\": object, \"confidence\": number, \"illegible_regions\": array}. Preserve content; do not invent.\n\n" + truncate(invalid_text, 12000)
    response, include_reasoning, api_calls, status_history = call_responses_with_retries(config, [{"type": "input_text", "text": repair_prompt}], rate_limiter, stop_event, max_output_tokens=config.max_output_tokens)
    if include_reasoning != config.include_reasoning:
        config.include_reasoning = include_reasoning
    incomplete_reason = response_incomplete_reason(response)
    if incomplete_reason:
        raise OcrError(f"Responses API indicated incomplete/truncated JSON repair output: {incomplete_reason}")
    return parse_json_text(extract_response_text(response)), normalize_usage(response.get("usage") if isinstance(response, dict) else {}), api_calls, status_history


def build_page_prompt(task: PageTask) -> str:
    context_bits = {
        "page_number": task.page_number,
        "page_count": task.pdf.page_count,
        "input_scope": INPUT_SCOPE,
    }
    return textwrap.dedent(f"""
        You are performing high-accuracy OCR of one UPSC topper-copy PDF page.
        Return STRICT JSON ONLY. Do not wrap in markdown fences. Do not add prose outside JSON.

        Required top-level keys:
        - ocr_markdown: string. Full verbatim page transcription. Preserve line breaks where useful. Do not summarize. Use [illegible] for unreadable spans. Include printed text, handwriting, headings, marginalia, page labels, and examiner marks.
        - visible_metadata: object with keys topper_name, exam, test_name, year, paper, institute. Use null if not visible.
        - question_starts: array of objects with question_number, question_text, confidence. Include only questions that visibly start on this page.
        - answer_signals: object with keys summary, value_additions, examiner_remarks, diagrams, maps, flowcharts, marks_or_scores. Arrays should be arrays even if empty. summary is concise per-page answer summary, not a replacement for ocr_markdown.
        - confidence: number between 0 and 1 for OCR reliability.
        - illegible_regions: array of short descriptions of unreadable areas.

        Critical rules:
        - Never invent missing text, names, scores, or facts.
        - `ocr_markdown` must contain only text visibly present in the image. Do not use project context hints inside `ocr_markdown`.
        - Keep examiner remarks separate from student answer text.
        - Capture ticks, circled marks, underlines, arrows, corrections, "good", "intro?", marginal notes, and scores.
        - Extract value additions such as quotes, data, committees, reports, case laws, examples, schemes, constitutional articles, maps, and diagrams.

        Non-identifying page context (do not infer text from this; transcribe the image only):
        {json_dumps(context_bits, indent=2)}
    """).strip()


def build_known_context(pdf: PdfInfo, records: list[dict[str, Any]], known_links: list[dict[str, Any]]) -> dict[str, Any]:
    topper = choose_topper_from_records(records)
    source_meta = pdf.source_metadata if isinstance(pdf.source_metadata, dict) else {}
    metadata = {
        "topper_name": first_nonempty(topper.get("name"), source_meta.get("topper_name")),
        "topper_confidence": topper.get("confidence"),
        "topper_sources": topper.get("sources"),
        "paper": first_nonempty((rec.get("paper") for rec in records), source_meta.get("paper"), source_meta.get("subject")),
        "year": first_nonempty((rec.get("year") or rec.get("estimatedYear") for rec in records), source_meta.get("year")),
        "institute": first_nonempty((rec.get("institute") for rec in records), source_meta.get("institute"), source_meta.get("source_label")),
        "source_site": pdf.source_site,
        "source_url": pdf.source_url,
    }
    return {"metadata": metadata, "records": records[:200], "known_links": known_links[:200]}


def normalize_page_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    visible = parsed.get("visible_metadata") if isinstance(parsed.get("visible_metadata"), dict) else {}
    signals = parsed.get("answer_signals") if isinstance(parsed.get("answer_signals"), dict) else {}
    normalized_signals = {"summary": safe_str(signals.get("summary")), "value_additions": ensure_list(signals.get("value_additions")), "examiner_remarks": ensure_list(signals.get("examiner_remarks")), "diagrams": ensure_list(signals.get("diagrams")), "maps": ensure_list(signals.get("maps")), "flowcharts": ensure_list(signals.get("flowcharts")), "marks_or_scores": ensure_list(signals.get("marks_or_scores"))}
    question_starts = []
    for item in ensure_list(parsed.get("question_starts")):
        if isinstance(item, dict):
            question_starts.append({"question_number": safe_str(item.get("question_number")) or None, "question_text": safe_str(item.get("question_text")), "confidence": clamp_float(item.get("confidence"), 0.0, 1.0, default=0.0)})
        elif safe_str(item):
            question_starts.append({"question_number": None, "question_text": safe_str(item), "confidence": 0.0})
    return {"ocr_markdown": safe_str(parsed.get("ocr_markdown") or parsed.get("markdown") or parsed.get("text")), "visible_metadata": {"topper_name": nullable_str(visible.get("topper_name")), "exam": nullable_str(visible.get("exam")), "test_name": nullable_str(visible.get("test_name")), "year": nullable_str(visible.get("year")), "paper": nullable_str(visible.get("paper")), "institute": nullable_str(visible.get("institute"))}, "question_starts": question_starts, "answer_signals": normalized_signals, "confidence": clamp_float(parsed.get("confidence"), 0.0, 1.0, default=0.0), "illegible_regions": ensure_list(parsed.get("illegible_regions"))}


def build_page_cache_payload(task: PageTask, config: Config, normalized: dict[str, Any], usage: dict[str, int], latency_ms: int, api_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "schema_version": CACHE_SCHEMA_VERSION,
        "input_scope": INPUT_SCOPE,
        "prompt_template_hash": PROMPT_TEMPLATE_HASH,
        "pdf_id": task.pdf.pdf_id,
        "drive_id": task.pdf.drive_id,
        "pdf_path": task.pdf.rel_path,
        "sha256": task.pdf.sha256,
        "source_identity": task.pdf.identity_key or pdf_identity_key(task.pdf),
        "input_provenance": redact_for_json(task.pdf.input_provenance),
        "duplicate_rel_paths": task.pdf.duplicate_rel_paths,
        "page_number": task.page_number,
        "page_count": task.pdf.page_count,
        "source_site": task.pdf.source_site,
        "source_url": task.pdf.source_url,
        "source_metadata": redact_for_json(task.pdf.source_metadata),
        "source_pdf": {
            "rel_path": task.pdf.rel_path,
            "byte_size": task.pdf.byte_size,
            "mtime_ns": task.pdf.mtime_ns,
            "sha256": task.pdf.sha256,
            "identity_key": task.pdf.identity_key or pdf_identity_key(task.pdf),
            "input_provenance": redact_for_json(task.pdf.input_provenance),
            "source_site": task.pdf.source_site,
            "source_url": task.pdf.source_url,
        },
        "source_pdf_byte_size": task.pdf.byte_size,
        "source_pdf_mtime_ns": task.pdf.mtime_ns,
        "model": config.model,
        "base_url_host": config.base_url_host,
        "prompt_version": config.prompt_version,
        "fingerprint": config.prompt_fingerprint,
        "render": config.render.fingerprint_dict(),
        "status": "done",
        "ocr_markdown": normalized["ocr_markdown"],
        "visible_metadata": normalized["visible_metadata"],
        "question_starts": normalized["question_starts"],
        "answer_signals": normalized["answer_signals"],
        "confidence": normalized["confidence"],
        "illegible_regions": normalized["illegible_regions"],
        "usage": usage,
        "api": api_metadata or {},
        "latency_ms": latency_ms,
        "created_at": iso_now(),
    }


def render_page_data_url(pdf_path: Path, page_number: int, render: RenderSettings) -> str:
    fz = require_fitz()
    with fz.open(pdf_path) as doc:
        if page_number < 1 or page_number > len(doc):
            raise ValueError(f"page {page_number} out of range for {pdf_path}")
        pix = doc.load_page(page_number - 1).get_pixmap(matrix=fz.Matrix(render.scale, render.scale), alpha=False)
        return "data:image/jpeg;base64," + base64.b64encode(pix.tobytes("jpeg", jpg_quality=render.jpeg_quality)).decode("ascii")


def render_smoke_image(nonce: str) -> str:
    fz = require_fitz()
    doc = fz.open()
    try:
        page = doc.new_page(width=560, height=180)
        page.insert_text((34, 94), nonce, fontsize=30, fontname="helv", color=(0, 0, 0))
        page.insert_text((34, 132), "OpenAI vision OCR smoke test", fontsize=14, fontname="helv", color=(0, 0, 0))
        pix = page.get_pixmap(matrix=fz.Matrix(2, 2), alpha=False)
        return "data:image/jpeg;base64," + base64.b64encode(pix.tobytes("jpeg", jpg_quality=85)).decode("ascii")
    finally:
        doc.close()


def save_rendered_image(config: Config, pdf: PdfInfo, page_number: int, data_url: str) -> None:
    _, b64 = data_url.split(",", 1)
    atomic_write_bytes(config.output_dir / "images" / pdf.pdf_id / f"page_{page_number:06d}.jpg", base64.b64decode(b64))


def build_pdf_aggregate(pdf: PdfInfo, config: Config, enrichment: EnrichmentIndex) -> dict[str, Any] | None:
    pages = [cache for page_number in range(1, pdf.page_count + 1) if (cache := read_page_cache(config, pdf, page_number)) and cache_is_valid(cache, pdf, config, expected_page_number=page_number)]
    if not pages:
        return None
    records = enrichment.records_for_pdf(pdf)
    known_links = enrichment.known_links_for_records(records)
    topper = choose_topper(records, pages)
    exam_metadata = choose_exam_metadata(records, pages)
    questions = build_question_index(pdf, pages, records, known_links, enrichment, exam_metadata)
    overall_summary = combine_unique([q.get("answer_summary") for q in questions if isinstance(q, dict)], max_items=8)
    assets_noted = {
        "diagrams": combine_page_signal_lists(pages, "diagrams", max_items=80),
        "maps": combine_page_signal_lists(pages, "maps", max_items=80),
        "flowcharts": combine_page_signal_lists(pages, "flowcharts", max_items=80),
    }
    usage = sum_usage([page.get("usage") or {} for page in pages])
    usage["estimated_cost_usd"] = estimate_cost_from_usage(usage, config)
    model_values = sorted({safe_str(page.get("model")) for page in pages if safe_str(page.get("model"))})
    fingerprint_values = sorted({safe_str(page.get("fingerprint")) for page in pages if safe_str(page.get("fingerprint"))})
    if len(model_values) > 1:
        raise OcrError(f"Refusing to aggregate mixed cache models for {pdf.pdf_id}: {model_values}")
    if len(fingerprint_values) > 1:
        raise OcrError(f"Refusing to aggregate mixed cache fingerprints for {pdf.pdf_id}: {fingerprint_values}")
    confidences = [clamp_float(page.get("confidence"), 0.0, 1.0, default=0.0) for page in pages]
    return {
        "schema_version": AGGREGATE_SCHEMA_VERSION,
        "input_scope": INPUT_SCOPE,
        "prompt_template_hash": PROMPT_TEMPLATE_HASH,
        "pdf_id": pdf.pdf_id,
        "drive_id": pdf.drive_id,
        "pdf_path": pdf.rel_path,
        "sha256": pdf.sha256,
        "source_identity": pdf.identity_key or pdf_identity_key(pdf),
        "input_provenance": redact_for_json(pdf.input_provenance),
        "duplicate_rel_paths": pdf.duplicate_rel_paths,
        "source_site": pdf.source_site,
        "source_url": pdf.source_url,
        "source_metadata": redact_for_json(pdf.source_metadata),
        "page_count": pdf.page_count,
        "source_pdf": {
            "rel_path": pdf.rel_path,
            "byte_size": pdf.byte_size,
            "mtime_ns": pdf.mtime_ns,
            "sha256": pdf.sha256,
            "identity_key": pdf.identity_key or pdf_identity_key(pdf),
            "input_provenance": redact_for_json(pdf.input_provenance),
            "source_site": pdf.source_site,
            "source_url": pdf.source_url,
        },
        "pages_completed": len(pages),
        "pages_failed": max(0, pdf.page_count - len(pages)),
        "topper": topper,
        "exam_metadata": exam_metadata,
        "overall_summary": overall_summary,
        "assets_noted": assets_noted,
        "questions": questions,
        "full_ocr_pages": [{"page_number": p.get("page_number"), "markdown": safe_str(p.get("ocr_markdown")), "ocr_markdown": safe_str(p.get("ocr_markdown")), "visible_metadata": p.get("visible_metadata") if isinstance(p.get("visible_metadata"), dict) else {}, "question_starts": ensure_list(p.get("question_starts")), "answer_signals": p.get("answer_signals") if isinstance(p.get("answer_signals"), dict) else {}, "confidence": clamp_float(p.get("confidence"), 0.0, 1.0, default=0.0), "illegible_regions": ensure_list(p.get("illegible_regions"))} for p in sorted(pages, key=lambda item: int(item.get("page_number") or 0))],
        "usage": usage,
        "status": "done" if len(pages) == pdf.page_count else "partial",
        "ocr_confidence": round(sum(confidences) / len(confidences), 4) if confidences else 0.0,
        "generated_at": iso_now(),
        "model": config.model or first_nonempty(page.get("model") for page in pages),
        "fingerprint": first_nonempty(page.get("fingerprint") for page in pages),
        "prompt_version": config.prompt_version,
        "render": config.render.fingerprint_dict(),
    }


def build_question_index(pdf: PdfInfo, pages: list[dict[str, Any]], records: list[dict[str, Any]], known_links: list[dict[str, Any]], enrichment: EnrichmentIndex, exam_metadata: dict[str, Any]) -> list[dict[str, Any]]:
    sorted_pages = sorted(pages, key=lambda page: int(page.get("page_number") or 0))
    starts: list[dict[str, Any]] = []
    for page in sorted_pages:
        page_number = int(page.get("page_number") or 0)
        for item in ensure_list(page.get("question_starts")):
            if not isinstance(item, dict):
                continue
            text = safe_str(item.get("question_text"))
            if text:
                starts.append({"question_number": safe_str(item.get("question_number")) or None, "question_text": text, "start_page": page_number, "confidence": clamp_float(item.get("confidence"), 0, 1, default=0.0)})
    if not starts:
        return [{"question_number": None, "question_text": "Question starts not confidently detected", "start_page": sorted_pages[0].get("page_number"), "end_page": sorted_pages[-1].get("page_number"), "pyq_mapping_hints": [], "known_project_mappings": known_project_mappings_for_span(records, known_links, 1, pdf.page_count), "answer_summary": combine_unique([page_signal(page, "summary") for page in sorted_pages], max_items=6), "value_additions": combine_page_signal_lists(sorted_pages, "value_additions"), "examiner_remarks": combine_page_signal_lists(sorted_pages, "examiner_remarks"), "diagrams": combine_page_signal_lists(sorted_pages, "diagrams"), "maps": combine_page_signal_lists(sorted_pages, "maps"), "flowcharts": combine_page_signal_lists(sorted_pages, "flowcharts"), "marks_or_scores": combine_page_signal_lists(sorted_pages, "marks_or_scores"), "confidence": 0.0}]
    starts.sort(key=lambda item: (int(item["start_page"]), safe_str(item.get("question_number"))))
    questions: list[dict[str, Any]] = []
    for idx, start in enumerate(starts):
        start_page = int(start["start_page"])
        end_page = max(start_page, (int(starts[idx + 1]["start_page"]) - 1) if idx + 1 < len(starts) else pdf.page_count)
        span_pages = [page for page in sorted_pages if start_page <= int(page.get("page_number") or 0) <= end_page]
        paper = safe_str(exam_metadata.get("paper")) or first_nonempty(rec.get("paper") for rec in records)
        questions.append({"question_number": start.get("question_number"), "question_text": start.get("question_text"), "start_page": start_page, "end_page": end_page, "pyq_mapping_hints": enrichment.mapping_hints(start.get("question_text") or "", paper=paper, limit=5), "known_project_mappings": known_project_mappings_for_span(records, known_links, start_page, end_page), "answer_summary": combine_unique([page_signal(page, "summary") for page in span_pages], max_items=4), "value_additions": combine_page_signal_lists(span_pages, "value_additions"), "examiner_remarks": combine_page_signal_lists(span_pages, "examiner_remarks"), "diagrams": combine_page_signal_lists(span_pages, "diagrams"), "maps": combine_page_signal_lists(span_pages, "maps"), "flowcharts": combine_page_signal_lists(span_pages, "flowcharts"), "marks_or_scores": combine_page_signal_lists(span_pages, "marks_or_scores"), "confidence": start.get("confidence", 0.0)})
    return questions


def write_pdf_outputs(config: Config, aggregate: dict[str, Any]) -> None:
    pdf_id = sanitize_id(safe_str(aggregate.get("pdf_id")) or "document")
    atomic_write_json(config.output_dir / "pdfs" / f"{pdf_id}.json", aggregate)
    atomic_write_text(config.output_dir / "pdfs" / f"{pdf_id}.md", aggregate_to_markdown(aggregate))


def aggregate_to_markdown(aggregate: dict[str, Any]) -> str:
    topper = aggregate.get("topper") if isinstance(aggregate.get("topper"), dict) else {}
    exam = aggregate.get("exam_metadata") if isinstance(aggregate.get("exam_metadata"), dict) else {}
    assets = aggregate.get("assets_noted") if isinstance(aggregate.get("assets_noted"), dict) else {}
    lines = [f"# OCR: {aggregate.get('pdf_id')}.pdf", "", "## Metadata", "", f"- PDF path: {aggregate.get('pdf_path') or ''}", f"- Drive ID: {aggregate.get('drive_id') or ''}", f"- Page count: {aggregate.get('page_count') or 0}", f"- Pages completed: {aggregate.get('pages_completed') or 0}", f"- Pages failed: {aggregate.get('pages_failed') or 0}", f"- Topper: {topper.get('name') or 'Topper copy'}", f"- Exam/Test: {exam.get('exam') or exam.get('test_name') or ''}", f"- Paper: {exam.get('paper') or ''}", f"- Year: {exam.get('year') or ''}", f"- Institute: {exam.get('institute') or ''}", f"- OCR model: {aggregate.get('model') or ''}", f"- Prompt version: {aggregate.get('prompt_version') or ''}", f"- OCR confidence: {aggregate.get('ocr_confidence') if aggregate.get('ocr_confidence') is not None else ''}", "", "## Overall Summary", "", safe_str(aggregate.get("overall_summary")) or "[not available]", "", "## Assets Noted", "", f"- Diagrams: {format_list(assets.get('diagrams'))}", f"- Maps: {format_list(assets.get('maps'))}", f"- Flowcharts: {format_list(assets.get('flowcharts'))}", "", "## Questions / Answer Index", ""]
    for q in ensure_list(aggregate.get("questions")):
        if not isinstance(q, dict):
            continue
        qnum = q.get("question_number") or "Unnumbered"
        qtext = safe_str(q.get("question_text"))
        heading = f"### Q{qnum}: {qtext[:180]}" if not str(qnum).lower().startswith("q") else f"### {qnum}: {qtext[:180]}"
        lines.extend([heading, "", f"- Starts on page: {q.get('start_page') or ''}", f"- Ends on page: {q.get('end_page') or ''}", f"- PYQ mapping hints: {format_compact_json(q.get('pyq_mapping_hints'))}", f"- Known project mappings: {format_compact_json(q.get('known_project_mappings'))}", f"- Answer summary: {safe_str(q.get('answer_summary'))}", f"- Value additions: {format_list(q.get('value_additions'))}", f"- Examiner remarks: {format_list(q.get('examiner_remarks'))}", f"- Diagrams/assets: {format_list(q.get('diagrams'))}", f"- Maps: {format_list(q.get('maps'))}", f"- Flowcharts: {format_list(q.get('flowcharts'))}", f"- Marks/scores: {format_list(q.get('marks_or_scores'))}", f"- Confidence: {q.get('confidence') if q.get('confidence') is not None else ''}", ""])
    lines.extend(["## Full Page-by-Page OCR", ""])
    for page in ensure_list(aggregate.get("full_ocr_pages")):
        if isinstance(page, dict):
            lines.extend([f"### Page {page.get('page_number')}", "", safe_str(page.get("markdown")) or "[empty OCR]", ""])
    return "\n".join(lines).rstrip() + "\n"


def rebuild_aggregates(run_id: str, selected_pdfs: list[PdfInfo], all_inventory: list[PdfInfo], config: Config, manifest: Manifest, enrichment: EnrichmentIndex) -> dict[str, Any]:
    rebuilt = skipped = failed = partial = 0
    for pdf in selected_pdfs:
        try:
            manifest.upsert_pdf(pdf, status="partial")
            aggregate = build_pdf_aggregate(pdf, config, enrichment)
            if not aggregate:
                skipped += 1
                manifest.update_pdf_counts(pdf.pdf_id, "partial", 0, pdf.page_count)
                continue
            valid_pages, invalid_pages = cache_status_for_pdf(pdf, config)
            if valid_pages:
                sync_cached_pages_to_manifest(pdf, valid_pages, config, manifest)
            write_pdf_outputs(config, aggregate)
            completed = int(aggregate.get("pages_completed") or 0)
            failed_pages = int(aggregate.get("pages_failed") or len(invalid_pages) or 0)
            manifest.update_pdf_counts(pdf.pdf_id, safe_str(aggregate.get("status")) or "partial", completed, failed_pages)
            rebuilt += 1
            if safe_str(aggregate.get("status")) != "done" or completed != pdf.page_count or failed_pages:
                partial += 1
        except Exception as exc:
            failed += 1
            valid_pages, invalid_pages = cache_status_for_pdf(pdf, config)
            if valid_pages:
                sync_cached_pages_to_manifest(pdf, valid_pages, config, manifest)
            manifest.update_pdf_counts(pdf.pdf_id, "error", len(valid_pages), len(invalid_pages))
            manifest.event("error", "rebuild_aggregate_failed", redact_sensitive(exc), run_id=run_id, pdf_id=pdf.pdf_id)
    if failed:
        status = "failed"
    elif skipped or partial:
        status = "partial"
    else:
        status = "complete"
    return {"run_id": run_id, "mode": "rebuild-aggregates", "generated_at": iso_now(), "status": status, "selected_pdfs": len(selected_pdfs), "all_pdfs": len(all_inventory) + len(config.inventory_errors), "readable_pdfs": len(all_inventory), "unreadable_pdfs": len(config.inventory_errors), "inventory_errors": config.inventory_errors[:50], "rebuilt": rebuilt, "partial": partial, "skipped_no_valid_cache": skipped, "failed": failed, "output_dir": display_path(config.output_dir), "api_calls_made": 0}


def cache_status_for_pdf(pdf: PdfInfo, config: Config) -> tuple[list[int], list[int]]:
    valid, invalid = [], []
    for page_number in range(1, pdf.page_count + 1):
        cache = read_page_cache(config, pdf, page_number)
        (valid if cache and cache_is_valid(cache, pdf, config, expected_page_number=page_number) else invalid).append(page_number)
    return valid, invalid


def count_cache(selected: list[PdfInfo], config: Config) -> dict[str, Any]:
    done_total = valid_current = invalid_or_missing = 0
    for pdf in selected:
        for page_number in range(1, pdf.page_count + 1):
            cache = read_page_cache(config, pdf, page_number)
            if cache and safe_str(cache.get("status")) == "done":
                done_total += 1
            if cache and cache_is_valid(cache, pdf, config, expected_page_number=page_number):
                valid_current += 1
            else:
                invalid_or_missing += 1
    return {"done_page_cache_total": done_total, "valid_for_current_settings": valid_current, "remaining_pages": invalid_or_missing}


def infer_unique_cache_model(selected: list[PdfInfo], config: Config) -> str | None:
    """Infer a single cache model for cache-only aggregate rebuilds when env/CLI omitted it."""
    models: set[str] = set()
    for pdf in selected:
        for page_number in range(1, pdf.page_count + 1):
            cache = read_page_cache(config, pdf, page_number)
            if not isinstance(cache, dict) or safe_str(cache.get("status")) != "done":
                continue
            if not cache_matches_source_and_settings_except_model(cache, pdf, config, page_number):
                continue
            model = safe_str(cache.get("model"))
            if model:
                models.add(model)
    if len(models) > 1:
        raise OcrError(f"Multiple OCR models found in matching page cache; pass --model explicitly: {sorted(models)}")
    return next(iter(models), None)


def cache_matches_source_and_settings_except_model(cache: dict[str, Any], pdf: PdfInfo, config: Config, page_number: int) -> bool:
    if safe_str(cache.get("schema_version")) != CACHE_SCHEMA_VERSION:
        return False
    if safe_str(cache.get("prompt_template_hash")) != PROMPT_TEMPLATE_HASH:
        return False
    if safe_str(cache.get("base_url_host")) != config.base_url_host:
        return False
    if safe_str(cache.get("pdf_id")) != pdf.pdf_id:
        return False
    if safe_int(cache.get("page_number"), -1) != page_number:
        return False
    if normalize_rel_path(safe_str(cache.get("pdf_path"))) != normalize_rel_path(pdf.rel_path):
        return False
    if safe_str(cache.get("drive_id")) != safe_str(pdf.drive_id):
        return False
    if safe_int(cache.get("page_count"), -1) != pdf.page_count:
        return False
    if safe_str(cache.get("sha256")) != safe_str(pdf.sha256):
        return False
    source_pdf = cache.get("source_pdf") if isinstance(cache.get("source_pdf"), dict) else {}
    if source_pdf and safe_str(source_pdf.get("sha256")) != safe_str(pdf.sha256):
        return False
    if safe_str(cache.get("prompt_version")) != config.prompt_version:
        return False
    render = cache.get("render") if isinstance(cache.get("render"), dict) else {}
    return safe_float(render.get("scale"), -1.0) == float(config.render.scale) and safe_str(render.get("image_format")) == config.render.image_format and safe_int(render.get("jpeg_quality"), -1) == int(config.render.jpeg_quality)


def read_page_cache(config: Config, pdf: PdfInfo, page_number: int) -> dict[str, Any] | None:
    for path in page_cache_paths(config, pdf, page_number):
        data = read_json_file(path, None)
        if isinstance(data, dict):
            return data
    return None


def cache_is_valid(cache: dict[str, Any], pdf: PdfInfo, config: Config, expected_page_number: int | None = None) -> bool:
    if safe_str(cache.get("schema_version")) != CACHE_SCHEMA_VERSION:
        return False
    if safe_str(cache.get("prompt_template_hash")) != PROMPT_TEMPLATE_HASH:
        return False
    if safe_str(cache.get("base_url_host")) != config.base_url_host:
        return False
    if safe_str(cache.get("status")) != "done" or safe_str(cache.get("pdf_id")) != pdf.pdf_id:
        return False
    if expected_page_number is not None and safe_int(cache.get("page_number"), -1) != expected_page_number:
        return False
    if normalize_rel_path(safe_str(cache.get("pdf_path"))) != normalize_rel_path(pdf.rel_path):
        return False
    if safe_str(cache.get("drive_id")) != safe_str(pdf.drive_id):
        return False
    if not pdf.sha256 or safe_str(cache.get("sha256")) != safe_str(pdf.sha256):
        return False
    if safe_int(cache.get("page_count"), -1) != pdf.page_count:
        return False

    source_pdf = cache.get("source_pdf") if isinstance(cache.get("source_pdf"), dict) else {}
    cached_rel_path = source_pdf.get("rel_path") if source_pdf else cache.get("pdf_path")
    if normalize_rel_path(safe_str(cached_rel_path)) != normalize_rel_path(pdf.rel_path):
        return False
    cached_byte_size = source_pdf.get("byte_size") if source_pdf else cache.get("source_pdf_byte_size")
    cached_mtime_ns = source_pdf.get("mtime_ns") if source_pdf else cache.get("source_pdf_mtime_ns")
    cached_sha = source_pdf.get("sha256") if source_pdf else cache.get("sha256")
    if safe_str(cached_sha) != safe_str(pdf.sha256):
        return False
    if safe_int(cached_byte_size, -1) != int(pdf.byte_size):
        return False
    # Do not invalidate an otherwise SHA-256-identical cache solely because the
    # repo and Acer mirror have different filesystem mtimes.  Content hash and
    # byte size are the authoritative source identity; mtime remains recorded as
    # provenance/debug metadata.
    if safe_str(cached_sha) != safe_str(pdf.sha256) and safe_int(cached_mtime_ns, -1) != int(pdf.mtime_ns):
        return False

    cache_model = safe_str(cache.get("model"))
    if not config.model or cache_model != config.model:
        return False
    if safe_str(cache.get("prompt_version")) != config.prompt_version:
        return False
    expected_fingerprint = prompt_fingerprint_for(config.model, config.prompt_version, config.render, config.max_output_tokens, config.base_url_host)
    if safe_str(cache.get("fingerprint")) != expected_fingerprint:
        return False
    render = cache.get("render") if isinstance(cache.get("render"), dict) else {}
    return safe_float(render.get("scale"), -1.0) == float(config.render.scale) and safe_str(render.get("image_format")) == config.render.image_format and safe_int(render.get("jpeg_quality"), -1) == int(config.render.jpeg_quality)


def sync_cached_pages_to_manifest(pdf: PdfInfo, page_numbers: list[int], config: Config, manifest: Manifest) -> None:
    """Mirror authoritative valid page-cache entries into SQLite for resumed runs."""
    for page_number in page_numbers:
        cache = read_page_cache(config, pdf, page_number)
        if not cache:
            continue
        latency_value = cache.get("latency_ms")
        try:
            latency_ms = int(latency_value) if latency_value is not None else None
        except Exception:
            latency_ms = None
        manifest.mark_page(pdf, page_number, "done", config, latency_ms=latency_ms, usage=normalize_usage(cache.get("usage") or {}))


def write_page_cache(config: Config, payload: dict[str, Any]) -> None:
    atomic_write_json(page_cache_path_from_payload(config, payload), payload)


def page_cache_path(config: Config, pdf_id: str, page_number: int) -> Path:
    """Legacy pdf_id-based cache path retained as read fallback for old runs."""
    return config.output_dir / "page-cache" / sanitize_id(pdf_id) / f"page_{page_number:06d}.json"


def page_cache_sha_path(config: Config, sha256: str, page_number: int) -> Path:
    sha = safe_str(sha256).lower()
    return config.output_dir / "page-cache" / "by-sha" / sha[:2] / sha / f"page_{page_number:06d}.json"


def page_cache_path_from_payload(config: Config, payload: Mapping[str, Any]) -> Path:
    page_number = int(payload.get("page_number") or 0)
    sha = safe_str(payload.get("sha256")).lower()
    if re.fullmatch(r"[0-9a-f]{64}", sha):
        return page_cache_sha_path(config, sha, page_number)
    return page_cache_path(config, safe_str(payload.get("pdf_id")), page_number)


def page_cache_paths(config: Config, pdf: PdfInfo, page_number: int) -> list[Path]:
    paths: list[Path] = []
    sha = safe_str(pdf.sha256).lower()
    if re.fullmatch(r"[0-9a-f]{64}", sha):
        paths.append(page_cache_sha_path(config, sha, page_number))
    paths.append(page_cache_path(config, pdf.pdf_id, page_number))
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in paths:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def http_json(method: str, url: str, api_key: str, payload: dict[str, Any] | None = None, timeout: int = 180) -> dict[str, Any]:
    data_bytes = json_dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data_bytes, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(raw)
        except Exception:
            parsed = raw
        message = f"HTTP {exc.code} {exc.reason}: {truncate(redact_sensitive(raw), 1000)}"
        if exc.code in AUTH_STATUSES:
            raise AuthError(message) from exc
        raise ApiError(exc.code, message, redact_for_json(parsed), dict(exc.headers or {})) from exc


def extract_response_text(data: dict[str, Any]) -> str:
    if isinstance(data.get("output_text"), str):
        return data["output_text"]
    parts: list[str] = []
    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if isinstance(value.get("text"), str):
                parts.append(value["text"])
            for key in ("content", "output", "message"):
                if key in value:
                    visit(value[key])
        elif isinstance(value, list):
            for item in value:
                visit(item)
    visit(data.get("output"))
    return "\n".join(part for part in parts if part).strip()


def parse_json_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if not stripped:
        raise JsonParseError("empty response text")
    candidates = [stripped]
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped, flags=re.I)
    if fence:
        candidates.append(fence.group(1).strip())
    obj = extract_first_json_object(stripped)
    if obj:
        candidates.append(obj)
    last_exc: Exception | None = None
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception as exc:
            last_exc = exc
    raise JsonParseError(f"Could not parse JSON: {last_exc}; text={truncate(text, 300)}")


def extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        ch = text[idx]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start: idx + 1]
    return None


def extract_model_ids(data: Any) -> list[str]:
    ids: list[str] = []
    values = data.get("data") if isinstance(data, dict) and isinstance(data.get("data"), list) else data.get("models") if isinstance(data, dict) else data
    if isinstance(values, list):
        for item in values:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                ids.append(item["id"])
            elif isinstance(item, str):
                ids.append(item)
    return sorted(set(ids))


def rank_model_candidates(model_ids: list[str]) -> list[str]:
    def score(model_id: str) -> tuple[int, str]:
        lower = model_id.lower()
        penalty = -100 if any(ex in lower for ex in GENERIC_MODEL_EXCLUSIONS) else 0
        hint_score = max([100 - idx for idx, hint in enumerate(VISION_MODEL_HINTS) if hint in lower] or [0])
        if "mini" in lower:
            hint_score -= 2
        if "preview" in lower:
            hint_score -= 1
        return penalty + hint_score, model_id
    candidates = [mid for mid in model_ids if score(mid)[0] > 0]
    candidates.sort(key=score, reverse=True)
    return candidates


def is_reasoning_param_error(exc: ApiError) -> bool:
    text = str(exc).lower()
    return "reasoning" in text and any(word in text for word in ["unknown", "unsupported", "not supported", "unrecognized", "invalid", "not allowed", "extra field", "unexpected"])


def retry_sleep_seconds(exc: ApiError, attempt: int) -> float:
    retry_after = exc.headers.get("Retry-After") or exc.headers.get("retry-after") if exc.headers else None
    if retry_after:
        with contextlib.suppress(Exception):
            return min(300.0, float(retry_after))
    match = re.search(r"retry-after[^0-9]*(\d+)", str(exc), flags=re.I)
    return float(match.group(1)) if match else backoff_with_jitter(attempt)


def backoff_with_jitter(attempt: int) -> float:
    base = min(60.0, 1.5 * (2 ** attempt))
    return base + random.uniform(0, min(2.0, base / 3))


def known_project_mappings_for_span(records: list[dict[str, Any]], known_links: list[dict[str, Any]], start_page: int, end_page: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    answer_ids = {safe_str(rec.get("answerId")) for rec in records if page_in_record_span(rec, start_page, end_page)}
    for rec in records:
        if page_in_record_span(rec, start_page, end_page):
            key = f"record::{rec.get('answerId')}"
            if key not in seen:
                seen.add(key)
                result.append({"source": "topper-answer-canonical.json", "answerId": rec.get("answerId"), "extractedQuestion": rec.get("extractedQuestion"), "paper": rec.get("paper"), "pageNormalized": rec.get("pageNormalized"), "summary": truncate(rec.get("summary"), 300)})
    for link in known_links:
        answer_id = safe_str(link.get("topperAnswerId"))
        if answer_id and answer_id not in answer_ids and not page_in_known_link_span(link, start_page, end_page):
            continue
        key = f"official::{link.get('officialQuestionId')}::{answer_id}"
        if key not in seen:
            seen.add(key)
            result.append({"source": "official-pyq-links.json", "officialQuestionId": link.get("officialQuestionId"), "topperAnswerId": link.get("topperAnswerId"), "matchType": link.get("matchType"), "matchConfidence": link.get("matchConfidence"), "matchReason": link.get("matchReason"), "extractedQuestion": link.get("extractedQuestion"), "paper": link.get("paper"), "pageNormalized": link.get("pageNormalized")})
    return result[:20]


def choose_topper(records: list[dict[str, Any]], pages: list[dict[str, Any]]) -> dict[str, Any]:
    known = choose_topper_from_records(records)
    if known.get("name"):
        return known
    visible_names = [safe_str((page.get("visible_metadata") or {}).get("topper_name")) for page in pages[:5] if isinstance(page.get("visible_metadata"), dict)]
    visible_names = [name for name in visible_names if name]
    if visible_names:
        name, count = Counter(visible_names).most_common(1)[0]
        return {"name": name, "confidence": min(0.75, 0.4 + count * 0.1), "sources": ["visible_page_metadata"]}
    return {"name": "Topper copy", "confidence": 0.0, "sources": ["fallback"]}


def choose_topper_from_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    buckets = [(0.95, "project_metadata_extracted", []), (0.72, "project_metadata_filename", []), (0.55, "project_metadata", [])]
    for rec in records:
        name = safe_str(rec.get("topperName"))
        if not name or name.lower() in {"topper copy", "unavailable", "unknown", "nan"}:
            continue
        status = safe_str(rec.get("nameStatus")).lower()
        (buckets[0][2] if status == "extracted" else buckets[1][2] if status == "filename" else buckets[2][2]).append(name)
    for confidence, source, bucket in buckets:
        if bucket:
            name, count = Counter(bucket).most_common(1)[0]
            return {"name": name, "confidence": confidence, "sources": [source], "support_count": count}
    return {"name": None, "confidence": 0.0, "sources": []}


def choose_exam_metadata(records: list[dict[str, Any]], pages: list[dict[str, Any]]) -> dict[str, Any]:
    visible: dict[str, Any] = {}
    for page in pages[:5]:
        metadata = page.get("visible_metadata") if isinstance(page.get("visible_metadata"), dict) else {}
        for key in ["exam", "test_name", "year", "paper", "institute"]:
            if not visible.get(key) and safe_str(metadata.get(key)):
                visible[key] = safe_str(metadata.get(key))
    return {"exam": visible.get("exam"), "year": visible.get("year") or first_nonempty(rec.get("year") or rec.get("estimatedYear") for rec in records), "paper": visible.get("paper") or first_nonempty(rec.get("paper") for rec in records), "test_name": visible.get("test_name"), "institute": visible.get("institute") or first_nonempty(rec.get("institute") for rec in records)}


def build_pilot_summary(run_id: str, pilot_pdfs: list[PdfInfo], all_inventory: list[PdfInfo], config: Config, stats: RunStats) -> dict[str, Any]:
    summary = build_run_summary(run_id, "pilot", pilot_pdfs, all_inventory, config, stats)
    if stats.latencies_ms:
        avg_ms = sum(stats.latencies_ms) / len(stats.latencies_ms)
        remaining_pages = max(0, sum(pdf.page_count for pdf in all_inventory) - stats.pages_completed - stats.pages_skipped_cached)
        projected_seconds = (avg_ms / 1000.0) * remaining_pages / max(1, config.concurrency)
    else:
        projected_seconds = None

    aggregate_outputs: list[dict[str, Any]] = []
    for pdf in pilot_pdfs:
        pdf_id = sanitize_id(pdf.pdf_id)
        json_path = config.output_dir / "pdfs" / f"{pdf_id}.json"
        md_path = config.output_dir / "pdfs" / f"{pdf_id}.md"
        aggregate = read_json_file(json_path, {}) if json_path.exists() else {}
        aggregate_outputs.append({
            "pdf_id": pdf.pdf_id,
            "page_count": pdf.page_count,
            "json_path": display_path(json_path),
            "md_path": display_path(md_path),
            "json_exists": json_path.exists(),
            "md_exists": md_path.exists(),
            "status": safe_str(aggregate.get("status")) if isinstance(aggregate, dict) else "",
            "pages_completed": int(aggregate.get("pages_completed") or 0) if isinstance(aggregate, dict) else 0,
            "pages_failed": safe_int(aggregate.get("pages_failed"), pdf.page_count) if isinstance(aggregate, dict) else pdf.page_count,
        })

    summary.update({
        "pilot_pdfs": [pdf_summary(pdf) for pdf in pilot_pdfs],
        "projected_total_time_seconds": projected_seconds,
        "projected_total_time_human": human_duration(projected_seconds) if projected_seconds is not None else None,
        "projected_total_cost": estimate_cost_from_usage_projection(stats, all_inventory, config),
        "sample_output_paths": [display_path(config.output_dir / "pdfs" / f"{sanitize_id(pdf.pdf_id)}.md") for pdf in pilot_pdfs[:10]],
        "sample_page_statuses": sample_page_statuses(pilot_pdfs, config),
        "quality": pilot_quality_metrics(pilot_pdfs, config),
        "aggregate_outputs": aggregate_outputs,
    })
    return summary


def pilot_quality_metrics(pdfs: list[PdfInfo], config: Config) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    for pdf in pdfs:
        for page_number in range(1, pdf.page_count + 1):
            cache = read_page_cache(config, pdf, page_number)
            if not (cache and cache_is_valid(cache, pdf, config, expected_page_number=page_number)):
                continue
            text = safe_str(cache.get("ocr_markdown"))
            confidence = clamp_float(cache.get("confidence"), 0.0, 1.0, default=0.0)
            illegible_count = len(ensure_list(cache.get("illegible_regions")))
            pages.append({
                "pdf_id": pdf.pdf_id,
                "page_number": page_number,
                "confidence": confidence,
                "ocr_markdown_chars": len(text),
                "illegible_regions": illegible_count,
            })
    confidences = [page["confidence"] for page in pages]
    low_confidence = [page for page in pages if page["confidence"] < 0.65]
    very_short_without_reason = [page for page in pages if page["ocr_markdown_chars"] < 20 and page["illegible_regions"] == 0]
    return {
        "valid_pages_measured": len(pages),
        "min_confidence": min(confidences) if confidences else None,
        "avg_confidence": round(sum(confidences) / len(confidences), 4) if confidences else None,
        "low_confidence_pages": len(low_confidence),
        "very_short_pages_without_illegible_reason": len(very_short_without_reason),
        "examples_low_confidence": low_confidence[:10],
        "examples_very_short_without_reason": very_short_without_reason[:10],
        "note": "Quality metrics are for human pilot review; operational pilot gates still use parse/failure/cache/aggregate thresholds.",
    }


def sample_page_statuses(pdfs: list[PdfInfo], config: Config, max_samples: int = 16) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    for pdf in pdfs:
        for page_number in range(1, pdf.page_count + 1):
            cache = read_page_cache(config, pdf, page_number)
            samples.append({
                "pdf_id": pdf.pdf_id,
                "page_number": page_number,
                "status": safe_str(cache.get("status")) if isinstance(cache, dict) else "missing",
                "valid_for_current_settings": bool(cache and cache_is_valid(cache, pdf, config, expected_page_number=page_number)),
                "confidence": clamp_float(cache.get("confidence"), 0.0, 1.0, default=0.0) if isinstance(cache, dict) else None,
                "latency_ms": safe_int(cache.get("latency_ms"), 0) if isinstance(cache, dict) else None,
                "api": cache.get("api") if isinstance(cache, dict) and isinstance(cache.get("api"), dict) else {},
                "usage": normalize_usage(cache.get("usage") if isinstance(cache, dict) else {}),
            })
            if len(samples) >= max_samples:
                return samples
    return samples


def build_run_summary(run_id: str, mode: str, selected_pdfs: list[PdfInfo], all_inventory: list[PdfInfo], config: Config, stats: RunStats) -> dict[str, Any]:
    selected_pages = sum(pdf.page_count for pdf in selected_pdfs)
    pages_accounted = stats.pages_completed + stats.pages_skipped_cached + stats.pages_failed
    pages_unaccounted = max(0, selected_pages - pages_accounted)
    total_discovered_pdfs = len(all_inventory) + len(config.inventory_errors)
    terminal_pdf_errors = len(config.inventory_errors)
    return {
        "run_id": run_id,
        "mode": mode,
        "generated_at": iso_now(),
        "target": [display_path(p) for p in config.input_dirs],
        "selected_pdfs": len(selected_pdfs),
        "selected_pages": selected_pages,
        "all_pdfs": total_discovered_pdfs,
        "readable_pdfs": len(all_inventory),
        "unreadable_pdfs": len(config.inventory_errors),
        "terminal_pdf_errors": terminal_pdf_errors,
        "inventory_errors": config.inventory_errors[:50],
        "all_pages": sum(pdf.page_count for pdf in all_inventory),
        "model": config.model,
        "base_url_host": config.base_url_host,
        "prompt_version": config.prompt_version,
        "render": config.render.fingerprint_dict(),
        "concurrency": config.concurrency,
        "output_dir": display_path(config.output_dir),
        "tmp_dir": display_path(config.tmp_dir) if config.tmp_dir else None,
        "input_dedupe": {
            "duplicate_groups": len(config.inventory_duplicates),
            "duplicate_pdf_files_collapsed": sum(int(item.get("duplicate_count") or 0) for item in config.inventory_duplicates),
            "examples": config.inventory_duplicates[:DUPLICATE_PROVENANCE_LIMIT],
        },
        "pages_attempted": stats.pages_attempted,
        "pages_completed": stats.pages_completed,
        "pages_failed": stats.pages_failed,
        "pages_skipped_cached": stats.pages_skipped_cached,
        "pages_accounted": pages_accounted,
        "pages_unaccounted": pages_unaccounted,
        "pdfs_processed": stats.pdfs_processed,
        "pdfs_failed": stats.pdfs_failed,
        "pdfs_failed_total": stats.pdfs_failed + terminal_pdf_errors,
        "parse_success_rate": round(stats.parse_success_rate, 4),
        "hard_failure_rate": round(stats.hard_failure_rate, 4),
        "repeated_429": stats.repeated_429,
        "api_calls_made": stats.api_calls_made,
        "retry_attempts": stats.retry_attempts,
        "rate_limited_attempts": stats.rate_limited_attempts,
        "repair_calls": stats.repair_calls,
        "usage": {
            "input_tokens": stats.input_tokens,
            "output_tokens": stats.output_tokens,
            "total_tokens": stats.total_tokens,
            "estimated_cost_usd": estimate_cost_from_usage({"input_tokens": stats.input_tokens, "output_tokens": stats.output_tokens, "total_tokens": stats.total_tokens}, config),
        },
        "latency_ms": latency_summary(stats.latencies_ms),
        "auth_error": stats.auth_error,
        "free_disk_gb": free_disk_gb(config.output_dir),
    }


def evaluate_pilot_gates(summary: dict[str, Any], config: Config) -> dict[str, Any]:
    blockers: list[str] = []
    if int(summary.get("selected_pdfs") or 0) <= 0:
        blockers.append("pilot selected no PDFs")
    if summary.get("auth_error"):
        blockers.append(f"auth error: {summary.get('auth_error')}")
    if int(summary.get("pdfs_failed") or 0) > 0:
        blockers.append(f"PDF failures {summary.get('pdfs_failed')} > 0")
    if int(summary.get("pages_unaccounted") or 0) > 0:
        blockers.append(f"unaccounted pages {summary.get('pages_unaccounted')} > 0")
    if int(summary.get("repeated_429") or 0) > 0:
        blockers.append(f"repeated 429 retry exhaustion events {summary.get('repeated_429')} > 0")
    if float(summary.get("hard_failure_rate") or 0) > 0.01:
        blockers.append(f"hard failure rate {summary.get('hard_failure_rate')} > 0.01")
    if float(summary.get("parse_success_rate") or 0) < 0.98:
        blockers.append(f"parse success rate {summary.get('parse_success_rate')} < 0.98")
    if free_disk_gb(config.output_dir) < config.min_free_gb:
        blockers.append(f"free disk below {config.min_free_gb} GiB")
    if int(summary.get("pages_completed") or 0) == 0 and int(summary.get("pages_skipped_cached") or 0) == 0:
        blockers.append("pilot completed no pages")
    for output in ensure_list(summary.get("aggregate_outputs")):
        if not isinstance(output, dict):
            continue
        pdf_id = output.get("pdf_id")
        if not output.get("json_exists") or not output.get("md_exists"):
            blockers.append(f"missing aggregate output for {pdf_id}")
            continue
        if safe_str(output.get("status")) != "done":
            blockers.append(f"aggregate output for {pdf_id} status={output.get('status')!r}, expected 'done'")
        if int(output.get("pages_completed") or 0) != int(output.get("page_count") or -1):
            blockers.append(f"aggregate output for {pdf_id} has incomplete pages {output.get('pages_completed')}/{output.get('page_count')}")
        if int(output.get("pages_failed") or 0) > 0:
            blockers.append(f"aggregate output for {pdf_id} reports failed pages {output.get('pages_failed')}")
    return {"pass": not blockers, "blockers": blockers}


def verify_fingerprint(config: Config) -> str:
    return prompt_fingerprint_for(config.model, config.prompt_version, config.render, config.max_output_tokens, config.base_url_host)


def build_verify_summary(config: Config, verification: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "verify-summary.v1",
        "input_scope": INPUT_SCOPE,
        "verified_at": safe_str(verification.get("verified_at")) or iso_now(),
        "base_url": config.base_url,
        "base_url_host": config.base_url_host,
        "model": config.model,
        "prompt_version": config.prompt_version,
        "render": config.render.fingerprint_dict(),
        "max_output_tokens": config.max_output_tokens,
        "prompt_fingerprint": verify_fingerprint(config),
        "include_reasoning": bool(config.include_reasoning),
        "smoke_test": verification.get("smoke_test") if isinstance(verification.get("smoke_test"), dict) else {},
        "models_seen": verification.get("models_seen"),
        "model_list_contains_selected": verification.get("model_list_contains_selected"),
        "pass": True,
    }


def require_matching_verify_summary(config: Config) -> None:
    """Require a persisted verify-summary.json matching paid OCR settings.

    The script verifies before pilot/full in the same process, then writes this
    file.  This additional persisted gate protects resumed/non-dry OCR runs from
    stale shells, changed models, or accidental direct-paid endpoint switches.
    """
    path = config.output_dir / "verify-summary.json"
    summary = read_json_file(path, {})
    if not isinstance(summary, dict) or not summary:
        raise OcrError("Refusing API-backed OCR: missing verify-summary.json. Run --verify-key first.")
    blockers: list[str] = []
    expected = {
        "schema_version": "verify-summary.v1",
        "input_scope": INPUT_SCOPE,
        "base_url_host": config.base_url_host,
        "model": config.model,
        "prompt_version": config.prompt_version,
        "max_output_tokens": config.max_output_tokens,
        "prompt_fingerprint": verify_fingerprint(config),
    }
    for key, value in expected.items():
        if safe_str(summary.get(key)) != safe_str(value):
            blockers.append(f"{key} mismatch")
    if summary.get("render") != config.render.fingerprint_dict():
        blockers.append("render mismatch")
    if summary.get("pass") is not True:
        blockers.append("verify-summary pass is not true")
    smoke = summary.get("smoke_test") if isinstance(summary.get("smoke_test"), dict) else {}
    if smoke.get("ok") is not True:
        blockers.append("verify-summary smoke_test.ok is not true")
    if blockers:
        raise OcrError(
            "Refusing API-backed OCR: verify-summary.json does not match current settings "
            f"({', '.join(blockers)}). Re-run --verify-key with the intended base URL/model/settings."
        )


def enforce_production_heavy_run_guard(args: argparse.Namespace, config: Config, selected_inventory: list[PdfInfo]) -> None:
    """Keep production-scale OCR artifacts on the Acer SSD unless this is a tiny test."""
    if bool(getattr(args, "dry_run", False)):
        return
    if not (getattr(args, "pilot", False) or getattr(args, "full", False)):
        return
    selected_pages = sum(pdf.page_count for pdf in selected_inventory)
    is_heavy = bool(getattr(args, "full", False)) or selected_pages > 100 or len(selected_inventory) > 10
    if not is_heavy:
        return
    try:
        output_resolved = config.output_dir.resolve()
        acer_output = ACER_OCR_ROOT.resolve()
    except Exception:
        output_resolved = config.output_dir
        acer_output = ACER_OCR_ROOT
    if output_resolved == acer_output or acer_output in output_resolved.parents:
        return
    raise OcrError(
        "Refusing production-scale OCR outside Acer SSD output root. "
        f"Selected {len(selected_inventory)} PDFs / {selected_pages} pages; use --output-dir {ACER_OCR_ROOT}."
    )


def require_passing_pilot_before_full(config: Config) -> None:
    """Refuse a standalone bulk --full run until the same output root has a passing pilot."""
    pilot_path = config.output_dir / "pilot-summary.json"
    pilot = read_json_file(pilot_path, {})
    if not isinstance(pilot, dict) or not pilot:
        raise OcrError(
            "Refusing --full: missing pilot-summary.json. Run and review --pilot first, "
            "or pass --force-full-without-pilot intentionally."
        )
    gates = pilot.get("gates") if isinstance(pilot.get("gates"), dict) else {}
    if gates.get("pass") is not True:
        raise OcrError(
            "Refusing --full: latest pilot-summary.json did not pass gates. "
            "Run/fix --pilot first, or pass --force-full-without-pilot intentionally."
        )
    mismatches: list[str] = []
    for key, current in [
        ("model", config.model),
        ("base_url_host", config.base_url_host),
        ("prompt_version", config.prompt_version),
        ("input_scope", INPUT_SCOPE),
    ]:
        if safe_str(pilot.get(key)) != safe_str(current):
            mismatches.append(key)
    pilot_render = pilot.get("render") if isinstance(pilot.get("render"), dict) else {}
    if pilot_render != config.render.fingerprint_dict():
        mismatches.append("render")
    if mismatches:
        raise OcrError(
            "Refusing --full: latest pilot-summary.json was for different settings "
            f"({', '.join(mismatches)}). Re-run --pilot with current settings, or pass --force-full-without-pilot intentionally."
        )
    require_matching_verify_summary(config)


def run_terminal_status(summary: dict[str, Any], gated: bool = False) -> str:
    if summary.get("auth_error"):
        return "failed"
    if gated and not (summary.get("gates") or {}).get("pass", False):
        return "failed"
    if int(summary.get("terminal_pdf_errors") or summary.get("unreadable_pdfs") or 0) > 0:
        return "partial"
    if int(summary.get("pages_unaccounted") or 0) > 0:
        return "partial"
    if int(summary.get("pages_failed") or 0) > 0 or int(summary.get("pdfs_failed") or 0) > 0:
        return "partial"
    return "complete"


def dry_run_summary(run_id: str, mode: str, selected: list[PdfInfo], all_inventory: list[PdfInfo], config: Config, args: argparse.Namespace) -> dict[str, Any]:
    return {"run_id": run_id, "mode": mode, "dry_run": True, "generated_at": iso_now(), "target": [display_path(p) for p in config.input_dirs], "selected_pdfs": len(selected), "selected_pages": sum(pdf.page_count for pdf in selected), "all_pdfs": len(all_inventory) + len(config.inventory_errors), "readable_pdfs": len(all_inventory), "unreadable_pdfs": len(config.inventory_errors), "terminal_pdf_errors": len(config.inventory_errors), "inventory_errors": config.inventory_errors[:50], "all_pages": sum(pdf.page_count for pdf in all_inventory), "api_calls_made": 0, "selected_preview": [pdf_summary(pdf) for pdf in selected[:20]], "output_dir": display_path(config.output_dir), "tmp_dir": display_path(config.tmp_dir) if config.tmp_dir else None, "input_dedupe": {"duplicate_groups": len(config.inventory_duplicates), "duplicate_pdf_files_collapsed": sum(int(item.get("duplicate_count") or 0) for item in config.inventory_duplicates), "examples": config.inventory_duplicates[:DUPLICATE_PROVENANCE_LIMIT]}}


def write_manifest_exports(output_dir: Path, manifest: Manifest) -> None:
    atomic_write_json(output_dir / "manifest.json", manifest.export_json())


def write_inventory_summary(config: Config, inventory: list[PdfInfo], selected_inventory: list[PdfInfo]) -> None:
    atomic_write_json(
        config.output_dir / "inventory-summary.json",
        {
            "generated_at": iso_now(),
            "input_dirs": [display_path(path) for path in config.input_dirs],
            "discovered_pdf_files": len(inventory) + len(config.inventory_errors),
            "readable_pdfs": len(inventory),
            "unreadable_pdfs": len(config.inventory_errors),
            "selected_pdfs": len(selected_inventory),
            "readable_pages": sum(pdf.page_count for pdf in inventory),
            "selected_pages": sum(pdf.page_count for pdf in selected_inventory),
            "unreadable": config.inventory_errors,
            "input_dedupe": {
                "duplicate_groups": len(config.inventory_duplicates),
                "duplicate_pdf_files_collapsed": sum(int(item.get("duplicate_count") or 0) for item in config.inventory_duplicates),
                "examples": config.inventory_duplicates[:DUPLICATE_PROVENANCE_LIMIT],
            },
            "source": INPUT_SCOPE,
            "tmp_dir": display_path(config.tmp_dir) if config.tmp_dir else None,
        },
    )


def print_estimate(summary: dict[str, Any]) -> None:
    print("\nEstimate complete (no API calls).")
    print(f"  all PDFs/pages:      {summary['all_pdfs']} / {summary['all_pages']}")
    if int(summary.get("unreadable_pdfs") or 0):
        print(f"  readable/unreadable: {summary.get('readable_pdfs')} / {summary.get('unreadable_pdfs')}")
    print(f"  selected PDFs/pages: {summary['selected_pdfs']} / {summary['selected_pages']}")
    print(f"  selected size:       {summary['selected_size_gb']} GiB")
    print(f"  cache valid/current: {summary['cache']['valid_for_current_settings']}")
    print(f"  remaining pages:     {summary['cache']['remaining_pages']}")
    dedupe = summary.get("input_dedupe") if isinstance(summary.get("input_dedupe"), dict) else {}
    if int(dedupe.get("duplicate_pdf_files_collapsed") or 0):
        print(f"  input duplicates:    {dedupe.get('duplicate_pdf_files_collapsed')} collapsed across {dedupe.get('duplicate_groups')} group(s)")
    print(f"  output dir:          {summary['output_dir']}")
    if summary.get("tmp_dir"):
        print(f"  tmp dir:             {summary['tmp_dir']}")


def print_pilot_summary(summary: dict[str, Any]) -> None:
    print_run_summary(summary)
    gates = summary.get("gates") or {}
    print(f"  pilot gates pass:    {gates.get('pass')}")
    for blocker in gates.get("blockers") or []:
        print(f"    blocker: {blocker}")


def print_run_summary(summary: dict[str, Any]) -> None:
    print(f"\n{safe_str(summary.get('mode')) or 'run'} summary:")
    for key in ["selected_pdfs", "selected_pages", "readable_pdfs", "unreadable_pdfs", "pages_attempted", "pages_completed", "pages_failed", "pages_skipped_cached", "pages_accounted", "pages_unaccounted", "pdfs_processed", "pdfs_failed", "api_calls_made", "retry_attempts", "rate_limited_attempts", "repair_calls", "rebuilt", "partial", "skipped_no_valid_cache", "failed", "status"]:
        if key in summary:
            print(f"  {key}: {summary[key]}")
    if "usage" in summary:
        print(f"  usage: {summary['usage']}")
    if summary.get("auth_error"):
        print(f"  auth_error: {summary['auth_error']}")
    print(f"  output_dir: {summary.get('output_dir')}")
    if summary.get("tmp_dir"):
        print(f"  tmp_dir: {summary.get('tmp_dir')}")


# ---------- general helpers ----------


def atomic_write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json_dumps(payload, indent=2) + "\n")


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp-{os.getpid()}-{threading.get_ident()}")
    with tmp.open("w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        with contextlib.suppress(OSError):
            os.fsync(fh.fileno())
    os.replace(tmp, path)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp-{os.getpid()}-{threading.get_ident()}")
    with tmp.open("wb") as fh:
        fh.write(data)
        fh.flush()
        with contextlib.suppress(OSError):
            os.fsync(fh.fileno())
    os.replace(tmp, path)


def read_json_file(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def json_dumps(value: Any, indent: int | None = None, sort_keys: bool = False) -> str:
    def default(obj: Any) -> Any:
        if isinstance(obj, set):
            return sorted(obj)
        if isinstance(obj, Path):
            return str(obj)
        if isinstance(obj, Counter):
            return dict(obj)
        return str(obj)
    return json.dumps(value, ensure_ascii=False, indent=indent, sort_keys=sort_keys, default=default)


def sha256_json(value: Any) -> str:
    return hashlib.sha256(json_dumps(value, sort_keys=True).encode("utf-8")).hexdigest()[:24]


def prompt_fingerprint_for(model: str, prompt_version: str, render: RenderSettings, max_output_tokens: int, base_url_host: str = "") -> str:
    return sha256_json({"base_url_host": base_url_host, "model": model, "prompt_version": prompt_version, "prompt_template_hash": PROMPT_TEMPLATE_HASH, "render": render.fingerprint_dict(), "max_output_tokens": max_output_tokens})


def normalize_smoke_text(value: Any) -> str:
    return re.sub(r"[^A-Z0-9]+", "", safe_str(value).upper())


def iso_now(value: dt.datetime | None = None) -> str:
    value = value or dt.datetime.now(dt.UTC)
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_run_id(prefix: str) -> str:
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"{prefix}-{stamp}-{hashlib.sha1(f'{prefix}-{stamp}-{time.time_ns()}'.encode()).hexdigest()[:8]}"


def safe_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def display_path(path: Path) -> str:
    try:
        resolved = path.resolve()
    except Exception:
        resolved = path
    with contextlib.suppress(Exception):
        return str(resolved.relative_to(ROOT))
    return str(resolved)


def nullable_str(value: Any) -> str | None:
    text = safe_str(value)
    return text or None


def truncate(value: Any, max_len: int) -> str:
    text = safe_str(value)
    return text if len(text) <= max_len else text[: max_len - 3] + "..."


def normalize_rel_path(value: str) -> str:
    return safe_str(value).replace("\\", "/").lstrip("./")


def extract_drive_id(filename_or_path: str) -> str | None:
    text = safe_str(filename_or_path)
    for pattern in [r"drive_([A-Za-z0-9_-]{10,})", r"/file/d/([A-Za-z0-9_-]{10,})", r"[?&]id=([A-Za-z0-9_-]{10,})"]:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


def sanitize_id(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", safe_str(value))
    text = re.sub(r"_+", "_", text).strip("_")
    return text[:160] or "document"


def normalize_only_pdf_token(value: str) -> str:
    text = normalize_rel_path(value)
    return extract_drive_id(text) or text.replace(".pdf", "")


def pdf_matches_tokens(pdf: PdfInfo, tokens: set[str]) -> bool:
    candidates = {pdf.rel_path, pdf.path.name, pdf.path.stem, pdf.pdf_id}
    if pdf.drive_id:
        candidates.update({pdf.drive_id, f"drive_{pdf.drive_id}"})
    normalized = {normalize_only_pdf_token(item) for item in candidates}
    return bool(tokens & normalized or tokens & candidates)


def parse_shard(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*", value)
    if not match:
        raise ValueError(f"--shard must be i/N, got {value!r}")
    index, total = int(match.group(1)), int(match.group(2))
    if total <= 0 or index < 0 or index >= total:
        raise ValueError(f"invalid --shard {value!r}; require 0 <= i < N")
    return index, total


def is_loopback_host(host: str | None) -> bool:
    normalized = safe_str(host).strip("[]").lower()
    return normalized in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def parse_optional_int(value: str | None) -> int | None:
    return None if value is None or safe_str(value) == "" else int(value)


def parse_optional_float(value: str | None) -> float | None:
    return None if value is None or safe_str(value) == "" else float(value)


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return int(default)


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except Exception:
        return float(default)
    return float(default) if math.isnan(parsed) or math.isinf(parsed) else parsed


def env_optional_int(key: str) -> int | None:
    value = os.environ.get(key)
    if safe_str(value) == "":
        return None
    try:
        return int(safe_str(value))
    except Exception:
        print(f"WARNING: invalid integer env {key}; ignoring", file=sys.stderr)
        return None


def env_int(key: str, default: int) -> int:
    value = os.environ.get(key)
    if safe_str(value) == "":
        return int(default)
    try:
        return int(safe_str(value))
    except Exception:
        print(f"WARNING: invalid integer env {key}; using {default}", file=sys.stderr)
        return int(default)


def env_float(key: str, default: float) -> float:
    value = os.environ.get(key)
    if safe_str(value) == "":
        return float(default)
    try:
        return float(safe_str(value))
    except Exception:
        print(f"WARNING: invalid float env {key}; using {default}", file=sys.stderr)
        return float(default)


def env_bool(key: str, default: bool = False) -> bool:
    value = os.environ.get(key)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "y", "on"}


def redact_sensitive(value: Any) -> str:
    text = safe_str(value)
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if api_key:
        text = text.replace(api_key, "[REDACTED_OPENAI_API_KEY]")
        if len(api_key) > 12:
            text = text.replace(api_key[:8], "[REDACTED_OPENAI_API_KEY_PREFIX]")
            text = text.replace(api_key[-8:], "[REDACTED_OPENAI_API_KEY_SUFFIX]")
    # Provider errors can echo masked keys (for example many stars plus a
    # final 4-character suffix) that are not equal to the raw key string.
    text = re.sub(r"(?i)(incorrect api key provided:\s*)[^\s.,;]+", r"\1[REDACTED_OPENAI_API_KEY]", text)
    text = re.sub(r"\[REDACTED_OPENAI_API_KEY_PREFIX\][*A-Za-z0-9._~+/=-]*", "[REDACTED_OPENAI_API_KEY]", text)
    text = re.sub(r"[A-Za-z0-9._~+/=-]{0,12}\*{8,}[A-Za-z0-9._~+/=-]{0,12}", "[REDACTED_MASKED_SECRET]", text)
    # Redact common bearer/API-key-looking substrings without destroying ordinary error context.
    text = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]{12,}", "Bearer [REDACTED]", text, flags=re.I)
    text = re.sub(r"sk-[A-Za-z0-9._~+/=-]{10,}", "sk-[REDACTED]", text)
    text = re.sub(r"(?i)(api[_-]?key\s*[=:]\s*)[A-Za-z0-9._~+/=-]{8,}", r"\1[REDACTED]", text)
    return text


def redact_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            if re.search(r"(?i)(api[_-]?key|authorization|bearer|secret|token)", safe_str(key)):
                result[key] = "[REDACTED]"
            else:
                result[key] = redact_for_json(item)
        return result
    if isinstance(value, list):
        return [redact_for_json(item) for item in value]
    if isinstance(value, tuple):
        return [redact_for_json(item) for item in value]
    if isinstance(value, str):
        return redact_sensitive(value)
    return value


def pdf_summary(pdf: PdfInfo) -> dict[str, Any]:
    return {"pdf_id": pdf.pdf_id, "drive_id": pdf.drive_id, "path": pdf.rel_path, "source_site": pdf.source_site, "source_url": pdf.source_url, "page_count": pdf.page_count, "size_mb": round(pdf.byte_size / (1024 ** 2), 2), "priority_rank": pdf.priority_rank, "metadata_score": pdf.metadata_score, "has_extracted_name": pdf.has_extracted_name, "has_known_links": pdf.has_known_links, "text_word_count_first_pages": pdf.text_word_count}


def normalize_usage(usage: Any) -> dict[str, int]:
    if not isinstance(usage, dict):
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    input_tokens = safe_int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0, 0)
    output_tokens = safe_int(usage.get("output_tokens") or usage.get("completion_tokens") or 0, 0)
    return {"input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": safe_int(usage.get("total_tokens") or input_tokens + output_tokens, input_tokens + output_tokens)}


def add_usage(left: dict[str, Any], right: dict[str, Any]) -> dict[str, int]:
    normalized_left = normalize_usage(left)
    normalized_right = normalize_usage(right)
    return {key: normalized_left[key] + normalized_right[key] for key in ["input_tokens", "output_tokens", "total_tokens"]}


def sum_usage(usages: Iterable[dict[str, Any]]) -> dict[str, int]:
    result = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    for usage in usages:
        normalized = normalize_usage(usage)
        for key in result:
            result[key] += normalized[key]
    return result


def response_incomplete_reason(data: Any) -> str | None:
    """Detect Responses-style truncation/incomplete metadata before accepting OCR."""
    if not isinstance(data, dict):
        return None
    status = safe_str(data.get("status")).lower()
    if status == "incomplete":
        return "status=incomplete"
    details = data.get("incomplete_details")
    if details:
        return f"incomplete_details={truncate(details, 500)}"
    finish_reasons: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key in ["finish_reason", "finishReason", "stop_reason", "stopReason"]:
                reason = safe_str(value.get(key)).lower()
                if reason:
                    finish_reasons.append(reason)
            for nested in value.values():
                if isinstance(nested, (dict, list)):
                    visit(nested)
        elif isinstance(value, list):
            for item in value:
                visit(item)

    visit(data)
    bad_reasons = [reason for reason in finish_reasons if reason in {"length", "max_tokens", "max_output_tokens", "token_limit"}]
    if bad_reasons:
        return f"finish_reason={bad_reasons[0]}"
    return None


def estimate_cost_from_usage(usage: dict[str, Any], config: Config) -> float | None:
    if config.input_price_per_1m is None or config.output_price_per_1m is None:
        return None
    cost = float(usage.get("input_tokens") or 0) / 1_000_000 * config.input_price_per_1m + float(usage.get("output_tokens") or 0) / 1_000_000 * config.output_price_per_1m
    return round(cost, 4)


def estimate_cost(remaining_pages: int, avg_usage: dict[str, Any] | None, config: Config) -> dict[str, Any] | None:
    if config.input_price_per_1m is None or config.output_price_per_1m is None:
        return None
    if not avg_usage:
        return {"estimated_cost_usd": None, "basis": "set OCR_INPUT_PRICE_PER_1M/OCR_OUTPUT_PRICE_PER_1M and run pilot for token averages"}
    usage = {"input_tokens": remaining_pages * float(avg_usage.get("input_tokens") or 0), "output_tokens": remaining_pages * float(avg_usage.get("output_tokens") or 0)}
    usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
    return {"estimated_cost_usd": estimate_cost_from_usage(usage, config), "basis": "pilot average usage"}


def estimate_cost_from_usage_projection(stats: RunStats, all_inventory: list[PdfInfo], config: Config) -> dict[str, Any] | None:
    if not stats.pages_completed:
        return estimate_cost(sum(pdf.page_count for pdf in all_inventory), None, config)
    return estimate_cost(sum(pdf.page_count for pdf in all_inventory), {"input_tokens": stats.input_tokens / stats.pages_completed, "output_tokens": stats.output_tokens / stats.pages_completed}, config)


def latency_summary(values: list[int]) -> dict[str, Any]:
    if not values:
        return {"count": 0}
    ordered = sorted(values)
    return {"count": len(values), "avg": round(sum(values) / len(values), 1), "min": ordered[0], "p50": ordered[len(ordered) // 2], "p95": ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))], "max": ordered[-1]}


def check_disk_free(path: Path, min_free_gb: float) -> None:
    free = free_disk_gb(path)
    if free < min_free_gb:
        raise OcrError(f"Free disk {free:.2f} GiB is below minimum {min_free_gb:.2f} GiB")


def free_disk_gb(path: Path) -> float:
    target = path if path.exists() else path.parent
    return round(shutil.disk_usage(target).free / (1024 ** 3), 3)


def human_duration(seconds: float | None) -> str | None:
    if seconds is None:
        return None
    seconds = max(0, float(seconds))
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.1f}m"
    hours = minutes / 60
    return f"{hours:.1f}h" if hours < 48 else f"{hours / 24:.1f}d"


def tokenize_question(text: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", safe_str(text).lower())
    return [token for token in normalized.split() if len(token) > 2 and token not in STOP_WORDS and not token.isdigit()]


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", safe_str(text).lower()).strip()


def strong_phrase_bonus(left: str, right: str) -> float:
    left_tokens = normalize_key(left).split()
    right_norm = normalize_key(right)
    for n in (5, 4, 3):
        if len(left_tokens) < n:
            continue
        if any(" ".join(left_tokens[i:i+n]) in right_norm for i in range(len(left_tokens) - n + 1)):
            return 0.08 + n * 0.01
    return 0.0


def first_nonempty(*values: Any) -> Any:
    if len(values) == 1 and not isinstance(values[0], (str, bytes, dict)) and isinstance(values[0], Iterable):
        iterable = values[0]
    else:
        iterable = values
    for value in iterable:
        if safe_str(value):
            return value
    return None


def ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [value]


def clamp_float(value: Any, low: float, high: float, default: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return default if math.isnan(parsed) or math.isinf(parsed) else max(low, min(high, parsed))


def page_in_record(rec: dict[str, Any], page_number: int) -> bool:
    with contextlib.suppress(Exception):
        return int(rec.get("pageNormalized")) == int(page_number)
    return False


def page_in_known_link(link: dict[str, Any], page_number: int) -> bool:
    with contextlib.suppress(Exception):
        return int(link.get("pageNormalized")) == int(page_number)
    return False


def page_in_known_link_span(link: dict[str, Any], start_page: int, end_page: int) -> bool:
    with contextlib.suppress(Exception):
        page_int = int(link.get("pageNormalized"))
        return start_page <= page_int <= end_page
    return False


def page_in_record_span(rec: dict[str, Any], start_page: int, end_page: int) -> bool:
    with contextlib.suppress(Exception):
        page_int = int(rec.get("pageNormalized"))
        return start_page <= page_int <= end_page
    return False


def simplify_records_for_prompt(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"answerId": rec.get("answerId"), "question": truncate(rec.get("extractedQuestion"), 300), "paper": rec.get("paper"), "topperName": rec.get("topperName"), "pageNormalized": rec.get("pageNormalized"), "summary": truncate(rec.get("summary"), 240)} for rec in records[:6]]


def simplify_links_for_prompt(links: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"officialQuestionId": link.get("officialQuestionId"), "matchType": link.get("matchType"), "matchConfidence": link.get("matchConfidence"), "question": truncate(link.get("extractedQuestion"), 300), "paper": link.get("paper"), "pageNormalized": link.get("pageNormalized")} for link in links[:6]]


def page_signal(page: dict[str, Any], key: str) -> str:
    signals = page.get("answer_signals") if isinstance(page.get("answer_signals"), dict) else {}
    return safe_str(signals.get(key))


def combine_page_signal_lists(pages: list[dict[str, Any]], key: str, max_items: int = 40) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for page in pages:
        signals = page.get("answer_signals") if isinstance(page.get("answer_signals"), dict) else {}
        for item in ensure_list(signals.get(key)):
            text = safe_str(item)
            norm = normalize_key(text)
            if text and norm not in seen:
                seen.add(norm)
                values.append(text)
                if len(values) >= max_items:
                    return values
    return values


def combine_unique(values: Iterable[Any], max_items: int = 5) -> str:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = safe_str(value)
        norm = normalize_key(text)
        if text and norm not in seen:
            seen.add(norm)
            result.append(text)
            if len(result) >= max_items:
                break
    return " / ".join(result)


def format_list(value: Any) -> str:
    items = [safe_str(item) for item in ensure_list(value) if safe_str(item)]
    return "; ".join(items) if items else ""


def format_compact_json(value: Any) -> str:
    return truncate(json_dumps(value), 900) if value else ""


if __name__ == "__main__":
    raise SystemExit(main())
