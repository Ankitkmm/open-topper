#!/usr/bin/env python3
"""Discover and safely download UPSC topper answer-copy PDFs.

This script is intentionally self-contained and conservative:

* Bounded crawling only: source allow-lists, depth/page/PDF URL caps, retry caps.
* Direct PDF discovery from HTML attrs (href/src/data-*), raw HTML/text, and embedded JSON.
* Source-page cache for reproducible re-runs.
* SQLite plus JSON manifests for auditability.
* Atomic downloads with PDF validation before publish.
* Multi-layer dedupe using normalized URLs, object-storage/Drive keys, SHA-256, and
  existing repository runtime data.

Default output root:
    /Volumes/Acer/open-topper/extracted_data/ocr_openai

Examples:
    python3 scripts/discover_topper_pdfs.py --discover --source nextias --limit 50
    python3 scripts/discover_topper_pdfs.py --discover --download --source all --limit 100
    python3 scripts/discover_topper_pdfs.py --discover --source generic \
        --seed https://example.edu/topper-copies --max-depth 1
    python3 scripts/discover_topper_pdfs.py --download --source visionias --limit 25
"""

from __future__ import annotations

import argparse
import concurrent.futures
import contextlib
import dataclasses
import datetime as _dt
import email.utils
import hashlib
import html
import json
import mimetypes
import os
import queue
import random
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.error
import urllib.request
import urllib.robotparser
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Set, Tuple


try:  # Preferred HTTP stack.
    import requests  # type: ignore
except Exception:  # pragma: no cover - environment-dependent fallback.
    requests = None  # type: ignore

try:  # Preferred HTML parser.
    from bs4 import BeautifulSoup  # type: ignore
except Exception:  # pragma: no cover - environment-dependent fallback.
    BeautifulSoup = None  # type: ignore

try:  # Preferred PDF validator.
    import fitz  # type: ignore  # PyMuPDF
except Exception:  # pragma: no cover - environment-dependent fallback.
    fitz = None  # type: ignore


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parents[1]
REPO_OCR_ROOT = REPO_ROOT / "extracted_data" / "ocr_openai"
ACER_PROJECT_ROOT = Path("/Volumes/Acer/open-topper")
ACER_OCR_ROOT = ACER_PROJECT_ROOT / "extracted_data" / "ocr_openai"
DEFAULT_OUTPUT_DIR = ACER_OCR_ROOT if ACER_PROJECT_ROOT.exists() else REPO_OCR_ROOT
SOURCE_DIR_NAME = "sources"
SOURCE_PAGES_DIR_NAME = "source-pages"
DOWNLOAD_DIR_NAME = "downloaded-pdfs"
INTERNET_DISCOVERY_WORKFLOW_ENV = "ALLOW_INTERNET_DISCOVERY_WORKFLOW"

ISO_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
DEFAULT_USER_AGENT = (
    "open-topper-pdf-discovery/1.0 "
    "(bounded crawler; contact: local repository operator)"
)

RETRY_STATUSES = {408, 425, 429, 500, 502, 503, 504}
HTMLISH_CONTENT_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
    "application/json",
    "text/plain",
}

SKIP_CRAWL_EXTENSIONS = {
    ".7z",
    ".avi",
    ".bmp",
    ".css",
    ".csv",
    ".doc",
    ".docx",
    ".eot",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".m4a",
    ".m4v",
    ".mov",
    ".mp3",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".ods",
    ".odt",
    ".otf",
    ".png",
    ".ppt",
    ".pptx",
    ".rar",
    ".svg",
    ".tar",
    ".tgz",
    ".tif",
    ".tiff",
    ".ttf",
    ".wav",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".xls",
    ".xlsx",
    ".xml.gz",
    ".zip",
}

PDF_HINT_RE = re.compile(
    r"(?i)\b(pdf|booklet|answer[-_\s]*copy|answer[-_\s]*booklet|topper|toppers|copy|mains|psir|gs[-_\s]?[1-4]|essay)\b"
)

SOURCE_LINK_KEYWORD_RE = re.compile(
    r"(?i)\b(topper|answer|booklet|copy|mains|essay|optional|psir|resources?|cse|ias|upsc|rank|air|test[-_\s]*series)\b"
)

URL_RE = re.compile(
    r"""(?ix)
    (?:
        https?:\\?/\\?/[^"'<> \t\r\n]+
      | //[A-Za-z0-9.-]+/[^"'<> \t\r\n]+
      | \bwww\.[^"'<> \t\r\n]+
      | (?<![A-Za-z0-9_./:-])/[A-Za-z0-9_./%+~!$&'()*;,=:@-]+?\.pdf(?:\?[^"'<> \t\r\n)]*)?
      | (?<![A-Za-z0-9_./:-])(?:[A-Za-z0-9_.%+~!$&'()*;,=:@-]+/)+[A-Za-z0-9_.%+~!$&'()*;,=:@-]+?\.pdf(?:\?[^"'<> \t\r\n)]*)?
    )
    """
)

GOOGLE_DRIVE_ID_RE_LIST = [
    re.compile(r"(?i)drive\.google\.com/file/d/([A-Za-z0-9_-]{10,})"),
    re.compile(r"(?i)drive\.google\.com/(?:open|uc)\?[^#]*\bid=([A-Za-z0-9_-]{10,})"),
    re.compile(r"(?i)[?&]id=([A-Za-z0-9_-]{10,})"),
]

TRAILING_URL_JUNK = "\"'“”‘’.,;:!?)>]}"

URL_ATTRS = {
    "href",
    "src",
    "data-href",
    "data-src",
    "data-url",
    "data-uri",
    "data-file",
    "data-file-url",
    "data-download",
    "data-download-url",
    "data-pdf",
    "data-pdf-url",
    "data-link",
    "poster",
    "content",
    "value",
    "onclick",
}


SOURCE_CONFIGS: Dict[str, Dict[str, Any]] = {
    "nextias": {
        "label": "NEXT IAS",
        "seeds": ["https://www.nextias.com/toppers-answers-ias/"],
        "allowed_domains": ["nextias.com"],
        "keywords": ["topper", "answer", "booklet", "mains", "cse", "upsc", "rank"],
    },
    "vajiram": {
        "label": "Vajiram & Ravi",
        "seeds": [
            "https://vajiramandravi.com/upsc-ias-toppers-copy-and-answer-sheets/",
            "https://vajiramandravi.com/upsc-exam/shakti-dubey-upsc-topper-2024-answer-copy/",
            "https://vajiramandravi.com/upsc-exam/upsc-cse-exam/",
        ],
        "allowed_domains": ["vajiramandravi.com"],
        "keywords": ["topper", "answer", "copy", "mains", "upsc", "rank"],
    },
    "drshivin": {
        "label": "Dr. Shivin",
        "seeds": ["https://www.drshivin.com/topper-copies", "https://www.drshivin.com/api/data/topperCopies"],
        "allowed_domains": ["drshivin.com"],
        "keywords": ["topper", "copies", "copy", "answer", "mains", "gs", "essay"],
    },
    "visionias": {
        "label": "Vision IAS",
        "seeds": ["https://visionias.in/resources/toppers-answer-copy/"],
        "allowed_domains": ["visionias.in", "cdn.visionias.in", "d19k0hz679a7ts.cloudfront.net"],
        "keywords": ["topper", "answer", "booklet", "resources", "rank", "vision"],
    },
    "shubhraranjan": {
        "label": "Shubhra Ranjan",
        "seeds": ["https://www.shubhraranjan.com/toppers-copies"],
        "allowed_domains": ["shubhraranjan.com", "shubhraviraj.in", "admin.shubhraviraj.in"],
        "keywords": ["topper", "copies", "psir", "essay", "test", "rank", "air"],
    },
    "generic": {
        "label": "Generic user-provided source",
        "seeds": [],
        "allowed_domains": [],
        "keywords": ["topper", "answer", "booklet", "copy", "mains", "upsc", "ias", "pdf"],
    },
}


def utc_now() -> str:
    return _dt.datetime.now(_dt.UTC).strftime(ISO_FORMAT)


def parse_utc(value: str) -> _dt.datetime:
    return _dt.datetime.strptime(value, ISO_FORMAT).replace(tzinfo=_dt.UTC)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def env_bool(key: str, default: bool = False) -> bool:
    value = os.environ.get(key)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "y", "on"}


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def atomic_write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def safe_json_loads(text: str) -> Optional[Any]:
    try:
        return json.loads(text)
    except Exception:
        return None


def coerce_json_array(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        parsed = safe_json_loads(value)
        if isinstance(parsed, list):
            return parsed
        if value:
            return [value]
    return [value]


def merge_json_lists(*values: Any) -> str:
    seen: Set[str] = set()
    merged: List[Any] = []
    for value in values:
        for item in coerce_json_array(value):
            key = json.dumps(item, ensure_ascii=False, sort_keys=True) if not isinstance(item, str) else item
            if key not in seen:
                seen.add(key)
                merged.append(item)
    return json.dumps(merged, ensure_ascii=False, sort_keys=False)




def safe_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.replace("\u00a0", " ").strip()
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value).replace("\u00a0", " ").strip()

def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def html_unescape_deep(value: str) -> str:
    """Decode the common escaping layers found in HTML/Next/JSON blobs."""
    if not value:
        return ""
    out = value
    for _ in range(3):
        before = out
        out = html.unescape(out)
        out = (
            out.replace("\\/", "/")
            .replace("\\u002F", "/")
            .replace("\\u002f", "/")
            .replace("\\u003A", ":")
            .replace("\\u003a", ":")
            .replace("\\u0026", "&")
            .replace("\\u003D", "=")
            .replace("\\u003d", "=")
            .replace("&amp;", "&")
        )
        if before == out:
            break
    return out


def strip_url_junk(value: str) -> str:
    value = value.strip().strip("\x00")
    # Trim common punctuation while preserving query values as much as possible.
    while value and value[-1] in TRAILING_URL_JUNK:
        # Do not strip a literal ")" if URL has balanced parentheses in its path.
        if value[-1] == ")" and value.count("(") >= value.count(")"):
            break
        value = value[:-1]
    return value.strip()


def normalize_url(raw_url: str, base_url: Optional[str] = None) -> Optional[str]:
    if not raw_url:
        return None
    value = html_unescape_deep(str(raw_url))
    value = strip_url_junk(value)
    if not value:
        return None
    lowered = value.lower()
    if lowered.startswith(("javascript:", "mailto:", "tel:", "sms:", "data:", "blob:", "#")):
        return None
    if value.startswith("\\/"):
        value = value.replace("\\/", "/")
    if value.startswith("//"):
        scheme = urllib.parse.urlsplit(base_url).scheme if base_url else "https"
        value = f"{scheme}:{value}"
    elif value.startswith("www."):
        value = f"https://{value}"
    elif base_url:
        value = urllib.parse.urljoin(base_url, value)

    try:
        split = urllib.parse.urlsplit(value)
    except Exception:
        return None

    if split.scheme not in {"http", "https"}:
        return None
    if not split.netloc:
        return None

    drive_id = extract_google_drive_id(value)
    if drive_id:
        return f"https://drive.google.com/file/d/{drive_id}/view"

    scheme = split.scheme.lower()
    hostname = (split.hostname or "").lower()
    port = split.port
    netloc = hostname
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"

    # Preserve path case because object storage can be case-sensitive, but normalize
    # dot segments and safe quoting.
    path = urllib.parse.unquote(split.path or "/")
    path = re.sub(r"/{2,}", "/", path)
    path = urllib.parse.quote(path, safe="/:@!$&'()*+,;=%-._~")

    query_pairs = urllib.parse.parse_qsl(split.query, keep_blank_values=True)
    filtered: List[Tuple[str, str]] = []
    for key, val in query_pairs:
        kl = key.lower()
        if kl.startswith("utm_") or kl in {"fbclid", "gclid", "mc_cid", "mc_eid", "igshid"}:
            continue
        filtered.append((key, val))
    filtered.sort(key=lambda kv: (kv[0].lower(), kv[1]))
    query = urllib.parse.urlencode(filtered, doseq=True)
    return urllib.parse.urlunsplit((scheme, netloc, path, query, ""))


def extract_google_drive_id(value: str) -> Optional[str]:
    if not value:
        return None
    unescaped = html_unescape_deep(value)
    lower = unescaped.lower()
    # Avoid treating arbitrary analytics query parameters such as
    # googletagmanager.com/gtm.js?id=GTM-... as Google Drive files.
    drive_file = re.search(r"(?i)(?:^|[/_-])drive[_-]?([A-Za-z0-9_-]{10,})(?:\.pdf)?$", unescaped)
    if drive_file:
        return drive_file.group(1)
    if "drive.google.com" not in lower:
        return None
    for regex in GOOGLE_DRIVE_ID_RE_LIST:
        match = regex.search(unescaped)
        if match:
            return match.group(1)
    return None

