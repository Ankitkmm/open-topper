#!/usr/bin/env python3
"""
UPSC Path GS1 Scraper
========================
Scrapes all GS1 PYQs with linked topper copies and PDF URLs.
Outputs clean JSONL (one line per topper answer).

Usage:
  python3 scripts/scrape_upscpath.py

Requires:
  pip install requests
"""

import requests
import json
import sys
import os
import time
from urllib.parse import quote

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════

BASE_URL = "https://prod-api.upscpath.com/api/v1"
DASHBOARD_URL = "https://upscpath.com"

# Paste your fresh JWT token here
BEARER_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzaWQiOiI5MWNlYjFhYy03ODRiLTQ4ODktYTUwZC1hNDZkYTdkZTRhNTIiLCJ1aWQiOiIzMGI0YzZlNy05YWFlLTRkYjItOTFlZC02MWU5OTVjMWFlN2QiLCJlbWFpbCI6InNiZW4wMzY3NUBnbWFpbC5jb20iLCJyb2xlIjoidXNlciIsInN1YiI6IjMwYjRjNmU3LTlhYWUtNGRiMi05MWVkLTYxZTk5NWMxYWU3ZCIsImV4cCI6MTc4MDE5MTkzNSwiaWF0IjoxNzgwMTUyMzM1fQ.7C_slJ_ZkKCu6r48sl-vt570HVSQ7fQFE9cfQy1VPIw"

OUTPUT_FILE = "gs1_topper_copies.jsonl"
PAPERS = ["GS Paper 1"]  # Papers to scrape
PER_PAGE = 50
RATE_LIMIT_DELAY = 0.5  # seconds between requests

# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════

HEADERS = {
    "Authorization": f"Bearer {BEARER_TOKEN}",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) UPSC-Scraper/1.0",
    "Accept": "application/json",
    "Origin": DASHBOARD_URL,
    "Referer": f"{DASHBOARD_URL}/dashboard",
}


def api_get(endpoint, params=None):
    """Make an authenticated GET request to the UPSC Path API."""
    url = f"{BASE_URL}/{endpoint}"
    try:
        resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as e:
        print(f"  HTTP {e.response.status_code}: {e.response.text[:200]}", file=sys.stderr)
        return None
    except requests.exceptions.RequestException as e:
        print(f"  Request failed: {e}", file=sys.stderr)
        return None


def strip_html(text):
    """Remove HTML tags from text."""
    import re
    if not text:
        return text
    return re.sub(r"<[^>]+>", "", text).strip()


