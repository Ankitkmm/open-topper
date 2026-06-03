#!/usr/bin/env python3
"""
UPSC Path — Cookie-Based API Ripper
=====================================
Uses CDP-connected Brave session cookies to call the API.
No token needed — browser session handles auth automatically.

Usage:
  python3 scripts/rip_cdp.py
"""

import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

API = "https://prod-api.upscpath.com/api/v1"
SECTIONS = {
    "gs1": "gs1",
    "gs2": "gs2",
    "gs3": "gs3",
    "gs4": "gs4",
    "socio": "socio",
    "psir": "psir",
    "anthro": "anthro",
    "geography": "geography",
    "history": "history",
}
OUTPUT = "extracted_data"
CDP_URL = "http://127.0.0.1:9222"

all_entries = []
seen = set()


def api_fetch(page, endpoint, params=None):
    """Call the API through the browser page (uses session cookies)."""
    url = f"{API}/{endpoint}"
    if params:
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        url += f"?{qs}"

    result = page.evaluate(f"""
        async () => {{
            try {{
                const r = await fetch("{url}");
                return await r.json();
            }} catch(e) {{
                return {{error: e.message}};
            }}
        }}
    """)
    return result


def main():
    print("UPSC Path — Cookie Ripper\n")
    os.makedirs(OUTPUT, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)
        pages = browser.contexts[0].pages
        page = pages[0]

        print(f"Connected: {page.url}")

        for section_name, section_slug in SECTIONS.items():
            print(f"\n📁 {section_name.upper()}")

            # Get syllabus topics
            syllabus = api_fetch(
                page,
                "browse/syllabus",
                {
                    "section": section_slug,
                    "search_type": "pyqs",
                },
            )

            topics = []
            if syllabus and "syllabus" in syllabus:
                topics = [t["topic"] for t in syllabus["syllabus"]]
                print(f"   {len(topics)} topics")

            section_qs = []

            # Query PYQs for each topic
            for topic in topics[:15]:
                data = api_fetch(
                    page,
                    "browse/pyqs",
                    {
                        "section": section_slug,
                        "q": topic[:80],
                        "per_page": "50",
                    },
                )

                if not data or "pyqs" not in data:
                    continue

                pyqs = data["pyqs"]
                for pyq in pyqs:
                    qid = pyq.get("id")
                    if qid and qid not in {q["id"] for q in section_qs}:
                        section_qs.append(
                            {
                                "id": qid,
                                "question": pyq.get("question", ""),
                                "year": pyq.get("year"),
                                "syllabus": pyq.get("syllabus", ""),
                                "topper_counts": pyq.get("topper_answers_by_year", []),
                                "section": section_name,
                            }
                        )
                time.sleep(0.2)

            print(f"   {len(section_qs)} questions found")

            # Get detailed topper info for each question
            for i, q in enumerate(section_qs[:50]):  # Limit per section
                print(
                    f"\r   [{i + 1}/{min(len(section_qs), 50)}] pyq/{q['id']}",
                    end="",
                    flush=True,
                )

                detail = api_fetch(
                    page,
                    f"browse/pyqs/{q['id']}",
                    {
                        "section": section_slug,
                    },
                )

                if detail:
                    # Navigate to the question page in the browser to trigger topper loading
                    try:
                        page.goto(
                            f"https://upscpath.com/{section_slug}/pyq/{q['id']}",
                            wait_until="networkidle",
                            timeout=10000,
                        )
                    except:
                        pass
                    time.sleep(1)

                    # Scrape topper names and PDF links from the rendered page
                    toppers = page.evaluate("""() => {
                        const results = [];
                        document.querySelectorAll('a[href*=".pdf"], a[href*="r2.dev"], a[href*="drive.google"]').forEach(a => {
                            const row = a.closest('div, li');
                            const name = row ? (row.querySelector('strong, b, h3, h4')?.textContent?.trim() || '') : '';
                            results.push({name: name || a.textContent.trim().slice(0,50), link: a.href});
                        });
                        return results;
                    }""")

                    for t in toppers:
                        key = f"{q['id']}|{t['name']}|{t['link']}"
                        if key not in seen:
                            seen.add(key)
                            all_entries.append(
                                {
                                    "section": section_name,
                                    "question_id": q["id"],
                                    "question": q["question"],
                                    "year": q["year"],
                                    "topper_name": t["name"],
                                    "pdf_link": t["link"],
                                }
                            )

        browser.close()

    # Save
    if all_entries:
        path = os.path.join(OUTPUT, "all_questions.jsonl")
        with open(path, "w") as f:
            for e in all_entries:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        print(f"\n\n✅ {len(all_entries)} records → {path}")

        from collections import Counter

        secs = Counter(e["section"] for e in all_entries)
        for s, c in secs.most_common():
            print(f"   {s}: {c}")
    else:
        print("\n⚠️  No records")


if __name__ == "__main__":
    main()