def url_host(url: str) -> str:
    try:
        return (urllib.parse.urlsplit(url).hostname or "").lower()
    except Exception:
        return ""


def host_matches(host: str, allowed_domain: str) -> bool:
    host = host.lower().strip(".")
    allowed = allowed_domain.lower().strip(".")
    return host == allowed or host.endswith("." + allowed)


def allowed_by_domains(url: str, allowed_domains: Sequence[str]) -> bool:
    if not allowed_domains:
        return True
    host = url_host(url)
    return any(host_matches(host, domain) for domain in allowed_domains)


def extension_for_url(url: str) -> str:
    try:
        path = urllib.parse.unquote(urllib.parse.urlsplit(url).path)
    except Exception:
        return ""
    suffix = Path(path).suffix.lower()
    # Treat ".xml.gz" as a combined suffix where possible.
    if suffix == ".gz" and path.lower().endswith(".xml.gz"):
        return ".xml.gz"
    return suffix


def is_probable_pdf_url(url: str) -> bool:
    if not url:
        return False
    u = html_unescape_deep(url)
    lowered = u.lower()
    if extract_google_drive_id(u):
        return True
    if ".pdf" in lowered:
        return True
    # Some sites expose PDF downloads through routes/query params without a .pdf suffix.
    try:
        split = urllib.parse.urlsplit(u)
    except Exception:
        return False
    path_l = urllib.parse.unquote(split.path or "").lower()
    query_keys = {key.lower() for key, _ in urllib.parse.parse_qsl(split.query, keep_blank_values=True)}
    if re.search(r"\b(pdf|downloadpdf|toppers?copy|toppers?answerbooklet|answerbooklet)\b", path_l):
        return True
    if query_keys & {"pdf", "file", "download", "downloadpdf"}:
        return True
    return False


def is_htmlish_crawl_url(url: str) -> bool:
    try:
        split = urllib.parse.urlsplit(url)
    except Exception:
        return False
    if split.scheme not in {"http", "https"}:
        return False
    path = urllib.parse.unquote(split.path or "/")
    ext = extension_for_url(url)
    if ext == ".pdf":
        return False
    if ext in SKIP_CRAWL_EXTENSIONS:
        return False
    return True


def repeatedly_unquote(value: str, rounds: int = 3) -> str:
    out = value
    for _ in range(rounds):
        decoded = urllib.parse.unquote(out)
        if decoded == out:
            break
        out = decoded
    return out


def extract_urls_from_text(text: str, base_url: str) -> List[str]:
    if not text:
        return []
    variants = [html_unescape_deep(text)]
    unquoted = repeatedly_unquote(variants[0])
    if unquoted != variants[0]:
        variants.append(html_unescape_deep(unquoted))

    found: List[str] = []
    seen: Set[str] = set()
    for variant in variants:
        for match in URL_RE.finditer(variant):
            raw = match.group(0)
            norm = normalize_url(raw, base_url)
            if norm and norm not in seen:
                seen.add(norm)
                found.append(norm)

        # Query parameters often hold an encoded PDF URL inside a non-PDF viewer URL.
        for raw in re.findall(r"(?i)(?:url|file|pdf|src|href|download)=([^&\"'<> \t\r\n]+)", variant):
            decoded = repeatedly_unquote(raw)
            for nested in URL_RE.finditer(decoded):
                norm = normalize_url(nested.group(0), base_url)
                if norm and norm not in seen:
                    seen.add(norm)
                    found.append(norm)
            norm = normalize_url(decoded, base_url)
            if norm and norm not in seen:
                seen.add(norm)
                found.append(norm)
    return found


def json_walk_strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, Mapping):
        for key, val in value.items():
            if isinstance(key, str):
                yield key
            yield from json_walk_strings(val)
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        for item in value:
            yield from json_walk_strings(item)


def maybe_json_values_from_script(text: str) -> Iterator[Any]:
    if not text:
        return
    stripped = html_unescape_deep(text).strip()
    if not stripped:
        return
    parsed = safe_json_loads(stripped)
    if parsed is not None:
        yield parsed
        return

    # Common patterns: window.__DATA__ = {...}; or self.__next_f.push([...]).
    for candidate in re.findall(r"(?s)(\{.{50,}\}|\[.{50,}\])", stripped[:2_000_000]):
        candidate = candidate.strip().rstrip(";")
        parsed = safe_json_loads(candidate)
        if parsed is not None:
            yield parsed


def make_context(text: str, limit: int = 500) -> str:
    return normalize_space(text)[:limit]


@dataclass
class ExtractedRef:
    url: str
    method: str
    text: str = ""
    title: str = ""
    context: str = ""


@dataclass
class PageExtraction:
    pdf_refs: List[ExtractedRef] = field(default_factory=list)
    crawl_links: List[ExtractedRef] = field(default_factory=list)


class FallbackHTMLExtractor(HTMLParser):
    """Small stdlib fallback for href/src extraction when BeautifulSoup is absent."""

    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.refs: List[ExtractedRef] = []
        self.links: List[ExtractedRef] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attrs_dict = {k.lower(): v or "" for k, v in attrs}
        for name, value in attrs_dict.items():
            if name not in URL_ATTRS and not name.startswith("data-"):
                continue
            for url in extract_urls_from_text(value, self.base_url):
                ref = ExtractedRef(url=url, method=f"htmlparser:{tag}[{name}]", title=attrs_dict.get("title", ""))
                if is_probable_pdf_url(url):
                    self.refs.append(ref)
                elif is_htmlish_crawl_url(url):
                    self.links.append(ref)


def extract_from_html(content: bytes, base_url: str) -> PageExtraction:
    # Keep replacement behavior deterministic for malformed pages.
    text = content.decode("utf-8", errors="replace")
    extraction = PageExtraction()

    if BeautifulSoup is not None:
        soup = BeautifulSoup(text, "html.parser")
        for tag in soup.find_all(True):
            tag_name = getattr(tag, "name", "") or ""
            tag_text = make_context(tag.get_text(" ", strip=True), 250)
            title = make_context(
                str(tag.get("title") or tag.get("aria-label") or tag.get("alt") or ""),
                250,
            )
            attrs = getattr(tag, "attrs", {}) or {}
            for attr_name, attr_value in attrs.items():
                attr_l = str(attr_name).lower()
                if attr_l not in URL_ATTRS and not attr_l.startswith("data-"):
                    continue
                if isinstance(attr_value, (list, tuple)):
                    raw_values = [str(v) for v in attr_value]
                else:
                    raw_values = [str(attr_value)]
                for raw_value in raw_values:
                    for url in extract_urls_from_text(raw_value, base_url):
                        ref = ExtractedRef(
                            url=url,
                            method=f"attr:{tag_name}[{attr_l}]",
                            text=tag_text,
                            title=title,
                            context=make_context(raw_value if len(raw_value) > len(tag_text) else tag_text),
                        )
                        if is_probable_pdf_url(url):
                            extraction.pdf_refs.append(ref)
                        elif is_htmlish_crawl_url(url):
                            extraction.crawl_links.append(ref)

        for script in soup.find_all("script"):
            script_text = script.string if script.string is not None else script.get_text("\n", strip=False)
            for url in extract_urls_from_text(script_text or "", base_url):
                ref = ExtractedRef(url=url, method="raw:script", context="embedded script URL")
                if is_probable_pdf_url(url):
                    extraction.pdf_refs.append(ref)
                elif is_htmlish_crawl_url(url):
                    extraction.crawl_links.append(ref)
            script_type = str(script.get("type") or "").lower()
            script_id = str(script.get("id") or "")
            if "json" in script_type or script_id in {"__NEXT_DATA__", "__NUXT_DATA__"}:
                for parsed in maybe_json_values_from_script(script_text or ""):
                    for raw in json_walk_strings(parsed):
                        for url in extract_urls_from_text(raw, base_url):
                            ref = ExtractedRef(url=url, method="json:script", context=make_context(raw, 250))
                            if is_probable_pdf_url(url):
                                extraction.pdf_refs.append(ref)
                            elif is_htmlish_crawl_url(url):
                                extraction.crawl_links.append(ref)
    else:
        parser = FallbackHTMLExtractor(base_url)
        with contextlib.suppress(Exception):
            parser.feed(text)
        extraction.pdf_refs.extend(parser.refs)
        extraction.crawl_links.extend(parser.links)

    # Always run a raw scan, even with BeautifulSoup, because framework state can be
    # present in comments, escaped JS strings, inline JSON, or hydration payloads.
    for url in extract_urls_from_text(text, base_url):
        ref = ExtractedRef(url=url, method="raw:page", context="raw page scan")
        if is_probable_pdf_url(url):
            extraction.pdf_refs.append(ref)
        elif is_htmlish_crawl_url(url):
            extraction.crawl_links.append(ref)

    extraction.pdf_refs = dedupe_refs(extraction.pdf_refs)
    extraction.crawl_links = dedupe_refs(extraction.crawl_links)
    return extraction


def dedupe_refs(refs: Iterable[ExtractedRef]) -> List[ExtractedRef]:
    seen: Set[str] = set()
    out: List[ExtractedRef] = []
    for ref in refs:
        norm = normalize_url(ref.url) or ref.url
        if norm in seen:
            continue
        seen.add(norm)
        out.append(dataclasses.replace(ref, url=norm))
    return out


def object_name_key(value: str) -> Optional[str]:
    if not value:
        return None
    raw = html_unescape_deep(str(value))
    raw = repeatedly_unquote(raw)
    raw = raw.strip().strip("/")
    if not raw:
        return None
    name = Path(urllib.parse.urlsplit(raw).path or raw).name if "://" in raw else Path(raw).name
    if not name:
        name = raw
    name = re.sub(r"(?i)\.pdf$", "", name)
    if name.lower().startswith("drive_"):
        name = name[6:]
    name = re.sub(r"[_\s]+", " ", name)
    name = re.sub(r"[^A-Za-z0-9 .@()+_-]+", " ", name)
    name = normalize_space(name).lower()
    if len(name) < 8:
        return None
    return f"filename:{name}"


def object_keys_for_url(url: str) -> List[str]:
    norm = normalize_url(url) or url
    keys: List[str] = []
    drive_id = extract_google_drive_id(url) or extract_google_drive_id(norm)
    if drive_id:
        keys.append(f"drive:{drive_id}")
    try:
        split = urllib.parse.urlsplit(norm)
    except Exception:
        split = urllib.parse.SplitResult("", "", "", "", "")
    host = (split.hostname or "").lower()
    path = urllib.parse.unquote(split.path or "").lstrip("/")
    path_l = path.lower()
    if host and path:
        keys.append(f"urlpath:{host}/{path_l}")
        if (
            host.endswith("r2.dev")
            or "cloudfront.net" in host
            or "digitaloceanspaces.com" in host
            or "amazonaws.com" in host
            or host.startswith("cdn.")
            or "/storedata/" in f"/{path_l}"
        ):
            keys.append(f"object:{host}/{path_l}")
    name_key = object_name_key(path or norm)
    if name_key:
        keys.append(name_key)
    # Preserve order while deduping.
    seen: Set[str] = set()
    out: List[str] = []
    for key in keys:
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out


def primary_object_key(url: str) -> str:
    keys = object_keys_for_url(url)
    if keys:
        return keys[0]
    norm = normalize_url(url) or url
    return "urlsha:" + hashlib.sha256(norm.encode("utf-8")).hexdigest()[:24]


def sanitize_filename_part(value: str, fallback: str = "document", max_len: int = 120) -> str:
    value = html_unescape_deep(value or "")
    value = repeatedly_unquote(value)
    value = re.sub(r"(?i)\.pdf$", "", value)
    value = re.sub(r"[_\s]+", " ", value)
    value = re.sub(r"[^\w .@()+,-]+", " ", value, flags=re.UNICODE)
    value = normalize_space(value).strip(". ")
    if not value:
        value = fallback
    return value[:max_len].strip(". ") or fallback


def filename_hint_for_candidate(url: str, ref: ExtractedRef, source: str) -> str:
    pieces: List[str] = []
    for value in [ref.title, ref.text, ref.context]:
        value = normalize_space(value)
        if value and PDF_HINT_RE.search(value):
            pieces.append(value)
            break
    try:
        path_name = Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).name
    except Exception:
        path_name = ""
    if path_name:
        pieces.append(path_name)
    drive_id = extract_google_drive_id(url)
    if drive_id:
        pieces.append(f"drive_{drive_id}")
    base = sanitize_filename_part(" ".join(pieces), fallback=f"{source}_topper_copy")
    return f"{base}.pdf"