def escape_json_string(s):
    """Escape special characters for valid JSON."""
    if not s:
        return s
    return (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def make_absolute_url(url):
    """Convert relative URLs to absolute."""
    if not url:
        return None
    if url.startswith("http"):
        return url
    if url.startswith("/"):
        return f"{DASHBOARD_URL}{url}"
    return f"{DASHBOARD_URL}/{url}"


# ═══════════════════════════════════════════════════════════════════════════
# SCRAPER
# ═══════════════════════════════════════════════════════════════════════════


def fetch_syllabus_topics(paper_filter=None):
    """Fetch all syllabus topics, optionally filtered by paper."""
    print("📚 Fetching syllabus topics...", file=sys.stderr)
    data = api_get("browse/syllabus")
    if not data or "syllabus" not in data:
        print("❌ Failed to fetch syllabus", file=sys.stderr)
        return []

    topics = data["syllabus"]
    if paper_filter:
        topics = [t for t in topics if t.get("paper") in paper_filter]

    print(f"   Found {len(topics)} topics", file=sys.stderr)
    return topics


def fetch_pyqs_for_topic(topic_text, page=1, per_page=PER_PAGE):
    """Fetch PYQs for a specific syllabus topic."""
    params = {"q": topic_text, "page": page, "per_page": per_page}
    data = api_get("browse/pyqs", params=params)
    return data


def fetch_pyq_details(pyq_id):
    """Fetch detailed info for a specific PYQ including topper answers."""
    return api_get(f"pyqs/{pyq_id}")


def fetch_related_questions(pyq_id):
    """Fetch related/similar questions for a PYQ."""
    return api_get(f"pyqs/{pyq_id}/related-questions")


def process_topper_answer(question_text, answer):
    """Extract and clean a single topper answer entry."""
    topper_name = answer.get("topper_name") or answer.get("name") or answer.get("student_name", "")
    pdf_link = answer.get("pdf_url") or answer.get("copy_url") or answer.get("link", "")

    # Try nested structures
    if not pdf_link and "copy" in answer:
        pdf_link = answer["copy"].get("url", "")
    if not pdf_link and "pdf" in answer:
        pdf_link = answer["pdf"].get("url", "")
    if not pdf_link and "file" in answer:
        pdf_link = answer["file"].get("url", "")

    pdf_link = make_absolute_url(pdf_link)

    if not question_text or not topper_name:
        return None

    return {
        "question": escape_json_string(strip_html(question_text)),
        "topper_name": escape_json_string(topper_name.strip()),
        "pdf_link": pdf_link or "",
    }


def scrape_all_pyqs(topics):
    """Scrape PYQs for all given topics and extract topper copies."""
    all_entries = []
    seen = set()

    for i, topic in enumerate(topics):
        topic_text = topic.get("topic", "")
        paper = topic.get("paper", "Unknown")
        print(f"\n[{i+1}/{len(topics)}] {paper}: {topic_text[:70]}...", file=sys.stderr)

        page = 1
        while True:
            data = fetch_pyqs_for_topic(topic_text, page=page)
            if not data:
                break

            pyqs = data.get("pyqs") or data.get("questions") or data.get("results") or []
            pagination = data.get("pagination", {})

            if not pyqs:
                total = pagination.get("total_count", 0)
                if total == 0:
                    print(f"   ⚠️  No PYQs found (free tier may not have access)", file=sys.stderr)
                break

            for pyq in pyqs:
                # Extract question text from various possible field names
                question_text = (
                    pyq.get("question_text")
                    or pyq.get("question")
                    or pyq.get("text")
                    or pyq.get("title", "")
                )

                pyq_id = pyq.get("id") or pyq.get("pyq_id") or pyq.get("_id", "")

                # Try to get detailed info with topper copies
                if pyq_id:
                    details = fetch_pyq_details(pyq_id)
                    if details:
                        answers = (
                            details.get("topper_answers")
                            or details.get("answers")
                            or details.get("copies")
                            or []
                        )
                        for answer in answers:
                            entry = process_topper_answer(question_text, answer)
                            if entry:
                                dedupe_key = f"{entry['question']}|{entry['topper_name']}|{entry['pdf_link']}"
                                if dedupe_key not in seen:
                                    seen.add(dedupe_key)
                                    all_entries.append(entry)

                    # Also check related questions
                    related = fetch_related_questions(pyq_id)
                    if related:
                        related_qs = related.get("questions") or related.get("related") or []
                        for rq in related_qs:
                            rq_text = (
                                rq.get("question_text")
                                or rq.get("question")
                                or rq.get("text", "")
                            )
                            rq_answers = (
                                rq.get("topper_answers")
                                or rq.get("answers")
                                or rq.get("copies")
                                or []
                            )
                            for answer in rq_answers:
                                entry = process_topper_answer(rq_text, answer)
                                if entry:
                                    dedupe_key = f"{entry['question']}|{entry['topper_name']}|{entry['pdf_link']}"
                                    if dedupe_key not in seen:
                                        seen.add(dedupe_key)
                                        all_entries.append(entry)

                # Also check inline topper answers in the pyq object
                inline_answers = (
                    pyq.get("topper_answers")
                    or pyq.get("answers")
                    or pyq.get("copies")
                    or []
                )
                for answer in inline_answers:
                    entry = process_topper_answer(question_text, answer)
                    if entry:
                        dedupe_key = f"{entry['question']}|{entry['topper_name']}|{entry['pdf_link']}"
                        if dedupe_key not in seen:
                            seen.add(dedupe_key)
                            all_entries.append(entry)

                time.sleep(RATE_LIMIT_DELAY)

            # Pagination
            if not pagination.get("has_next", False):
                break
            page += 1
            time.sleep(RATE_LIMIT_DELAY)

        print(f"   Collected {len(all_entries)} total entries so far", file=sys.stderr)

    return all_entries


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════


def main():
    print("=" * 60, file=sys.stderr)
    print("UPSC Path GS1 Scraper", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # 1. Fetch syllabus topics
    topics = fetch_syllabus_topics(paper_filter=PAPERS)
    if not topics:
        print("\n❌ No syllabus topics found. Check your token/account.", file=sys.stderr)
        sys.exit(1)

    # 2. Scrape all PYQs
    entries = scrape_all_pyqs(topics)

    # 3. Write output
    if entries:
        output_path = os.path.join(os.path.dirname(__file__), "..", OUTPUT_FILE)
        with open(output_path, "w", encoding="utf-8") as f:
            for entry in entries:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        print(f"\n✅ Done! {len(entries)} entries written to {OUTPUT_FILE}", file=sys.stderr)
        print(f"\nFirst 3 entries:", file=sys.stderr)
        for entry in entries[:3]:
            print(f"  {json.dumps(entry, ensure_ascii=False)[:120]}...", file=sys.stderr)
    else:
        print(
            "\n⚠️  No entries collected. This usually means:",
            file=sys.stderr,
        )
        print(
            "   1. Your account is on the FREE tier (no PYQ access)",
            file=sys.stderr,
        )
        print(
            "   2. UPSC Path requires a paid subscription for question data",
            file=sys.stderr,
        )
        print(
            "   3. Try upgrading your account at https://upscpath.com/pricing",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
