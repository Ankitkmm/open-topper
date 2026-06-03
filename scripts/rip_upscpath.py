#!/usr/bin/env python3
"""
UPSC Path — Full Data Ripping Pipeline
========================================
Loops through ALL papers (GS1-4, Essay, all Optionals),
fetches every PYQ with linked topper copies and PDF URLs,
and outputs clean, deduplicated JSONL files per subject.

Organized output:
  extracted_data/
    ├── gs-1.jsonl
    ├── gs-2.jsonl
    ├── gs-3.jsonl
    ├── gs-4.jsonl
    ├── essay.jsonl
    ├── geography.jsonl
    ├── sociology.jsonl
    ├── psir.jsonl
    ├── public-administration.jsonl
    ├── anthropology.jsonl
    └── history.jsonl

Usage:
  python3 scripts/rip_upscpath.py
"""

import json
import os
import re
import sys
import time

import requests

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════

BEARER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiI5MWNlYjFhYy03ODRiLTQ4ODktYTUwZC1hNDZkYTdkZTRhNTIiLCJ1aWQiOiIzMGI0YzZlNy05YWFlLTRkYjItOTFlZC02MWU5OTVjMWFlN2QiLCJlbWFpbCI6InNiZW4wMzY3NUBnbWFpbC5jb20iLCJyb2xlIjoidXNlciIsInN1YiI6IjMwYjRjNmU3LTlhYWUtNGRiMi05MWVkLTYxZTk5NWMxYWU3ZCIsImV4cCI6MTc4MDE5MTkzNSwiaWF0IjoxNzgwMTUyMzM1fQ.7C_slJ_ZkKCu6r48sl-vt570HVSQ7fQFE9cfQy1VPIw"

BASE_URL = "https://prod-api.upscpath.com/api/v1"
DASHBOARD = "https://upscpath.com"
OUTPUT_DIR = "extracted_data"
PER_PAGE = 50
DELAY = 0.8  # seconds between page requests

# Paper → syllabus topic mapping (what we search for to get PYQs for each paper)
PAPER_SEARCH_TERMS = {
    "gs-1": [
        "Indian Culture",
        "Modern Indian History",
        "Freedom Struggle",
        "World History",
        "Indian Society",
        "Women",
        "Population",
        "Globalization",
        "Social empowerment",
        "Physical Geography",
        "Geography",
        "Urbanization",
        "Poverty",
    ],
    "gs-2": [
        "Constitution",
        "Polity",
        "Governance",
        "Social Justice",
        "International Relations",
        "Indian Diaspora",
        "Parliament",
        "Judiciary",
        "Federalism",
        "Elections",
        "Civil Services",
    ],
    "gs-3": [
        "Economy",
        "Agriculture",
        "Environment",
        "Disaster Management",
        "Internal Security",
        "Science and Technology",
        "Cyber Security",
        "Infrastructure",
        "Energy",
        "Budget",
        "Inclusive Growth",
    ],
    "gs-4": [
        "Ethics",
        "Integrity",
        "Aptitude",
        "Emotional Intelligence",
        "Moral Thinkers",
        "Code of Conduct",
        "Probity",
        "Civil Service Values",
        "Work Culture",
        "Case Study",
    ],
    "essay": ["Essay"],
    "geography": [
        "Geomorphology",
        "Climatology",
        "Oceanography",
        "Human Geography",
        "Economic Geography",
    ],
    "sociology": [
        "Sociology",
        "Social Stratification",
        "Social Change",
        "Religion",
        "Caste",
        "Kinship",
    ],
    "psir": [
        "Political Theory",
        "Indian Government",
        "Comparative Politics",
        "International Relations",
        "PSIR",
    ],
    "public-administration": [
        "Public Administration",
        "Administrative Theory",
        "Bureaucracy",
        "Development Administration",
    ],
    "anthropology": [
        "Anthropology",
        "Evolution",
        "Primatology",
        "Ethnography",
        "Tribal",
    ],
    "history": [
        "Ancient India",
        "Medieval India",
        "Modern India",
        "World History",
        "Archaeology",
    ],
}

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": DASHBOARD,
    "Referer": f"{DASHBOARD}/dashboard",
}

# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════


def strip_html(text):
    if not text or not isinstance(text, str):
        return text
    return re.sub(r"<[^>]+>", "", text).strip()


def escape_json(s):
    if not s or not isinstance(s, str):
        return s
    return (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def make_absolute(url):
    if not url or not isinstance(url, str):
        return ""
    url = url.strip()
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("/"):
        return f"{DASHBOARD}{url}"
    return f"{DASHBOARD}/{url}"


def api_get(endpoint, params=None):
    url = f"{BASE_URL}/{endpoint}"
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=20)
        if resp.status_code in [401, 403]:
            print(
                f"    ❌ Auth failed (HTTP {resp.status_code}). Token expired or revoked.",
                file=sys.stderr,
            )
            return None
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.RequestException as e:
        print(f"    ⚠️ Request error: {e}", file=sys.stderr)
        return None


# ═══════════════════════════════════════════════════════════════════════════
# EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════


def fetch_syllabus():
    """Get full syllabus from UPSC Path."""
    print("📚 Fetching syllabus index...", file=sys.stderr)
    data = api_get("browse/syllabus")
    if not data or "syllabus" not in data:
        print("❌ Failed to load syllabus", file=sys.stderr)
        return []
    topics = data["syllabus"]
    print(f"   Loaded {len(topics)} syllabus topics", file=sys.stderr)
    return topics


def fetch_pyqs_for_search(query, page=1, per_page=PER_PAGE):
    """Search PYQs by text query."""
    return api_get(
        "browse/pyqs", params={"q": query, "page": page, "per_page": per_page}
    )


def fetch_question_detail(question_id):
    """Get full details for a single question (including topper copies)."""
    return api_get(f"pyqs/{question_id}")


def extract_entries_from_response(data, paper_slug, seen):
    """
    Walk the response structure and extract question→topper→pdf triples.
    Handles multiple possible API response shapes.
    """
    entries = []

    if not data:
        return entries

    # Try known paths: data.pyqs, data.questions, etc.
    pyqs = (
        data.get("pyqs")
        or data.get("questions")
        or data.get("results")
        or data.get("data")
        or []
    )
    if not isinstance(pyqs, list):
        pyqs = [pyqs] if pyqs else []

    for pyq in pyqs:
        if not isinstance(pyq, dict):
            continue

        question_text = strip_html(
            pyq.get("question")
            or pyq.get("question_text")
            or pyq.get("text")
            or pyq.get("title")
            or ""
        )

        # Try fetching full detail for this question
        qid = pyq.get("id") or pyq.get("_id") or pyq.get("pyq_id")
        if qid:
            detail = fetch_question_detail(qid)
            if detail:
                # Merge detail into pyq for topper extraction
                pyq = {**pyq, **detail}

        # Extract topper answers from whatever field they're in
        answers = (
            pyq.get("topper_answers")
            or pyq.get("toppers")
            or pyq.get("answers")
            or pyq.get("copies")
            or pyq.get("linkedTopperAnswers")
            or []
        )

        for ans in answers:
            if not isinstance(ans, dict):
                continue

            tname = (
                ans.get("topper_name")
                or ans.get("topperName")
                or ans.get("name")
                or ans.get("student_name")
                or ""
            )
            pdf = make_absolute(
                ans.get("pdf_url")
                or ans.get("pdf_link")
                or ans.get("sourceCdnUrl")
                or ans.get("copy_url")
                or ans.get("link")
                or ans.get("url")
                or ""
            )

            if not question_text or not tname:
                continue

            dedupe = f"{question_text[:100]}|{tname}|{pdf}"
            if dedupe in seen:
                continue
            seen.add(dedupe)

            entries.append(
                {
                    "paper": paper_slug,
                    "question": escape_json(question_text),
                    "topper_name": escape_json(tname.strip()),
                    "pdf_link": pdf,
                    "page": ans.get("exactPageNumber") or ans.get("page") or "",
                    "rank": ans.get("rank") or "",
                    "year": ans.get("year") or "",
                    "introduction": escape_json(
                        ans.get("extractedIntroduction")
                        or ans.get("introduction")
                        or ""
                    ),
                }
            )

    return entries