@dataclass
class ExistingIndex:
    normalized_urls: Dict[str, List[str]] = field(default_factory=lambda: defaultdict(list))
    object_keys: Dict[str, List[str]] = field(default_factory=lambda: defaultdict(list))
    shas: Dict[str, List[str]] = field(default_factory=lambda: defaultdict(list))
    counts: Dict[str, int] = field(default_factory=dict)

    def add_url(self, url: str, source: str) -> None:
        norm = normalize_url(url)
        if not norm:
            return
        if source not in self.normalized_urls[norm]:
            self.normalized_urls[norm].append(source)
        for key in object_keys_for_url(norm):
            if source not in self.object_keys[key]:
                self.object_keys[key].append(source)

    def add_object_name(self, value: str, source: str) -> None:
        key = object_name_key(value)
        if key and source not in self.object_keys[key]:
            self.object_keys[key].append(source)
        # Drive IDs are often encoded in repo filenames/keys.
        drive_id = extract_google_drive_id(value)
        if not drive_id:
            match = re.search(r"(?i)(?:^|[/_-])drive[_-]?([A-Za-z0-9_-]{10,})(?:\.pdf)?$", str(value))
            if match:
                drive_id = match.group(1)
        if drive_id:
            dkey = f"drive:{drive_id}"
            if source not in self.object_keys[dkey]:
                self.object_keys[dkey].append(source)

    def add_sha(self, sha: str, source: str) -> None:
        if sha and source not in self.shas[sha]:
            self.shas[sha].append(source)

    def match_url_or_object(self, url: str) -> Tuple[bool, str]:
        norm = normalize_url(url)
        if norm and norm in self.normalized_urls:
            return True, "url:" + ",".join(self.normalized_urls[norm][:5])
        reasons: List[str] = []
        for key in object_keys_for_url(url):
            if key in self.object_keys:
                reasons.append(f"{key}=>{','.join(self.object_keys[key][:3])}")
        if reasons:
            return True, "; ".join(reasons[:4])
        return False, ""

    def match_sha(self, sha: str) -> Tuple[bool, str]:
        if sha and sha in self.shas:
            return True, ",".join(self.shas[sha][:5])
        return False, ""


def iter_strings_in_json(value: Any) -> Iterator[str]:
    yield from json_walk_strings(value)


def load_json_file(path: Path) -> Optional[Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"⚠️  Could not parse JSON {path}: {exc}")
        return None


def build_existing_index(output_dir: Path, scan_existing_sha: bool = False) -> ExistingIndex:
    idx = ExistingIndex()

    runtime_files = [
        REPO_ROOT / "data" / "app" / "pdf-r2-map.json",
        REPO_ROOT / "data" / "app" / "pdf-map.json",
        REPO_ROOT / "data" / "app" / "answer-sources.json",
        REPO_ROOT / "data" / "pdf-runtime" / "pdf-r2-map.json",
        REPO_ROOT / "data" / "pdf-runtime" / "answer-sources.json",
        REPO_ROOT / "public" / "data" / "pdf-r2-map.json",
        REPO_ROOT / "public" / "data" / "pdf-map.json",
    ]
    json_strings = 0
    for path in runtime_files:
        if not path.exists():
            continue
        data = load_json_file(path)
        if data is None:
            continue
        source_label = f"repo-json:{path.relative_to(REPO_ROOT)}"
        if isinstance(data, Mapping):
            for key in data.keys():
                if isinstance(key, str):
                    idx.add_object_name(key, source_label)
            # Special answer-sources shape: {"sources": {id: {"url": ...}}}
            if isinstance(data.get("sources"), Mapping):
                for key, val in data["sources"].items():
                    if isinstance(key, str):
                        idx.add_object_name(key, source_label)
                    if isinstance(val, Mapping) and isinstance(val.get("url"), str):
                        idx.add_url(val["url"], source_label)
        for value in iter_strings_in_json(data):
            json_strings += 1
            if "://" in value or "drive.google.com" in value:
                idx.add_url(value, source_label)
            if ".pdf" in value.lower() or "drive.google.com" in value.lower():
                idx.add_object_name(value, source_label)
    idx.counts["repo_json_strings_scanned"] = json_strings

    local_pdf_count = 0
    for pdf_dir in [ACER_PROJECT_ROOT / "local-pdfs", REPO_ROOT / "local-pdfs", output_dir / DOWNLOAD_DIR_NAME]:
        if not pdf_dir.exists():
            continue
        for path in pdf_dir.rglob("*.pdf"):
            local_pdf_count += 1
            label = f"local-pdf:{path}"
            idx.add_object_name(path.name, label)
            if scan_existing_sha:
                try:
                    idx.add_sha(sha256_file(path), label)
                except Exception as exc:
                    log(f"⚠️  Could not hash existing PDF {path}: {exc}")
    idx.counts["local_pdfs_scanned"] = local_pdf_count
    idx.counts["normalized_urls"] = len(idx.normalized_urls)
    idx.counts["object_keys"] = len(idx.object_keys)
    idx.counts["sha256"] = len(idx.shas)
    return idx


def init_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=60, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=60000")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          mode TEXT,
          args_json TEXT,
          summary_json TEXT
        );

        CREATE TABLE IF NOT EXISTS pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL,
          depth INTEGER,
          parent_url TEXT,
          status_code INTEGER,
          content_type TEXT,
          bytes INTEGER,
          sha256 TEXT,
          cache_path TEXT,
          fetched_at TEXT,
          from_cache INTEGER DEFAULT 0,
          error TEXT,
          UNIQUE(source, normalized_url)
        );

        CREATE TABLE IF NOT EXISTS candidates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          source TEXT NOT NULL,
          sources_json TEXT,
          url TEXT NOT NULL,
          normalized_url TEXT NOT NULL UNIQUE,
          object_key TEXT,
          all_object_keys_json TEXT,
          filename_hint TEXT,
          title TEXT,
          context TEXT,
          extraction_method TEXT,
          discovered_on_page TEXT,
          source_pages_json TEXT,
          duplicate_of TEXT,
          dedupe_status TEXT,
          existing_repo_match INTEGER DEFAULT 0,
          existing_repo_reason TEXT,
          downloaded_path TEXT,
          download_status TEXT,
          sha256 TEXT,
          bytes INTEGER,
          page_count INTEGER,
          metadata_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source);
        CREATE INDEX IF NOT EXISTS idx_candidates_object_key ON candidates(object_key);
        CREATE INDEX IF NOT EXISTS idx_candidates_sha ON candidates(sha256);
        CREATE INDEX IF NOT EXISTS idx_candidates_download_status ON candidates(download_status);

        CREATE TABLE IF NOT EXISTS downloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          candidate_url TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          path TEXT,
          sha256 TEXT,
          bytes INTEGER,
          page_count INTEGER,
          content_type TEXT,
          started_at TEXT,
          finished_at TEXT,
          attempts INTEGER,
          error TEXT,
          metadata_json TEXT
        );
        """
    )
    return conn


def create_run(conn: sqlite3.Connection, mode: str, args: argparse.Namespace) -> int:
    args_dict = vars(args).copy()
    for key, value in list(args_dict.items()):
        if isinstance(value, Path):
            args_dict[key] = str(value)
    cur = conn.execute(
        "INSERT INTO runs(started_at, mode, args_json) VALUES (?, ?, ?)",
        (utc_now(), mode, json.dumps(args_dict, ensure_ascii=False, sort_keys=True, default=str)),
    )
    conn.commit()
    return int(cur.lastrowid)


def finish_run(conn: sqlite3.Connection, run_id: int, summary: Mapping[str, Any]) -> None:
    conn.execute(
        "UPDATE runs SET finished_at = ?, summary_json = ? WHERE id = ?",
        (utc_now(), json.dumps(summary, ensure_ascii=False, sort_keys=True, default=str), run_id),
    )
    conn.commit()


def upsert_page(
    conn: sqlite3.Connection,
    *,
    source: str,
    url: str,
    depth: int,
    parent_url: Optional[str],
    status_code: Optional[int],
    content_type: str = "",
    byte_count: Optional[int] = None,
    sha256: str = "",
    cache_path: str = "",
    fetched_at: str = "",
    from_cache: bool = False,
    error: str = "",
) -> None:
    norm = normalize_url(url) or url
    conn.execute(
        """
        INSERT INTO pages(source, url, normalized_url, depth, parent_url, status_code, content_type, bytes,
                          sha256, cache_path, fetched_at, from_cache, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, normalized_url) DO UPDATE SET
          url=excluded.url,
          depth=excluded.depth,
          parent_url=excluded.parent_url,
          status_code=excluded.status_code,
          content_type=excluded.content_type,
          bytes=excluded.bytes,
          sha256=excluded.sha256,
          cache_path=excluded.cache_path,
          fetched_at=excluded.fetched_at,
          from_cache=excluded.from_cache,
          error=excluded.error
        """,
        (
            source,
            url,
            norm,
            depth,
            parent_url,
            status_code,
            content_type,
            byte_count,
            sha256,
            cache_path,
            fetched_at,
            1 if from_cache else 0,
            error,
        ),
    )


@dataclass
class Candidate:
    source: str
    url: str
    normalized_url: str
    object_key: str
    all_object_keys: List[str]
    filename_hint: str
    title: str
    context: str
    extraction_method: str
    discovered_on_page: str
    duplicate_of: str = ""
    dedupe_status: str = "new"
    existing_repo_match: bool = False
    existing_repo_reason: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


def upsert_candidate(conn: sqlite3.Connection, cand: Candidate) -> None:
    now = utc_now()
    row = conn.execute(
        "SELECT * FROM candidates WHERE normalized_url = ?",
        (cand.normalized_url,),
    ).fetchone()
    source_page_entry = {
        "source": cand.source,
        "page": cand.discovered_on_page,
        "method": cand.extraction_method,
        "seen_at": now,
    }
    if row:
        sources_json = merge_json_lists(row["sources_json"], [cand.source])
        pages_json = merge_json_lists(row["source_pages_json"], [source_page_entry])
        all_keys_json = merge_json_lists(row["all_object_keys_json"], cand.all_object_keys)
        conn.execute(
            """
            UPDATE candidates SET
              last_seen_at = ?,
              sources_json = ?,
              all_object_keys_json = ?,
              filename_hint = COALESCE(NULLIF(filename_hint, ''), ?),
              title = COALESCE(NULLIF(title, ''), ?),
              context = COALESCE(NULLIF(context, ''), ?),
              extraction_method = CASE
                WHEN extraction_method IS NULL OR extraction_method = '' THEN ?
                WHEN instr(extraction_method, ?) = 0 THEN extraction_method || ',' || ?
                ELSE extraction_method
              END,
              discovered_on_page = COALESCE(NULLIF(discovered_on_page, ''), ?),
              source_pages_json = ?,
              duplicate_of = COALESCE(NULLIF(duplicate_of, ''), ?),
              dedupe_status = CASE
                WHEN dedupe_status IS NULL OR dedupe_status = 'new' THEN ?
                ELSE dedupe_status
              END,
              existing_repo_match = MAX(existing_repo_match, ?),
              existing_repo_reason = COALESCE(NULLIF(existing_repo_reason, ''), ?),
              metadata_json = ?
            WHERE normalized_url = ?
            """,
            (
                now,
                sources_json,
                all_keys_json,
                cand.filename_hint,
                cand.title,
                cand.context,
                cand.extraction_method,
                cand.extraction_method,
                cand.extraction_method,
                cand.discovered_on_page,
                pages_json,
                cand.duplicate_of,
                cand.dedupe_status,
                1 if cand.existing_repo_match else 0,
                cand.existing_repo_reason,
                json.dumps(cand.metadata, ensure_ascii=False, sort_keys=True),
                cand.normalized_url,
            ),
        )
        return
    conn.execute(
        """
        INSERT INTO candidates(
          first_seen_at, last_seen_at, source, sources_json, url, normalized_url, object_key,
          all_object_keys_json, filename_hint, title, context, extraction_method,
          discovered_on_page, source_pages_json, duplicate_of, dedupe_status,
          existing_repo_match, existing_repo_reason, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            now,
            now,
            cand.source,
            json.dumps([cand.source], ensure_ascii=False),
            cand.url,
            cand.normalized_url,
            cand.object_key,
            json.dumps(cand.all_object_keys, ensure_ascii=False),
            cand.filename_hint,
            cand.title,
            cand.context,
            cand.extraction_method,
            cand.discovered_on_page,
            json.dumps([source_page_entry], ensure_ascii=False),
            cand.duplicate_of,
            cand.dedupe_status,
            1 if cand.existing_repo_match else 0,
            cand.existing_repo_reason,
            json.dumps(cand.metadata, ensure_ascii=False, sort_keys=True),
        ),
    )


