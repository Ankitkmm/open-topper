#!/usr/bin/env python3
"""
UPSC Path — Automated Browser Ripper (Playwright)
==================================================
Opens a real Chrome browser, logs into UPSC Path, clicks through
every section, intercepts API responses containing PYQs and topper
copies, and outputs clean JSONL files per subject.

Usage:
  pip install playwright
  playwright install chromium
  python3 scripts/rip_browser.py

Edit the EMAIL/PASSWORD below before running.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG — EDIT THESE
# ═══════════════════════════════════════════════════════════════════════════

EMAIL = "sben03675@gmail.com"
PASSWORD = "17122003a@"  # ← REPLACE WITH YOUR ACTUAL PASSWORD

BASE_URL = "https://upscpath.com"
LOGIN_URL = f"{BASE_URL}/login"
OUTPUT_DIR = "extracted_data"

# Sections to scrape (URL slugs on upscpath.com)
SECTIONS = [
    "gs1",
    "gs2",
    "gs3",
    "gs4",
    "essay",
    "socio",
    "psir",
    "anthro",
    "geography",
    "history",
]

# Delay between clicks (seconds) — increase if data doesn't load
CLICK_DELAY = 2.0
PAGE_LOAD_DELAY = 3.0

# ═══════════════════════════════════════════════════════════════════════════
# DATA COLLECTOR
# ═══════════════════════════════════════════════════════════════════════════


class DataCollector:
    def __init__(self):
        self.records = []  # All harvested records
        self.seen = set()  # Deduplication
        self.api_hits = []  # Track all intercepted API calls for debugging

    def handle_response(self, response):
        """Intercept every API response and extract question→topper→pdf data."""
        url = response.url
        if "api/v1" not in url:
            return
        if response.status != 200:
            return

        self.api_hits.append(url)

        try:
            body = response.json()
        except Exception:
            # Not JSON or empty body
            text = response.text()
            if text and len(text) > 50:
                self.api_hits.append(f"{url} (non-JSON: {len(text)}B)")
            return

        if not body:
            return

        # ── Extract entries from this payload ──
        entries = self._extract_entries(body, url)

        for entry in entries:
            dedupe = (
                f"{entry['question'][:80]}|{entry['topper_name']}|{entry['pdf_link']}"
            )
            if dedupe not in self.seen:
                self.seen.add(dedupe)
                self.records.append(entry)

        if entries:
            print(
                f"   📦 +{len(entries)} records from {url.split('/')[-1][:60]}",
                file=sys.stderr,
            )

    def _extract_entries(self, data, source_url="", depth=0):
        """Recursively walk JSON to find question→topper→pdf triples."""
        if depth > 6:
            return []
        if not data:
            return []

        entries = []

        if isinstance(data, list):
            for item in data:
                entries.extend(self._extract_entries(item, source_url, depth + 1))

        elif isinstance(data, dict):
            # Check if this dict itself looks like a topper entry
            tname = (
                data.get("topper_name")
                or data.get("name")
                or data.get("student_name")
                or data.get("topperName")
                or ""
            )
            pdf = (
                data.get("pdf_url")
                or data.get("pdf_link")
                or data.get("sourceCdnUrl")
                or data.get("copy_url")
                or data.get("link")
                or data.get("url")
                or ""
            )
            qtext = (
                data.get("question")
                or data.get("question_text")
                or data.get("text")
                or ""
            )

            if tname and pdf and qtext:
                pdf = self._make_absolute(pdf)
                qtext = self._strip_html(qtext).strip()
                if qtext and tname.strip():
                    entries.append(
                        {
                            "question": self._escape(qtext),
                            "topper_name": self._escape(tname.strip()),
                            "pdf_link": pdf,
                            "rank": data.get("rank", ""),
                            "year": data.get("year", ""),
                            "page": data.get("exactPageNumber") or data.get("page", ""),
                        }
                    )

            # Also check nested question → answer structures
            # Pattern: { question: "...", topper_answers: [...] }
            answers = (
                data.get("topper_answers")
                or data.get("toppers")
                or data.get("answers")
                or data.get("copies")
                or data.get("linkedTopperAnswers")
                or []
            )
            parent_q = self._strip_html(qtext) if qtext else ""

            for ans in answers:
                if isinstance(ans, dict):
                    entries.extend(
                        self._extract_entries(
                            {**ans, "question": ans.get("question") or parent_q},
                            source_url,
                            depth + 1,
                        )
                    )

            # Walk deeper into all child values
            known_keys = {
                "topper_answers",
                "toppers",
                "answers",
                "copies",
                "linkedTopperAnswers",
            }
            for k, v in data.items():
                if k not in known_keys:
                    entries.extend(self._extract_entries(v, source_url, depth + 1))

        return entries

    @staticmethod
    def _strip_html(text):
        if not text or not isinstance(text, str):
            return text
        return re.sub(r"<[^>]+>", "", text)

    @staticmethod
    def _escape(s):
        if not s or not isinstance(s, str):
            return s
        return (
            s.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
        )

    @staticmethod
    def _make_absolute(url):
        if not url or not isinstance(url, str):
            return ""
        url = url.strip()
        if url.startswith("http://") or url.startswith("https://"):
            return url
        if url.startswith("/"):
            return f"{BASE_URL}{url}"
        return url

    def summary(self):
        print(f"\n{'=' * 60}", file=sys.stderr)
        print(f"API calls intercepted: {len(self.api_hits)}", file=sys.stderr)
        print(f"Unique records harvested: {len(self.records)}", file=sys.stderr)
        if not self.records:
            print(f"\n⚠️  No records found. API endpoints hit:", file=sys.stderr)
            for h in self.api_hits[-20:]:
                print(f"   {h[:120]}", file=sys.stderr)


# ═══════════════════════════════════════════════════════════════════════════
# BROWSER AUTOMATION
# ═══════════════════════════════════════════════════════════════════════════


def try_login(page):
    """Attempt to log in. Returns True if successful."""
    print(f"🔐 Navigating to {LOGIN_URL}...", file=sys.stderr)
    page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)
    time.sleep(2)

    # Check if already logged in (redirected to dashboard)
    if "/dashboard" in page.url or "/browse" in page.url:
        print("✅ Already logged in (session active)", file=sys.stderr)
        return True

    # Try Google OAuth login (most common for UPSC Path)
    try:
        # Look for Google sign-in button
        google_btn = page.locator(
            "button:has-text('Google'), a:has-text('Google'), div:has-text('Sign in with Google')"
        ).first
        if google_btn.is_visible(timeout=3000):
            print("   Clicking Google sign-in...", file=sys.stderr)
            google_btn.click()
            time.sleep(5)
            if "/dashboard" in page.url:
                print("✅ Google login successful", file=sys.stderr)
                return True
    except Exception:
        pass

    # Try email/password fields
    try:
        email_input = page.locator(
            "input[type='email'], input[name='email'], input[placeholder*='email']"
        ).first
        if email_input.is_visible(timeout=3000):
            email_input.fill(EMAIL)
            print(f"   Filled email: {EMAIL}", file=sys.stderr)

            password_input = page.locator("input[type='password']").first
            password_input.fill(PASSWORD)

            submit_btn = page.locator(
                "button[type='submit'], button:has-text('Sign in'), button:has-text('Login')"
            ).first
            submit_btn.click()

            page.wait_for_url("**/dashboard", timeout=15000)
            print("✅ Login successful", file=sys.stderr)
            return True
    except PlaywrightTimeout:
        pass
    except Exception as e:
        print(f"   Login attempt failed: {e}", file=sys.stderr)

    print(f"❌ Could not log in. Current URL: {page.url}", file=sys.stderr)
    print(f"   Page title: {page.title()}", file=sys.stderr)
    return False


def click_topic_cards(page, collector):
    """Click through all clickable topic/syllabus cards to trigger API calls."""
    # Try various selectors that might match topic cards
    selectors = [
        "div[class*='topic']",
        "div[class*='card']",
        "div[class*='item']",
        "button[class*='syllabus']",
        "a[class*='topic']",
        "div[class*='chapter']",
        "div[class*='subject']",
        "li[class*='list']",
        "[data-testid*='topic']",
        "[data-testid*='syllabus']",
    ]

    clicked = 0
    for selector in selectors:
        try:
            cards = page.locator(selector).all()
            if len(cards) > 3:
                print(f"   Found {len(cards)} cards with '{selector}'", file=sys.stderr)
                for i, card in enumerate(cards[:20]):  # Limit per section
                    try:
                        card.click(timeout=2000)
                        clicked += 1
                        time.sleep(CLICK_DELAY)
                    except Exception:
                        continue
                break
        except Exception:
            continue

    if clicked == 0:
        print(
            f"   ⚠️  No clickable topic cards found. Trying text-based selectors...",
            file=sys.stderr,
        )
        # Fallback: click on any elements containing topic-like text
        for text_hint in [
            "Sociology",
            "Culture",
            "History",
            "Polity",
            "Economy",
            "Ethics",
        ]:
            try:
                el = page.locator(f"text={text_hint}").first
                if el.is_visible(timeout=1000):
                    el.click(timeout=2000)
                    clicked += 1
                    time.sleep(CLICK_DELAY)
            except Exception:
                continue

    return clicked


def scrape_section(page, collector, section_slug):
    """Navigate to a section and scrape its data."""
    url = f"{BASE_URL}/{section_slug}"
    print(f"\n📁 [{section_slug.upper()}] Navigating to {url}", file=sys.stderr)

    try:
        page.goto(url, wait_until="networkidle", timeout=30000)
    except PlaywrightTimeout:
        print(f"   ⚠️  Page load timed out, continuing anyway...", file=sys.stderr)
    except Exception as e:
        print(f"   ❌ Failed to load: {e}", file=sys.stderr)
        return

    time.sleep(PAGE_LOAD_DELAY)

    # Scroll to trigger lazy-loaded content
    for _ in range(3):
        page.evaluate("window.scrollBy(0, 300)")
        time.sleep(1)

    # Click through topic cards to trigger API calls
    clicked = click_topic_cards(page, collector)
    print(f"   Clicked {clicked} items", file=sys.stderr)

    # Wait for API calls to complete
    time.sleep(2)


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════


def main():
    if PASSWORD == "YOUR_PASSWORD_HERE":
        print("❌ Edit the script and set your PASSWORD first.")
        print(f"   EMAIL: {EMAIL}")
        print(f"   PASSWORD: (replace YOUR_PASSWORD_HERE)")
        sys.exit(1)

    print("=" * 60, file=sys.stderr)
    print("UPSC Path — Automated Browser Ripper", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    collector = DataCollector()

    with sync_playwright() as p:
        # Launch browser using your existing Brave (no download needed)
        browser = p.chromium.launch(
            executable_path="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            headless=False,
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()

        # Intercept ALL network responses
        page.on("response", collector.handle_response)

        # Login
        if not try_login(page):
            print(
                "❌ Login failed. Check your credentials or try manual login.",
                file=sys.stderr,
            )
            print(
                "   The browser will stay open — log in manually, then press Enter...",
                file=sys.stderr,
            )
            input()
            if "/dashboard" not in page.url:
                browser.close()
                sys.exit(1)

        # Scrape every section
        for section in SECTIONS:
            scrape_section(page, collector, section)

        browser.close()

    # ── Write output ──
    collector.summary()

    if collector.records:
        # Per-section files
        by_section = {}
        for r in collector.records:
            # Guess section from question content or defaults
            sec = "general"
            by_section.setdefault(sec, []).append(r)

        # Write combined
        combined_path = os.path.join(OUTPUT_DIR, "all_papers.jsonl")
        with open(combined_path, "w", encoding="utf-8") as f:
            for r in collector.records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(
            f"✅ Saved {len(collector.records)} records → {combined_path}",
            file=sys.stderr,
        )

        # Show sample
        print(f"\n📋 Sample entries:", file=sys.stderr)
        for r in collector.records[:5]:
            print(f"   Q: {r['question'][:80]}...", file=sys.stderr)
            print(f"   → {r['topper_name']}", file=sys.stderr)
            print(f"   → {r['pdf_link'][:80]}", file=sys.stderr)
            print()
    else:
        print(f"\n⚠️  No data harvested. Debug info:", file=sys.stderr)
        print(f"   API endpoints hit: {len(collector.api_hits)}", file=sys.stderr)
        for h in collector.api_hits[:20]:
            print(f"   {h[:150]}", file=sys.stderr)


if __name__ == "__main__":
    main()