def rip_paper(paper_slug, search_terms):
    """Scrape all PYQs for a given paper and return mapped entries."""
    print(f"\n{'=' * 60}", file=sys.stderr)
    print(f"📄 {paper_slug.upper()}", file=sys.stderr)
    print(f"{'=' * 60}", file=sys.stderr)

    all_entries = []
    seen = set()
    auth_failed = False

    for term_idx, term in enumerate(search_terms):
        print(
            f'  [{term_idx + 1}/{len(search_terms)}] Searching: "{term}"',
            file=sys.stderr,
        )
        page = 1

        while True:
            data = fetch_pyqs_for_search(term, page=page)
            if data is None:
                if page == 1:
                    print(f"    ⚠️ No response — skipping term", file=sys.stderr)
                break

            # Check pagination
            pagination = data.get("pagination", {})
            total = pagination.get("total_count", 0)

            if total == 0:
                if page == 1:
                    print(f"    (no results for this term)", file=sys.stderr)
                break

            entries = extract_entries_from_response(data, paper_slug, seen)
            all_entries.extend(entries)

            if entries:
                print(
                    f"    Page {page}: +{len(entries)} entries (total: {len(all_entries)})",
                    file=sys.stderr,
                )

            if not pagination.get("has_next", False):
                break

            page += 1
            time.sleep(DELAY)

        time.sleep(DELAY * 1.5)

    return all_entries


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════


def main():
    print("=" * 60, file=sys.stderr)
    print("UPSC Path — Full Data Extraction Pipeline", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    total_all = 0
    results = {}

    for paper_slug, search_terms in PAPER_SEARCH_TERMS.items():
        entries = rip_paper(paper_slug, search_terms)
        results[paper_slug] = entries
        total_all += len(entries)

        # Write per-paper file immediately
        if entries:
            filepath = os.path.join(OUTPUT_DIR, f"{paper_slug}.jsonl")
            with open(filepath, "w", encoding="utf-8") as f:
                for entry in entries:
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            print(f"  ✅ Saved {len(entries)} entries → {filepath}", file=sys.stderr)
        else:
            print(f"  ⚠️ No entries for {paper_slug}", file=sys.stderr)

        time.sleep(2)  # Pause between papers

    # Summary
    print(f"\n{'=' * 60}", file=sys.stderr)
    print(f"EXTRACTION COMPLETE", file=sys.stderr)
    print(f"{'=' * 60}", file=sys.stderr)
    for paper_slug, entries in results.items():
        status = "✅" if entries else "⚠️ "
        print(
            f"  {status} {paper_slug:25s} {len(entries):>6,} entries", file=sys.stderr
        )
    print(f"  {'─' * 40}", file=sys.stderr)
    print(
        f"  📦 TOTAL: {total_all:,} entries across {len(PAPER_SEARCH_TERMS)} papers",
        file=sys.stderr,
    )
    print(f"  📁 Output: {OUTPUT_DIR}/", file=sys.stderr)

    if total_all == 0:
        print(f"\n⚠️  Zero entries extracted. Possible causes:", file=sys.stderr)
        print(
            f"   1. Free tier account — no PYQ access. Upgrade at upscpath.com/pricing",
            file=sys.stderr,
        )
        print(
            f"   2. API response format changed — check Network tab for actual structure",
            file=sys.stderr,
        )
        print(
            f"   3. Token requires refresh — re-intercept from browser", file=sys.stderr
        )


if __name__ == "__main__":
    main()