def update_candidate_download(
    conn: sqlite3.Connection,
    normalized_url: str,
    *,
    status: str,
    path: str = "",
    sha256: str = "",
    bytes_count: Optional[int] = None,
    page_count: Optional[int] = None,
) -> None:
    conn.execute(
        """
        UPDATE candidates SET
          download_status = ?,
          downloaded_path = COALESCE(NULLIF(?, ''), downloaded_path),
          sha256 = COALESCE(NULLIF(?, ''), sha256),
          bytes = COALESCE(?, bytes),
          page_count = COALESCE(?, page_count)
        WHERE normalized_url = ?
        """,
        (status, path, sha256, bytes_count, page_count, normalized_url),
    )


def upsert_download(
    conn: sqlite3.Connection,
    *,
    candidate_url: str,
    status: str,
    path: str = "",
    sha256: str = "",
    bytes_count: Optional[int] = None,
    page_count: Optional[int] = None,
    content_type: str = "",
    started_at: str = "",
    finished_at: str = "",
    attempts: int = 0,
    error: str = "",
    metadata: Optional[Mapping[str, Any]] = None,
) -> None:
    conn.execute(
        """
        INSERT INTO downloads(candidate_url, status, path, sha256, bytes, page_count, content_type,
                              started_at, finished_at, attempts, error, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(candidate_url) DO UPDATE SET
          status=excluded.status,
          path=excluded.path,
          sha256=excluded.sha256,
          bytes=excluded.bytes,
          page_count=excluded.page_count,
          content_type=excluded.content_type,
          started_at=COALESCE(NULLIF(excluded.started_at, ''), downloads.started_at),
          finished_at=excluded.finished_at,
          attempts=excluded.attempts,
          error=excluded.error,
          metadata_json=excluded.metadata_json
        """,
        (
            candidate_url,
            status,
            path,
            sha256,
            bytes_count,
            page_count,
            content_type,
            started_at,
            finished_at,
            attempts,
            error,
            json.dumps(metadata or {}, ensure_ascii=False, sort_keys=True),
        ),
    )


@dataclass
class FetchResult:
    url: str
    final_url: str
    status_code: int
    headers: Dict[str, str]
    content: bytes
    from_cache: bool = False
    cache_path: str = ""
    fetched_at: str = ""
    error: str = ""


class HostRateLimiter:
    def __init__(self, delay_seconds: float) -> None:
        self.delay_seconds = max(0.0, delay_seconds)
        self._last: Dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, url: str) -> None:
        if self.delay_seconds <= 0:
            return
        host = url_host(url)
        if not host:
            return
        with self._lock:
            now = time.time()
            wait_for = self.delay_seconds - (now - self._last.get(host, 0.0))
            if wait_for > 0:
                time.sleep(wait_for)
            self._last[host] = time.time()


class RobotsCache:
    def __init__(self, user_agent: str, timeout: float, enabled: bool) -> None:
        self.user_agent = user_agent
        self.timeout = timeout
        self.enabled = enabled
        self._cache: Dict[str, urllib.robotparser.RobotFileParser] = {}
        self._lock = threading.Lock()

    def can_fetch(self, url: str) -> bool:
        if not self.enabled:
            return True
        try:
            split = urllib.parse.urlsplit(url)
            base = f"{split.scheme}://{split.netloc}"
        except Exception:
            return False
        with self._lock:
            parser = self._cache.get(base)
            if parser is None:
                parser = urllib.robotparser.RobotFileParser()
                parser.set_url(urllib.parse.urljoin(base, "/robots.txt"))
                try:
                    # Use an explicit timeout instead of RobotFileParser.read(), which
                    # does not expose one. Robots failures are treated as permissive so
                    # transient robots.txt/network issues do not halt a bounded run.
                    req = urllib.request.Request(
                        parser.url,
                        headers={"User-Agent": self.user_agent},
                    )
                    with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                        raw = resp.read(512 * 1024)
                    parser.parse(raw.decode("utf-8", errors="replace").splitlines())
                except Exception:
                    return True
                self._cache[base] = parser
        try:
            return parser.can_fetch(self.user_agent, url)
        except Exception:
            return True


class HTTPClient:
    def __init__(
        self,
        *,
        user_agent: str,
        timeout: float,
        retries: int,
        retry_backoff: float,
        rate_limiter: HostRateLimiter,
    ) -> None:
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = max(0, retries)
        self.retry_backoff = max(0.0, retry_backoff)
        self.rate_limiter = rate_limiter
        self._local = threading.local()

    def _headers(self, extra: Optional[Mapping[str, str]] = None) -> Dict[str, str]:
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml,application/pdf;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        if extra:
            headers.update(extra)
        return headers

    def _session(self) -> Any:
        if requests is None:
            return None
        sess = getattr(self._local, "session", None)
        if sess is None:
            sess = requests.Session()
            sess.headers.update(self._headers())
            self._local.session = sess
        return sess

    def fetch_bytes(self, url: str, *, max_bytes: int, accept_pdf: bool = False) -> FetchResult:
        last_error = ""
        for attempt in range(self.retries + 1):
            try:
                self.rate_limiter.wait(url)
                if requests is not None:
                    result = self._fetch_bytes_requests(url, max_bytes=max_bytes, accept_pdf=accept_pdf)
                else:
                    result = self._fetch_bytes_urllib(url, max_bytes=max_bytes)
                if result.status_code not in RETRY_STATUSES:
                    return result
                last_error = f"HTTP {result.status_code}"
            except Exception as exc:
                last_error = str(exc)
            if attempt < self.retries:
                sleep_for = self.retry_backoff * (2**attempt) + random.random() * 0.25
                time.sleep(sleep_for)
        return FetchResult(
            url=url,
            final_url=url,
            status_code=0,
            headers={},
            content=b"",
            error=last_error or "fetch failed",
            fetched_at=utc_now(),
        )

    def post_form(self, url: str, *, form: Mapping[str, str], max_bytes: int) -> FetchResult:
        last_error = ""
        encoded = urllib.parse.urlencode(form).encode("utf-8")
        for attempt in range(self.retries + 1):
            try:
                self.rate_limiter.wait(url)
                headers = self._headers({
                    "Accept": "application/json,text/plain,*/*",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "X-Requested-With": "XMLHttpRequest",
                })
                if requests is not None:
                    sess = self._session()
                    resp = sess.post(url, headers=headers, data=form, timeout=self.timeout, allow_redirects=True, stream=True)
                    content = bytearray()
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        content.extend(chunk)
                        if len(content) > max_bytes:
                            raise RuntimeError(f"response exceeded max bytes cap ({max_bytes})")
                    result = FetchResult(
                        url=url,
                        final_url=resp.url,
                        status_code=int(resp.status_code),
                        headers={k.lower(): v for k, v in resp.headers.items()},
                        content=bytes(content),
                        fetched_at=utc_now(),
                    )
                else:
                    req = urllib.request.Request(url, data=encoded, headers=headers, method="POST")
                    with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                        content = bytearray()
                        while True:
                            chunk = resp.read(64 * 1024)
                            if not chunk:
                                break
                            content.extend(chunk)
                            if len(content) > max_bytes:
                                raise RuntimeError(f"response exceeded max bytes cap ({max_bytes})")
                        result = FetchResult(
                            url=url,
                            final_url=resp.geturl(),
                            status_code=int(getattr(resp, "status", 200)),
                            headers={k.lower(): v for k, v in resp.headers.items()},
                            content=bytes(content),
                            fetched_at=utc_now(),
                        )
                if result.status_code not in RETRY_STATUSES:
                    return result
                last_error = f"HTTP {result.status_code}"
            except Exception as exc:
                last_error = str(exc)
            if attempt < self.retries:
                time.sleep(self.retry_backoff * (2**attempt) + random.random() * 0.25)
        return FetchResult(url=url, final_url=url, status_code=0, headers={}, content=b"", error=last_error or "post failed", fetched_at=utc_now())

    def _fetch_bytes_requests(self, url: str, *, max_bytes: int, accept_pdf: bool = False) -> FetchResult:
        sess = self._session()
        headers = self._headers({"Accept": "application/pdf,*/*"} if accept_pdf else None)
        resp = sess.get(url, headers=headers, timeout=self.timeout, allow_redirects=True, stream=True)
        content = bytearray()
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            content.extend(chunk)
            if len(content) > max_bytes:
                raise RuntimeError(f"response exceeded max bytes cap ({max_bytes})")
        return FetchResult(
            url=url,
            final_url=resp.url,
            status_code=int(resp.status_code),
            headers={k.lower(): v for k, v in resp.headers.items()},
            content=bytes(content),
            fetched_at=utc_now(),
        )

    def _fetch_bytes_urllib(self, url: str, *, max_bytes: int) -> FetchResult:
        req = urllib.request.Request(url, headers=self._headers())
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            content = bytearray()
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                content.extend(chunk)
                if len(content) > max_bytes:
                    raise RuntimeError(f"response exceeded max bytes cap ({max_bytes})")
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return FetchResult(
                url=url,
                final_url=resp.geturl(),
                status_code=int(getattr(resp, "status", 200)),
                headers=headers,
                content=bytes(content),
                fetched_at=utc_now(),
            )


class PageCache:
    def __init__(self, output_dir: Path, ttl_hours: float, refresh: bool) -> None:
        self.root = output_dir / SOURCE_DIR_NAME / SOURCE_PAGES_DIR_NAME
        self.ttl_seconds = ttl_hours * 3600 if ttl_hours > 0 else 0
        self.refresh = refresh

    def _paths(self, source: str, normalized_url: str) -> Tuple[Path, Path]:
        digest = hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()
        dir_path = self.root / source / digest[:2]
        return dir_path / f"{digest}.html", dir_path / f"{digest}.json"

    def get(self, source: str, normalized_url: str) -> Optional[FetchResult]:
        if self.refresh:
            return None
        html_path, meta_path = self._paths(source, normalized_url)
        if not html_path.exists() or not meta_path.exists():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            fetched_at = meta.get("fetched_at") or ""
            if self.ttl_seconds > 0 and fetched_at:
                parsed = parse_utc(fetched_at)
                age = (_dt.datetime.now(_dt.UTC) - parsed).total_seconds()
                if age > self.ttl_seconds:
                    return None
            content = html_path.read_bytes()
            return FetchResult(
                url=meta.get("url") or normalized_url,
                final_url=meta.get("final_url") or normalized_url,
                status_code=int(meta.get("status_code") or 0),
                headers=dict(meta.get("headers") or {}),
                content=content,
                from_cache=True,
                cache_path=str(html_path),
                fetched_at=fetched_at,
            )
        except Exception:
            return None

    def put(self, source: str, normalized_url: str, result: FetchResult) -> FetchResult:
        html_path, meta_path = self._paths(source, normalized_url)
        html_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_html = html_path.with_name(f".{html_path.name}.{uuid.uuid4().hex}.tmp")
        tmp_html.write_bytes(result.content)
        os.replace(tmp_html, html_path)
        meta = {
            "url": result.url,
            "normalized_url": normalized_url,
            "final_url": result.final_url,
            "status_code": result.status_code,
            "headers": result.headers,
            "bytes": len(result.content),
            "sha256": sha256_bytes(result.content),
            "fetched_at": result.fetched_at or utc_now(),
        }
        atomic_write_json(meta_path, meta)
        result.cache_path = str(html_path)
        return result


def should_enqueue_link(
    ref: ExtractedRef,
    *,
    source: str,
    config: Mapping[str, Any],
    broad_crawl: bool,
) -> bool:
    url = normalize_url(ref.url)
    if not url or not is_htmlish_crawl_url(url):
        return False
    if not allowed_by_domains(url, config.get("allowed_domains") or []):
        return False
    if broad_crawl or source == "generic":
        return True
    haystack = " ".join(
        [
            urllib.parse.unquote(urllib.parse.urlsplit(url).path),
            urllib.parse.unquote(urllib.parse.urlsplit(url).query),
            ref.text,
            ref.title,
            ref.context,
        ]
    )
    keywords = config.get("keywords") or []
    if any(re.search(rf"(?i)\b{re.escape(str(keyword))}\b", haystack) for keyword in keywords):
        return True
    return bool(SOURCE_LINK_KEYWORD_RE.search(haystack))


def cacheable_content_type(headers: Mapping[str, str]) -> bool:
    ctype = (headers.get("content-type") or "").split(";")[0].strip().lower()
    if not ctype:
        return True
    return ctype in HTMLISH_CONTENT_TYPES or ctype.endswith("+json")


def record_candidate_ref(
    *,
    conn: sqlite3.Connection,
    source: str,
    config: Mapping[str, Any],
    ref: ExtractedRef,
    source_page: str,
    existing_index: ExistingIndex,
    global_seen_objects: Dict[str, str],
    source_candidates_seen: Set[str],
    stats: Dict[str, Any],
    max_urls: int,
    remaining_limit: Optional[int],
    extra_metadata: Optional[Mapping[str, Any]] = None,
) -> bool:
    """Normalize/dedupe/upsert one discovered PDF reference."""
    if len(source_candidates_seen) >= max_urls:
        return False
    if remaining_limit is not None and int(stats.get("new_candidates", 0)) >= remaining_limit:
        return False
    norm_pdf = normalize_url(ref.url, source_page)
    if not norm_pdf or norm_pdf in source_candidates_seen:
        return False
    source_candidates_seen.add(norm_pdf)
    all_keys = object_keys_for_url(norm_pdf)
    obj_key = all_keys[0] if all_keys else primary_object_key(norm_pdf)

    duplicate_of = ""
    dedupe_status = "new"
    for key in [norm_pdf] + all_keys:
        owner = global_seen_objects.get(key)
        if owner and owner != norm_pdf:
            duplicate_of = owner
            dedupe_status = "duplicate_object_key" if key != norm_pdf else "duplicate_url"
            break
    if not duplicate_of:
        global_seen_objects[norm_pdf] = norm_pdf
        for key in all_keys:
            global_seen_objects[key] = norm_pdf
    else:
        stats["duplicates"] = int(stats.get("duplicates", 0)) + 1

    existing_match, existing_reason = existing_index.match_url_or_object(norm_pdf)
    if existing_match:
        stats["existing_repo_matches"] = int(stats.get("existing_repo_matches", 0)) + 1
        if dedupe_status == "new":
            dedupe_status = "existing_repo"

    metadata = {
        "requests_available": requests is not None,
        "bs4_available": BeautifulSoup is not None,
        "source_label": config.get("label", source),
        "source_site": source,
    }
    if extra_metadata:
        metadata.update(dict(extra_metadata))

    cand = Candidate(
        source=source,
        url=ref.url,
        normalized_url=norm_pdf,
        object_key=obj_key,
        all_object_keys=all_keys,
        filename_hint=filename_hint_for_candidate(norm_pdf, ref, source),
        title=make_context(ref.title or ref.text, 250),
        context=make_context(ref.context or ref.text, 800),
        extraction_method=ref.method,
        discovered_on_page=source_page,
        duplicate_of=duplicate_of,
        dedupe_status=dedupe_status,
        existing_repo_match=existing_match,
        existing_repo_reason=existing_reason,
        metadata=metadata,
    )
    upsert_candidate(conn, cand)
    conn.commit()
    stats["pdf_candidates"] = int(stats.get("pdf_candidates", 0)) + 1
    if dedupe_status == "new":
        stats["new_candidates"] = int(stats.get("new_candidates", 0)) + 1
    return True


def discover_visionias_api(
    *,
    conn: sqlite3.Connection,
    source: str,
    config: Mapping[str, Any],
    args: argparse.Namespace,
    http: HTTPClient,
    existing_index: ExistingIndex,
    global_seen_objects: Dict[str, str],
    source_candidates_seen: Set[str],
    stats: Dict[str, Any],
    max_urls: int,
    remaining_limit: Optional[int],
) -> None:
    api_url = "https://www.visionias.in/student/module/ajax/resources.php?f=resources_data"
    result = http.post_form(api_url, form={"category": "tac"}, max_bytes=max(args.max_page_bytes, 2_500_000))
    upsert_page(conn, source=source, url=api_url, depth=0, parent_url="https://visionias.in/resources/toppers-answer-copy/", status_code=result.status_code, content_type=result.headers.get("content-type", ""), byte_count=len(result.content), sha256=sha256_bytes(result.content) if result.content else "", cache_path="", fetched_at=result.fetched_at, from_cache=False, error=result.error)
    conn.commit()
    stats["pages_seen"] = int(stats.get("pages_seen", 0)) + 1
    stats["pages_fetched"] = int(stats.get("pages_fetched", 0)) + 1
    if result.error or result.status_code >= 400:
        stats["errors"] = int(stats.get("errors", 0)) + 1
        stats.setdefault("blocked", []).append({"source": source, "url": api_url, "reason": result.error or f"HTTP {result.status_code}"})
        return
    data = safe_json_loads(result.content.decode("utf-8", errors="replace"))
    rows = data.get("result") if isinstance(data, Mapping) else None
    if not isinstance(rows, list):
        stats["errors"] = int(stats.get("errors", 0)) + 1
        stats.setdefault("blocked", []).append({"source": source, "url": api_url, "reason": "public JSON endpoint did not return result[]"})
        return
    stats["api_records"] = len(rows)
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        loc = safe_str(row.get("location"))
        if not loc:
            continue
        rank = safe_str(row.get("rank"))
        ref = ExtractedRef(url=loc, method="visionias:resources_data", text=safe_str(row.get("name")), title=safe_str(row.get("name")), context=" | ".join(filter(None, [safe_str(row.get("subject_name")), safe_str(row.get("year")), f"rank {rank}" if rank else ""])))
        ok = record_candidate_ref(conn=conn, source=source, config=config, ref=ref, source_page=api_url, existing_index=existing_index, global_seen_objects=global_seen_objects, source_candidates_seen=source_candidates_seen, stats=stats, max_urls=max_urls, remaining_limit=remaining_limit, extra_metadata={"adapter": "visionias_public_resources_data", "resource_id": row.get("resource_id"), "resource_type": row.get("resource_type"), "topper_name": row.get("name"), "rank": row.get("rank"), "year": row.get("year"), "subject": row.get("subject_name"), "medium": row.get("medium")})
        if not ok and len(source_candidates_seen) >= max_urls:
            break


def discover_shubhra_bundle_pdfs(
    *,
    conn: sqlite3.Connection,
    source: str,
    config: Mapping[str, Any],
    args: argparse.Namespace,
    http: HTTPClient,
    existing_index: ExistingIndex,
    global_seen_objects: Dict[str, str],
    source_candidates_seen: Set[str],
    stats: Dict[str, Any],
    max_urls: int,
    remaining_limit: Optional[int],
) -> None:
    page_url = "https://www.shubhraranjan.com/toppers-copies"
    page = http.fetch_bytes(page_url, max_bytes=args.max_page_bytes, accept_pdf=False)
    upsert_page(conn, source=source, url=page_url, depth=0, parent_url=None, status_code=page.status_code, content_type=page.headers.get("content-type", ""), byte_count=len(page.content), sha256=sha256_bytes(page.content) if page.content else "", cache_path="", fetched_at=page.fetched_at, from_cache=False, error=page.error)
    conn.commit()
    stats["pages_seen"] = int(stats.get("pages_seen", 0)) + 1
    stats["pages_fetched"] = int(stats.get("pages_fetched", 0)) + 1
    if page.error or page.status_code >= 400:
        stats["errors"] = int(stats.get("errors", 0)) + 1
        stats.setdefault("blocked", []).append({"source": source, "url": page_url, "reason": page.error or f"HTTP {page.status_code}"})
        return
    html_text = page.content.decode("utf-8", errors="replace")
    script_urls = []
    for raw in re.findall(r"(?i)(?:src|href)=[\"']([^\"']*static/js/[^\"']+\.js)[\"']", html_text):
        norm = normalize_url(raw, page.final_url or page_url)
        if norm and norm not in script_urls:
            script_urls.append(norm)
    stats["script_candidates"] = len(script_urls)
    for js_url in script_urls:
        js = http.fetch_bytes(js_url, max_bytes=max(args.max_page_bytes, 6_000_000), accept_pdf=False)
        upsert_page(conn, source=source, url=js_url, depth=1, parent_url=page_url, status_code=js.status_code, content_type=js.headers.get("content-type", ""), byte_count=len(js.content), sha256=sha256_bytes(js.content) if js.content else "", cache_path="", fetched_at=js.fetched_at, from_cache=False, error=js.error)
        conn.commit()
        stats["pages_seen"] = int(stats.get("pages_seen", 0)) + 1
        stats["pages_fetched"] = int(stats.get("pages_fetched", 0)) + 1
        if js.error or js.status_code >= 400 or not js.content:
            continue
        js_text = js.content.decode("utf-8", errors="replace")
        pdf_urls = set(extract_urls_from_text(js_text, js.final_url or js_url))
        # The Shubhra bundle contains many literal PDF URLs with spaces and
        # commas in filenames. The generic URL regex deliberately stops at
        # whitespace for safety, so use a quoted-string capture here.
        for raw in re.findall(r"https?://admin\.shubhraviraj\.in/storedata/ToppersCopyPDF[^\"']+?\.pdf", html_unescape_deep(js_text)):
            norm = normalize_url(raw, js.final_url or js_url)
            if norm:
                pdf_urls.add(norm)
        for pdf_url in sorted(pdf_urls):
            if "ToppersCopyPDF" not in urllib.parse.unquote(pdf_url):
                continue
            ref = ExtractedRef(url=pdf_url, method="shubhraranjan:bundle", title=Path(urllib.parse.unquote(urllib.parse.urlsplit(pdf_url).path)).stem, context="React bundle hard-coded topper-copy PDF")
            ok = record_candidate_ref(conn=conn, source=source, config=config, ref=ref, source_page=js.final_url or js_url, existing_index=existing_index, global_seen_objects=global_seen_objects, source_candidates_seen=source_candidates_seen, stats=stats, max_urls=max_urls, remaining_limit=remaining_limit, extra_metadata={"adapter": "shubhraranjan_react_bundle"})
            if not ok and len(source_candidates_seen) >= max_urls:
                break

def discover_source(
    *,
    source: str,
    config: Mapping[str, Any],
    seeds: Sequence[str],
    args: argparse.Namespace,
    conn: sqlite3.Connection,
    http: HTTPClient,
    page_cache: PageCache,
    robots: RobotsCache,
    existing_index: ExistingIndex,
    global_seen_objects: Dict[str, str],
) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        "source": source,
        "seeds": list(seeds),
        "pages_seen": 0,
        "pages_fetched": 0,
        "pages_from_cache": 0,
        "pages_skipped": 0,
        "pdf_candidates": 0,
        "new_candidates": 0,
        "duplicates": 0,
        "existing_repo_matches": 0,
        "errors": 0,
    }
    if not seeds:
        log(f"⚠️  Source {source} has no seeds; skipping discovery.")
        return stats

    max_pages = max(0, args.max_pages)
    max_depth = max(0, args.max_depth)
    max_urls = max(1, args.max_urls)
    remaining_limit = args.limit if args.limit and args.limit > 0 else None

    q: deque[Tuple[str, int, Optional[str]]] = deque()
    seen_pages: Set[str] = set()
    for seed in seeds:
        norm = normalize_url(seed)
        if not norm:
            log(f"⚠️  Ignoring invalid seed for {source}: {seed}")
            continue
        q.append((norm, 0, None))

    source_candidates_seen: Set[str] = set()
    conn_lock = threading.Lock()

    # High-yield dynamic/public adapters: use public JSON or static JS bundles
    # only; never submit login/captcha/account forms.
    if source == "visionias":
        try:
            discover_visionias_api(conn=conn, source=source, config=config, args=args, http=http, existing_index=existing_index, global_seen_objects=global_seen_objects, source_candidates_seen=source_candidates_seen, stats=stats, max_urls=max_urls, remaining_limit=remaining_limit)
        except Exception as exc:
            stats["errors"] += 1
            stats.setdefault("blocked", []).append({"source": source, "url": "resources_data", "reason": str(exc)})
            if args.verbose:
                traceback.print_exc()
        if len(source_candidates_seen) >= max_urls or (remaining_limit is not None and stats["new_candidates"] >= remaining_limit):
            return stats

    if source == "shubhraranjan":
        try:
            discover_shubhra_bundle_pdfs(conn=conn, source=source, config=config, args=args, http=http, existing_index=existing_index, global_seen_objects=global_seen_objects, source_candidates_seen=source_candidates_seen, stats=stats, max_urls=max_urls, remaining_limit=remaining_limit)
        except Exception as exc:
            stats["errors"] += 1
            stats.setdefault("blocked", []).append({"source": source, "url": "react_bundle", "reason": str(exc)})
            if args.verbose:
                traceback.print_exc()
        if len(source_candidates_seen) >= max_urls or (remaining_limit is not None and stats["new_candidates"] >= remaining_limit):
            return stats

    def fetch_one(item: Tuple[str, int, Optional[str]]) -> Tuple[Tuple[str, int, Optional[str]], FetchResult]:
        url, depth, parent = item
        norm = normalize_url(url) or url
        cached = page_cache.get(source, norm)
        if cached is not None:
            return item, cached
        if not robots.can_fetch(norm):
            return item, FetchResult(
                url=url,
                final_url=url,
                status_code=0,
                headers={},
                content=b"",
                fetched_at=utc_now(),
                error="blocked_by_robots",
            )
        result = http.fetch_bytes(norm, max_bytes=args.max_page_bytes, accept_pdf=False)
        if result.content and cacheable_content_type(result.headers):
            result = page_cache.put(source, norm, result)
        return item, result

    while q and stats["pages_seen"] < max_pages and len(source_candidates_seen) < max_urls:
        batch: List[Tuple[str, int, Optional[str]]] = []
        while q and len(batch) < args.concurrency and stats["pages_seen"] + len(batch) < max_pages:
            url, depth, parent = q.popleft()
            norm = normalize_url(url) or url
            if norm in seen_pages:
                continue
            seen_pages.add(norm)
            if depth > max_depth:
                stats["pages_skipped"] += 1
                continue
            if not allowed_by_domains(norm, config.get("allowed_domains") or []):
                stats["pages_skipped"] += 1
                continue
            batch.append((norm, depth, parent))
        if not batch:
            continue

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
            futures = [executor.submit(fetch_one, item) for item in batch]
            for future in concurrent.futures.as_completed(futures):
                url = ""
                depth = 0
                parent: Optional[str] = None
                try:
                    (url, depth, parent), result = future.result()
                    stats["pages_seen"] += 1
                    if result.from_cache:
                        stats["pages_from_cache"] += 1
                    else:
                        stats["pages_fetched"] += 1
                    with conn_lock:
                        upsert_page(
                            conn,
                            source=source,
                            url=url,
                            depth=depth,
                            parent_url=parent,
                            status_code=result.status_code,
                            content_type=result.headers.get("content-type", ""),
                            byte_count=len(result.content) if result.content else 0,
                            sha256=sha256_bytes(result.content) if result.content else "",
                            cache_path=result.cache_path,
                            fetched_at=result.fetched_at,
                            from_cache=result.from_cache,
                            error=result.error,
                        )
                        conn.commit()
                    if result.error:
                        stats["errors"] += 1
                        log(f"⚠️  [{source}] fetch skipped/failed {url}: {result.error}")
                        continue
                    if result.status_code >= 400:
                        stats["errors"] += 1
                        log(f"⚠️  [{source}] HTTP {result.status_code}: {url}")
                        continue
                    if not result.content:
                        continue
                    extraction = extract_from_html(result.content, result.final_url or url)

                    for ref in extraction.pdf_refs:
                        if len(source_candidates_seen) >= max_urls:
                            break
                        if remaining_limit is not None and stats["new_candidates"] >= remaining_limit:
                            break
                        norm_pdf = normalize_url(ref.url, result.final_url or url)
                        if not norm_pdf:
                            continue
                        source_candidates_seen.add(norm_pdf)
                        all_keys = object_keys_for_url(norm_pdf)
                        obj_key = all_keys[0] if all_keys else primary_object_key(norm_pdf)

                        duplicate_of = ""
                        dedupe_status = "new"
                        for key in [norm_pdf] + all_keys:
                            owner = global_seen_objects.get(key)
                            if owner and owner != norm_pdf:
                                duplicate_of = owner
                                dedupe_status = "duplicate_object_key" if key != norm_pdf else "duplicate_url"
                                break
                        if not duplicate_of:
                            global_seen_objects[norm_pdf] = norm_pdf
                            for key in all_keys:
                                global_seen_objects[key] = norm_pdf
                        else:
                            stats["duplicates"] += 1

                        existing_match, existing_reason = existing_index.match_url_or_object(norm_pdf)
                        if existing_match:
                            stats["existing_repo_matches"] += 1
                            if dedupe_status == "new":
                                dedupe_status = "existing_repo"

                        cand = Candidate(
                            source=source,
                            url=ref.url,
                            normalized_url=norm_pdf,
                            object_key=obj_key,
                            all_object_keys=all_keys,
                            filename_hint=filename_hint_for_candidate(norm_pdf, ref, source),
                            title=make_context(ref.title or ref.text, 250),
                            context=make_context(ref.context or ref.text, 500),
                            extraction_method=ref.method,
                            discovered_on_page=result.final_url or url,
                            duplicate_of=duplicate_of,
                            dedupe_status=dedupe_status,
                            existing_repo_match=existing_match,
                            existing_repo_reason=existing_reason,
                            metadata={
                                "requests_available": requests is not None,
                                "bs4_available": BeautifulSoup is not None,
                                "source_label": config.get("label", source),
                            },
                        )
                        with conn_lock:
                            upsert_candidate(conn, cand)
                            conn.commit()
                        stats["pdf_candidates"] += 1
                        if dedupe_status == "new":
                            stats["new_candidates"] += 1

                    if depth < max_depth and stats["pages_fetched"] < max_pages:
                        for ref in extraction.crawl_links:
                            child = normalize_url(ref.url, result.final_url or url)
                            if not child or child in seen_pages:
                                continue
                            if not should_enqueue_link(
                                dataclasses.replace(ref, url=child),
                                source=source,
                                config=config,
                                broad_crawl=args.broad_crawl,
                            ):
                                continue
                            if len(seen_pages) + len(q) >= max_pages * max(2, args.concurrency):
                                # Frontier cap tied to page cap, avoiding unbounded memory growth.
                                break
                            q.append((child, depth + 1, result.final_url or url))
                except Exception as exc:
                    stats["errors"] += 1
                    log(f"⚠️  [{source}] discovery error on {url or 'unknown URL'}: {exc}")
                    if args.verbose:
                        traceback.print_exc()

    return stats


@dataclass
class PdfValidation:
    ok: bool
    reason: str = ""
    page_count: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


def validate_pdf(path: Path) -> PdfValidation:
    try:
        with path.open("rb") as f:
            head = f.read(4096)
        if b"%PDF-" not in head[:2048]:
            return PdfValidation(False, "missing_pdf_header")
        if fitz is not None:
            try:
                doc = fitz.open(str(path))
                try:
                    page_count = int(getattr(doc, "page_count", len(doc)))
                    metadata = {
                        "needs_pass": bool(getattr(doc, "needs_pass", False)),
                        "is_pdf": bool(getattr(doc, "is_pdf", True)),
                        "fitz_available": True,
                    }
                    if page_count <= 0:
                        return PdfValidation(False, "zero_pages", page_count=page_count, metadata=metadata)
                    return PdfValidation(True, "ok", page_count=page_count, metadata=metadata)
                finally:
                    doc.close()
            except Exception as exc:
                return PdfValidation(False, f"pymupdf_validation_failed:{exc}")
        return PdfValidation(True, "header_only_ok", metadata={"fitz_available": False})
    except Exception as exc:
        return PdfValidation(False, str(exc))


def google_drive_download_url(url: str) -> str:
    drive_id = extract_google_drive_id(url)
    if drive_id:
        return f"https://drive.google.com/uc?export=download&id={drive_id}"
    return url


def parse_drive_confirm_url(html_bytes: bytes, current_url: str) -> Optional[str]:
    text = html_bytes.decode("utf-8", errors="replace")
    # Google may provide a form or a link containing confirm=TOKEN.
    if BeautifulSoup is not None:
        soup = BeautifulSoup(text, "html.parser")
        form = soup.find("form")
        if form is not None and form.get("action"):
            action = normalize_url(str(form.get("action")), current_url)
            if action:
                params: Dict[str, str] = {}
                for inp in form.find_all("input"):
                    name = inp.get("name")
                    value = inp.get("value")
                    if name and value is not None:
                        params[str(name)] = str(value)
                if params:
                    split = urllib.parse.urlsplit(action)
                    existing = dict(urllib.parse.parse_qsl(split.query, keep_blank_values=True))
                    existing.update(params)
                    query = urllib.parse.urlencode(existing)
                    return urllib.parse.urlunsplit((split.scheme, split.netloc, split.path, query, ""))
        for a in soup.find_all("a", href=True):
            href = str(a.get("href"))
            if "confirm=" in href and ("export=download" in href or "uc?" in href):
                return normalize_url(href, current_url)
    match = re.search(r'href="([^"]*?(?:confirm=[^"&]+)[^"]*)"', text)
    if match:
        return normalize_url(match.group(1), current_url)
    return None


def unique_download_path(base_dir: Path, filename_hint: str, url: str) -> Path:
    safe_name = sanitize_filename_part(Path(filename_hint).stem, fallback="topper_copy")
    suffix = hashlib.sha256((normalize_url(url) or url).encode("utf-8")).hexdigest()[:10]
    candidate = base_dir / f"{safe_name}_{suffix}.pdf"
    if len(candidate.name) > 180:
        candidate = base_dir / f"{safe_name[:150]}_{suffix}.pdf"
    counter = 2
    while candidate.exists():
        candidate = base_dir / f"{safe_name}_{suffix}_{counter}.pdf"
        counter += 1
    return candidate


def load_download_sha_index(conn: sqlite3.Connection, output_dir: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for row in conn.execute("SELECT sha256, path FROM downloads WHERE sha256 IS NOT NULL AND sha256 != ''"):
        out[str(row["sha256"])] = str(row["path"] or "downloads-table")
    # Hash already downloaded output PDFs only; this directory is controlled by the script.
    pdf_root = output_dir / DOWNLOAD_DIR_NAME
    if pdf_root.exists():
        for path in pdf_root.rglob("*.pdf"):
            try:
                sha = sha256_file(path)
                out.setdefault(sha, str(path))
            except Exception:
                continue
    return out


def stream_download_to_temp(
    *,
    http: HTTPClient,
    url: str,
    temp_path: Path,
    max_bytes: int,
) -> Tuple[str, int, str, Dict[str, Any]]:
    """Download into temp_path and return (sha256, bytes, content_type, metadata)."""
    # For robust validation we use the same bounded bytes client, then write to a
    # temp file. This keeps max-size enforcement simple and works with urllib fallback.
    # PDF answer copies are usually small; max_bytes is user-configurable.
    actual_url = google_drive_download_url(url)
    result = http.fetch_bytes(actual_url, max_bytes=max_bytes, accept_pdf=True)
    metadata: Dict[str, Any] = {"initial_url": actual_url, "final_url": result.final_url, "status_code": result.status_code}
    content_type = result.headers.get("content-type", "")

    if result.status_code >= 400 or not result.content:
        raise RuntimeError(f"HTTP {result.status_code or '0'} download failure: {result.error}")

    # Google Drive confirmation/virus-scan interstitials are HTML, not PDFs.
    if b"%PDF-" not in result.content[:4096] and "text/html" in content_type.lower() and "drive.google.com" in actual_url:
        confirm_url = parse_drive_confirm_url(result.content, result.final_url or actual_url)
        if confirm_url:
            metadata["drive_confirm_url"] = confirm_url
            result = http.fetch_bytes(confirm_url, max_bytes=max_bytes, accept_pdf=True)
            content_type = result.headers.get("content-type", "")
            metadata["confirm_final_url"] = result.final_url
            metadata["confirm_status_code"] = result.status_code
            if result.status_code >= 400 or not result.content:
                raise RuntimeError(f"HTTP {result.status_code or '0'} Google Drive confirm failure: {result.error}")

    temp_path.parent.mkdir(parents=True, exist_ok=True)
    with temp_path.open("wb") as f:
        f.write(result.content)
        f.flush()
        os.fsync(f.fileno())
    return sha256_bytes(result.content), len(result.content), content_type, metadata


def source_filter_matches(row: sqlite3.Row, selected_sources: Set[str]) -> bool:
    if not selected_sources or "all" in selected_sources:
        return True
    source = str(row["source"] or "")
    if source in selected_sources:
        return True
    for item in coerce_json_array(row["sources_json"]):
        if str(item) in selected_sources:
            return True
    return False


def candidate_rows_for_download(
    conn: sqlite3.Connection,
    *,
    sources: Set[str],
    limit: Optional[int],
    include_existing: bool,
    include_duplicates: bool,
    retry_failed: bool,
) -> List[sqlite3.Row]:
    conditions = []
    if not include_existing:
        conditions.append("(existing_repo_match IS NULL OR existing_repo_match = 0)")
    if not include_duplicates:
        conditions.append("(duplicate_of IS NULL OR duplicate_of = '')")
    if retry_failed:
        conditions.append("(download_status IS NULL OR download_status = '' OR download_status IN ('failed','invalid','duplicate_sha','skipped_existing'))")
    else:
        conditions.append("(download_status IS NULL OR download_status = '')")
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    rows = list(
        conn.execute(
            f"""
            SELECT * FROM candidates
            {where}
            ORDER BY existing_repo_match ASC, first_seen_at ASC, id ASC
            """
        )
    )
    filtered = [row for row in rows if source_filter_matches(row, sources)]
    if limit and limit > 0:
        filtered = filtered[:limit]
    return filtered


def download_candidates(
    *,
    args: argparse.Namespace,
    conn: sqlite3.Connection,
    http: HTTPClient,
    existing_index: ExistingIndex,
    selected_sources: Set[str],
) -> Dict[str, Any]:
    stats: Dict[str, Any] = {
        "selected": 0,
        "downloaded": 0,
        "skipped_existing": 0,
        "duplicate_sha": 0,
        "failed": 0,
        "invalid": 0,
    }
    rows = candidate_rows_for_download(
        conn,
        sources=selected_sources,
        limit=args.limit if args.limit and args.limit > 0 else None,
        include_existing=args.include_existing,
        include_duplicates=args.include_duplicates,
        retry_failed=args.retry_failed,
    )
    stats["selected"] = len(rows)
    if not rows:
        return stats

    sha_index = load_download_sha_index(conn, args.output_dir)
    for sha, sources in existing_index.shas.items():
        if sources:
            sha_index.setdefault(sha, sources[0])

    sha_lock = threading.Lock()
    db_lock = threading.Lock()
    temp_dir = args.output_dir / DOWNLOAD_DIR_NAME / ".tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    def worker(row: sqlite3.Row) -> Dict[str, Any]:
        norm_url = str(row["normalized_url"])
        url = str(row["url"] or norm_url)
        source = str(row["source"] or "unknown")
        started_at = utc_now()
        filename_hint = str(row["filename_hint"] or "topper_copy.pdf")

        if not args.include_existing:
            existing_match, reason = existing_index.match_url_or_object(norm_url)
            if existing_match:
                with db_lock:
                    upsert_download(
                        conn,
                        candidate_url=norm_url,
                        status="skipped_existing",
                        started_at=started_at,
                        finished_at=utc_now(),
                        attempts=0,
                        error=reason,
                    )
                    update_candidate_download(conn, norm_url, status="skipped_existing")
                    conn.commit()
                return {"status": "skipped_existing"}

        source_dir = args.output_dir / DOWNLOAD_DIR_NAME / source
        source_dir.mkdir(parents=True, exist_ok=True)
        temp_path = temp_dir / f"{uuid.uuid4().hex}.part"
        final_path = Path()
        attempts = args.retries + 1
        try:
            sha, byte_count, content_type, metadata = stream_download_to_temp(
                http=http,
                url=norm_url,
                temp_path=temp_path,
                max_bytes=int(args.max_download_mb * 1024 * 1024),
            )

            validation = validate_pdf(temp_path)
            if not validation.ok:
                with contextlib.suppress(Exception):
                    temp_path.unlink()
                with db_lock:
                    upsert_download(
                        conn,
                        candidate_url=norm_url,
                        status="invalid",
                        sha256=sha,
                        bytes_count=byte_count,
                        content_type=content_type,
                        started_at=started_at,
                        finished_at=utc_now(),
                        attempts=attempts,
                        error=validation.reason,
                        metadata={**metadata, "validation": validation.metadata},
                    )
                    update_candidate_download(conn, norm_url, status="invalid", sha256=sha, bytes_count=byte_count)
                    conn.commit()
                return {"status": "invalid", "error": validation.reason}

            with sha_lock:
                existing_sha_path = sha_index.get(sha)
                if existing_sha_path and not args.include_duplicates:
                    duplicate_path = existing_sha_path
                else:
                    duplicate_path = ""
                    final_path = unique_download_path(source_dir, filename_hint, norm_url)
                    os.replace(temp_path, final_path)
                    sha_index[sha] = str(final_path)

            if duplicate_path:
                with contextlib.suppress(Exception):
                    temp_path.unlink()
                with db_lock:
                    upsert_download(
                        conn,
                        candidate_url=norm_url,
                        status="duplicate_sha",
                        path=duplicate_path,
                        sha256=sha,
                        bytes_count=byte_count,
                        page_count=validation.page_count,
                        content_type=content_type,
                        started_at=started_at,
                        finished_at=utc_now(),
                        attempts=attempts,
                        error="sha256 already present",
                        metadata={**metadata, "validation": validation.metadata},
                    )
                    update_candidate_download(
                        conn,
                        norm_url,
                        status="duplicate_sha",
                        path=duplicate_path,
                        sha256=sha,
                        bytes_count=byte_count,
                        page_count=validation.page_count,
                    )
                    conn.commit()
                return {"status": "duplicate_sha"}

            with db_lock:
                upsert_download(
                    conn,
                    candidate_url=norm_url,
                    status="downloaded",
                    path=str(final_path),
                    sha256=sha,
                    bytes_count=byte_count,
                    page_count=validation.page_count,
                    content_type=content_type,
                    started_at=started_at,
                    finished_at=utc_now(),
                    attempts=attempts,
                    metadata={**metadata, "validation": validation.metadata},
                )
                update_candidate_download(
                    conn,
                    norm_url,
                    status="downloaded",
                    path=str(final_path),
                    sha256=sha,
                    bytes_count=byte_count,
                    page_count=validation.page_count,
                )
                conn.commit()
            return {"status": "downloaded", "path": str(final_path)}
        except Exception as exc:
            with contextlib.suppress(Exception):
                temp_path.unlink()
            err = str(exc)
            with db_lock:
                upsert_download(
                    conn,
                    candidate_url=norm_url,
                    status="failed",
                    started_at=started_at,
                    finished_at=utc_now(),
                    attempts=attempts,
                    error=err,
                )
                update_candidate_download(conn, norm_url, status="failed")
                conn.commit()
            if args.verbose:
                traceback.print_exc()
            return {"status": "failed", "error": err}

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        futures = [executor.submit(worker, row) for row in rows]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            status = result.get("status", "failed")
            if status in stats:
                stats[status] += 1
            else:
                stats["failed"] += 1
            if status == "downloaded":
                log(f"✅ Downloaded {result.get('path')}")
            elif status in {"failed", "invalid"}:
                log(f"⚠️  Download {status}: {result.get('error', '')}")

    return stats


def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in row.keys():
        value = row[key]
        if key.endswith("_json") and isinstance(value, str) and value:
            parsed = safe_json_loads(value)
            out[key[:-5]] = parsed if parsed is not None else value
        else:
            out[key] = value
    return out


def write_manifests(conn: sqlite3.Connection, output_dir: Path, summary: Mapping[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / SOURCE_DIR_NAME).mkdir(parents=True, exist_ok=True)
    candidates = [row_to_dict(row) for row in conn.execute("SELECT * FROM candidates ORDER BY source, id")]
    pages = [row_to_dict(row) for row in conn.execute("SELECT * FROM pages ORDER BY source, id")]
    downloads = [row_to_dict(row) for row in conn.execute("SELECT * FROM downloads ORDER BY id")]

    candidates_by_url = {safe_str(row.get("normalized_url") or row.get("url")): row for row in candidates}
    items: List[Dict[str, Any]] = []
    for row in downloads:
        candidate_url = safe_str(row.get("candidate_url"))
        cand = candidates_by_url.get(candidate_url, {})
        dmeta = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
        cmeta = cand.get("metadata") if isinstance(cand.get("metadata"), Mapping) else {}
        final_url = safe_str(dmeta.get("confirm_final_url") or dmeta.get("final_url") or row.get("final_url") or candidate_url)
        item = {
            **row,
            "local_path": row.get("path"),
            "pdf_path": row.get("path"),
            "url": candidate_url,
            "pdf_url": candidate_url,
            "source_url": candidate_url,
            "final_url": final_url,
            "source_site": cand.get("source") or cmeta.get("source_site"),
            "source_page": cand.get("discovered_on_page"),
            "filename_hint": cand.get("filename_hint"),
            "object_key": cand.get("object_key"),
            "dedupe_status": cand.get("dedupe_status"),
            "topper_name": cmeta.get("topper_name"),
            "rank": cmeta.get("rank"),
            "year": cmeta.get("year"),
            "subject": cmeta.get("subject"),
            "paper": cmeta.get("paper"),
            "institute": cmeta.get("institute"),
            "metadata": {**dict(cmeta), **dict(dmeta)},
        }
        items.append(item)

    atomic_write_json(output_dir / SOURCE_DIR_NAME / "discovered-sources.json", candidates)
    atomic_write_json(output_dir / SOURCE_DIR_NAME / "source-pages-manifest.json", pages)
    atomic_write_json(
        output_dir / "download-manifest.json",
        {
            "generated_at": utc_now(),
            "summary": dict(summary),
            "items": items,
            "downloads": items,
            "counts": {"items": len(items), "downloaded": sum(1 for item in items if item.get("status") == "downloaded")},
        },
    )
    # Event stream requested by the plan. Keep it compact and append-friendly.
    events_path = output_dir / SOURCE_DIR_NAME / "discovered-events.jsonl"
    event_lines = [
        {"ts": utc_now(), "event": "manifest_written", "summary": dict(summary)},
        {"ts": utc_now(), "event": "counts", "candidates": len(candidates), "pages": len(pages), "downloads": len(downloads)},
    ]
    atomic_write_text(events_path, "".join(json.dumps(line, ensure_ascii=False, sort_keys=True) + "\n" for line in event_lines))
    atomic_write_json(
        output_dir / "manifest.json",
        {
            "generated_at": utc_now(),
            "repo_root": str(REPO_ROOT),
            "output_dir": str(output_dir),
            "sqlite": str(output_dir / SOURCE_DIR_NAME / "discovered-sources.sqlite"),
            "summary": dict(summary),
            "counts": {
                "candidates": len(candidates),
                "pages": len(pages),
                "downloads": len(downloads),
                "download_items": len(items),
            },
            "optional_dependencies": {
                "requests": requests is not None,
                "bs4": BeautifulSoup is not None,
                "pymupdf": fitz is not None,
            },
            "files": {
                "candidates": str(output_dir / SOURCE_DIR_NAME / "discovered-sources.json"),
                "source_pages": str(output_dir / SOURCE_DIR_NAME / "source-pages-manifest.json"),
                "events": str(events_path),
                "downloads": str(output_dir / "download-manifest.json"),
            },
        },
    )

def parse_sources(values: Optional[Sequence[str]]) -> List[str]:
    if not values:
        return ["all"]
    out: List[str] = []
    for value in values:
        for part in str(value).split(","):
            part = part.strip().lower()
            if part:
                out.append(part)
    return out or ["all"]


def selected_source_configs(args: argparse.Namespace) -> Dict[str, Dict[str, Any]]:
    selected = parse_sources(args.source)
    unknown = sorted(s for s in selected if s != "all" and s not in SOURCE_CONFIGS)
    if unknown:
        raise SystemExit(f"Unknown --source value(s): {', '.join(unknown)}. Choices: all, {', '.join(SOURCE_CONFIGS)}")

    if "all" in selected:
        names = list(SOURCE_CONFIGS.keys())
    else:
        names = selected

    configs: Dict[str, Dict[str, Any]] = {}
    seed_hosts = sorted({url_host(normalize_url(seed) or seed) for seed in args.seed or [] if url_host(normalize_url(seed) or seed)})
    for name in names:
        config = dict(SOURCE_CONFIGS[name])
        seeds = list(config.get("seeds") or [])
        if name == "generic":
            seeds.extend(args.seed or [])
            config["allowed_domains"] = sorted(set(config.get("allowed_domains") or []) | set(seed_hosts))
        elif args.seed and len(names) == 1:
            # If the caller selected a specific source and supplied seeds, treat them
            # as additional source-specific entrypoints while preserving allow-listing.
            seeds.extend(args.seed)
            extra_hosts = [url_host(normalize_url(seed) or seed) for seed in args.seed if url_host(normalize_url(seed) or seed)]
            config["allowed_domains"] = sorted(set(config.get("allowed_domains") or []) | set(extra_hosts))
        config["seeds"] = list(dict.fromkeys(seeds))
        configs[name] = config
    return configs


def ensure_private_output_dir(output_dir: Path) -> None:
    """Keep downloader/discovery artifacts out of public/runtime paths."""
    try:
        resolved = output_dir.expanduser().resolve()
    except Exception:
        resolved = output_dir.expanduser()
    forbidden_roots = [
        REPO_ROOT / "public",
        REPO_ROOT / "data" / "app",
        REPO_ROOT / "data" / "pdf-runtime",
    ]
    for forbidden in forbidden_roots:
        try:
            forbidden_resolved = forbidden.resolve()
        except Exception:
            forbidden_resolved = forbidden
        if resolved == forbidden_resolved or forbidden_resolved in resolved.parents:
            raise SystemExit(f"Refusing to write discovery/download artifacts under public/runtime path: {resolved}")
    for root in [ACER_OCR_ROOT, REPO_OCR_ROOT]:
        try:
            allowed = root.resolve()
        except Exception:
            allowed = root
        if resolved == allowed or allowed in resolved.parents:
            return
    raise SystemExit(
        "Refusing to write discovery/download artifacts outside private OCR roots: "
        f"{resolved}. Use {ACER_OCR_ROOT} or {REPO_OCR_ROOT}."
    )


def make_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Bounded discovery/downloader for UPSC topper answer-copy PDFs.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    mode = parser.add_argument_group("modes")
    mode.add_argument("--discover", action="store_true", help="Discover PDF candidates by crawling configured source pages.")
    mode.add_argument("--download", action="store_true", help="Download discovered candidates from the SQLite manifest.")

    parser.add_argument(
        "--source",
        action="append",
        help="Source(s): all,nextias,vajiram,drshivin,visionias,shubhraranjan,generic. Repeat or comma-separate.",
    )
    parser.add_argument("--seed", action="append", default=[], help="Additional seed URL(s); required/useful for --source generic.")
    parser.add_argument("--limit", type=int, default=0, help="Limit new candidates per source during discovery and total candidates during download. 0 = no explicit limit.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="Output root for SQLite, JSON manifests, cache, and PDFs.")
    parser.add_argument(
        "--allow-internet-discovery",
        action="store_true",
        default=env_bool(INTERNET_DISCOVERY_WORKFLOW_ENV, False),
        help=(
            "Explicitly enable bounded internet discovery/download for the active Acer internet+local OCR scope. "
            f"Network discovery is refused unless this flag or {INTERNET_DISCOVERY_WORKFLOW_ENV}=1 is set."
        ),
    )

    crawl = parser.add_argument_group("bounded crawl knobs")
    crawl.add_argument("--max-depth", type=int, default=2, help="Maximum crawl depth from each seed.")
    crawl.add_argument("--max-pages", type=int, default=500, help="Maximum source pages fetched per source.")
    crawl.add_argument("--max-urls", type=int, default=5000, help="Maximum unique PDF candidate URLs recorded per source.")
    crawl.add_argument("--max-page-bytes", type=int, default=5_000_000, help="Maximum bytes read from a source page/API response.")
    crawl.add_argument("--broad-crawl", action="store_true", help="Follow all same-domain HTML-ish links instead of topper/answer keyword-filtered links.")
    crawl.add_argument("--refresh-cache", action="store_true", help="Ignore source-pages cache and refetch.")
    crawl.add_argument("--cache-ttl-hours", type=float, default=24 * 14, help="TTL for source-pages cache; 0 means never expire.")
    crawl.add_argument("--ignore-robots", action="store_true", help="Do not consult robots.txt for source-page crawling.")

    net = parser.add_argument_group("network/download knobs")
    net.add_argument("--concurrency", type=int, default=6, help="Concurrent page fetches/downloads.")
    net.add_argument("--retries", type=int, default=2, help="Network retry count per request.")
    net.add_argument("--retry-backoff", type=float, default=1.0, help="Initial exponential retry backoff in seconds.")
    net.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    net.add_argument("--polite-delay", type=float, default=0.25, help="Minimum delay between requests to the same host.")
    net.add_argument("--user-agent", default=DEFAULT_USER_AGENT, help="HTTP User-Agent.")
    net.add_argument("--max-download-mb", type=float, default=250.0, help="Maximum bytes per downloaded PDF, in MiB.")

    dedupe = parser.add_argument_group("dedupe/download policy")
    dedupe.add_argument("--include-existing", action="store_true", help="Download even when URL/object key appears in existing repo data.")
    dedupe.add_argument("--include-duplicates", action="store_true", help="Download duplicate object-key/SHA candidates instead of skipping.")
    dedupe.add_argument("--retry-failed", action="store_true", help="Include previously skipped/failed downloads in --download selection.")
    dedupe.add_argument("--scan-existing-sha", action="store_true", help="Hash existing repo/local PDFs for SHA dedupe (slower).")

    gates = parser.add_argument_group("production gates")
    gates.add_argument("--production-gates", choices=["none", "acer-internet-local"], default="none", help="Apply simple acceptance gates to the final discovery/download summary.")
    gates.add_argument("--min-new-candidates", type=int, default=None, help="Gate: require at least this many newly discovered candidate PDFs.")
    gates.add_argument("--min-downloaded", type=int, default=None, help="Gate: require at least this many successfully downloaded PDFs when --download is used.")
    gates.add_argument("--fail-on-discovery-errors", action="store_true", help="Gate: fail if any source reports discovery errors.")

    parser.add_argument("--verbose", action="store_true", help="Print tracebacks for individual failures.")
    return parser


def evaluate_production_gates(args: argparse.Namespace, summary: Mapping[str, Any]) -> List[str]:
    blockers: List[str] = []
    discover = summary.get("discover") if isinstance(summary.get("discover"), Mapping) else {}
    download = summary.get("download") if isinstance(summary.get("download"), Mapping) else {}
    total_new = sum(int(stats.get("new_candidates") or 0) for stats in discover.values() if isinstance(stats, Mapping))
    total_errors = sum(int(stats.get("errors") or 0) for stats in discover.values() if isinstance(stats, Mapping))
    downloaded = int(download.get("downloaded") or 0) if isinstance(download, Mapping) else 0

    profile = getattr(args, "production_gates", "none")
    min_new = args.min_new_candidates
    min_downloaded = args.min_downloaded
    fail_on_errors = bool(args.fail_on_discovery_errors)
    if profile == "acer-internet-local":
        # Minimal, intentionally generic gates: prove the active network run
        # found something, and if downloads were requested, that at least one
        # validated PDF landed under the Acer OCR root.
        min_new = 1 if min_new is None and args.discover else min_new
        min_downloaded = 1 if min_downloaded is None and args.download else min_downloaded
        fail_on_errors = True if not args.verbose else fail_on_errors

    if min_new is not None and total_new < int(min_new):
        blockers.append(f"new_candidates {total_new} < required {min_new}")
    if args.download and min_downloaded is not None and downloaded < int(min_downloaded):
        blockers.append(f"downloaded {downloaded} < required {min_downloaded}")
    if fail_on_errors and total_errors > 0:
        blockers.append(f"discovery_errors {total_errors} > 0")
    return blockers


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = make_arg_parser()
    args = parser.parse_args(argv)
    if not args.allow_internet_discovery:
        print(
            "ERROR: internet discovery/download is disabled by default. "
            "For the active Acer internet+local OCR scope, rerun with "
            f"--allow-internet-discovery or {INTERNET_DISCOVERY_WORKFLOW_ENV}=1.",
            file=sys.stderr,
        )
        return 2
    if not args.discover and not args.download:
        # Safe default: discover only.
        args.discover = True

    args.output_dir = args.output_dir.expanduser().resolve()
    ensure_private_output_dir(args.output_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    configs = selected_source_configs(args)
    if args.discover and set(configs) == {"generic"} and not configs["generic"].get("seeds"):
        raise SystemExit("--source generic requires at least one --seed URL.")

    db_path = args.output_dir / SOURCE_DIR_NAME / "discovered-sources.sqlite"
    conn = init_db(db_path)
    mode = "+".join([name for name, enabled in [("discover", args.discover), ("download", args.download)] if enabled])
    run_id = create_run(conn, mode, args)

    log(f"Output dir: {args.output_dir}")
    log(f"SQLite DB:  {db_path}")
    log(f"Optional deps: requests={requests is not None} bs4={BeautifulSoup is not None} pymupdf={fitz is not None}")

    rate_limiter = HostRateLimiter(args.polite_delay)
    http = HTTPClient(
        user_agent=args.user_agent,
        timeout=args.timeout,
        retries=args.retries,
        retry_backoff=args.retry_backoff,
        rate_limiter=rate_limiter,
    )
    robots = RobotsCache(args.user_agent, args.timeout, enabled=not args.ignore_robots)
    page_cache = PageCache(args.output_dir, ttl_hours=args.cache_ttl_hours, refresh=args.refresh_cache)
    existing_index = build_existing_index(args.output_dir, scan_existing_sha=args.scan_existing_sha)
    log(
        "Existing index: "
        f"{existing_index.counts.get('normalized_urls', 0)} URLs, "
        f"{existing_index.counts.get('object_keys', 0)} object keys, "
        f"{existing_index.counts.get('sha256', 0)} SHA-256 hashes"
    )

    summary: Dict[str, Any] = {
        "started_at": utc_now(),
        "mode": mode,
        "sources": list(configs),
        "discover": {},
        "download": {},
        "existing_index": existing_index.counts,
    }

    global_seen_objects: Dict[str, str] = {}
    try:
        # Seed global dedupe map with candidates already present in SQLite from prior runs.
        for row in conn.execute("SELECT normalized_url, all_object_keys_json FROM candidates"):
            norm = str(row["normalized_url"])
            global_seen_objects.setdefault(norm, norm)
            for key in coerce_json_array(row["all_object_keys_json"]):
                global_seen_objects.setdefault(str(key), norm)

        if args.discover:
            for source, config in configs.items():
                log(f"🔎 Discovering {source} from {len(config.get('seeds') or [])} seed(s)")
                stats = discover_source(
                    source=source,
                    config=config,
                    seeds=config.get("seeds") or [],
                    args=args,
                    conn=conn,
                    http=http,
                    page_cache=page_cache,
                    robots=robots,
                    existing_index=existing_index,
                    global_seen_objects=global_seen_objects,
                )
                summary["discover"][source] = stats
                log(
                    f"   {source}: pages={stats['pages_seen']} fetched={stats['pages_fetched']} "
                    f"cache={stats['pages_from_cache']} pdfs={stats['pdf_candidates']} "
                    f"new={stats['new_candidates']} existing={stats['existing_repo_matches']} "
                    f"dupes={stats['duplicates']} errors={stats['errors']}"
                )

        if args.download:
            selected = set(configs.keys())
            if "all" in parse_sources(args.source):
                selected = {"all"}
            log(f"⬇️  Downloading candidates for sources: {', '.join(sorted(selected))}")
            summary["download"] = download_candidates(
                args=args,
                conn=conn,
                http=http,
                existing_index=existing_index,
                selected_sources=selected,
            )
            log(f"   download stats: {summary['download']}")

        summary["finished_at"] = utc_now()
        gate_blockers = evaluate_production_gates(args, summary)
        summary["acceptance_gates"] = {
            "profile": args.production_gates,
            "pass": not gate_blockers,
            "blockers": gate_blockers,
            "min_new_candidates": args.min_new_candidates,
            "min_downloaded": args.min_downloaded,
            "fail_on_discovery_errors": args.fail_on_discovery_errors,
        }
        write_manifests(conn, args.output_dir, summary)
        finish_run(conn, run_id, summary)
        log("✅ Wrote JSON manifests:")
        log(f"   {args.output_dir / 'manifest.json'}")
        log(f"   {args.output_dir / SOURCE_DIR_NAME / 'discovered-sources.json'}")
        log(f"   {args.output_dir / SOURCE_DIR_NAME / 'source-pages-manifest.json'}")
        log(f"   {args.output_dir / 'download-manifest.json'}")
        if gate_blockers:
            log(f"❌ Production gates failed: {'; '.join(gate_blockers)}")
            return 3
        return 0
    except KeyboardInterrupt:
        summary["finished_at"] = utc_now()
        summary["interrupted"] = True
        write_manifests(conn, args.output_dir, summary)
        finish_run(conn, run_id, summary)
        log("Interrupted; partial manifests written.")
        return 130
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
