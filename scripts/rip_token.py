#!/usr/bin/env python3
"""
UPSC Path — Manual Login + Auto Scraper
=========================================
Opens Brave, you log in manually, press Enter.
Then it auto-navigates all 10 sections, intercepts
API responses, and extracts question→topper→pdf data.

Usage:
  python3 scripts/rip_token.py
"""

import json
import os
import re
import sys
import time

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

BASE = "https://upscpath.com"
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
OUTPUT = "extracted_data"

records = []
seen = set()


def harvest(data, source=""):
    global records, seen
    if not data or isinstance(data, str):
        return
    if isinstance(data, list):
        for item in data:
            harvest(item, source)
    elif isinstance(data, dict):
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
            data.get("question") or data.get("question_text") or data.get("text") or ""
        )
        if tname and pdf and qtext:
            if pdf.startswith("/"):
                pdf = BASE + pdf
            qtext = re.sub(r"<[^>]+>", "", qtext).strip()
            key = f"{qtext[:80]}|{tname}|{pdf}"
            if key not in seen:
                seen.add(key)
                records.append(
                    {
                        "question": qtext,
                        "topper_name": tname.strip(),
                        "pdf_link": pdf,
                        "rank": data.get("rank", ""),
                        "year": data.get("year", ""),
                        "page": data.get("exactPageNumber") or data.get("page", ""),
                        "introduction": data.get("extractedIntroduction")
                        or data.get("introduction", ""),
                    }
                )
        for k, v in data.items():
            if k not in ("topper_name", "name", "pdf_url", "question", "question_text"):
                harvest(v, source)


def on_response(resp):
    if "api/v1" in resp.url and resp.status == 200:
        try:
            body = resp.json()
            if body:
                harvest(body, resp.url)
        except:
            pass


def click_through(page):
    """Click topic cards to trigger question loading."""
    # Try clicking elements that look like topic/syllabus items
    clicked = 0
    selectors = [
        "div[class*='topic']",
        "div[class*='card']",
        "div[class*='item']",
        "button[class*='syllabus']",
        "a[class*='topic']",
        "div[class*='chapter']",
        "div[class*='subject']",
        "li",
        "button:has-text('Paper')",
        "div:has-text('Sociology')",
        "div:has-text('History')",
        "div:has-text('Culture')",
        "div:has-text('Polity')",
    ]
    for sel in selectors:
        try:
            cards = page.locator(sel).all()
            if 3 < len(cards) < 50:
                print(f"   Found {len(cards)} cards, clicking...")
                for card in cards[:8]:
                    try:
                        card.click(timeout=2000)
                        clicked += 1
                        time.sleep(1.5)
                    except:
                        pass
                if clicked > 0:
                    break
        except:
            continue
    return clicked


def main():
    print("=" * 50)
    print("UPSC Path Scraper")
    print("=" * 50)
    os.makedirs(OUTPUT, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            headless=False,
            args=["--disable-features=DialMediaRouteProvider"],
        )
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # Go to login page
        page.goto(f"{BASE}/login", wait_until="domcontentloaded", timeout=20000)
        time.sleep(2)

        # Click "Sign in with Google" if present
        try:
            google_btn = page.locator(
                "button:has-text('Google'), div:has-text('Google')"
            ).first
            if google_btn.is_visible(timeout=3000):
                google_btn.click()
                print("Clicked Google sign-in...")
                time.sleep(2)
        except:
            pass

        # WAIT for manual login
        print("\n" + "=" * 50)
        print("👆 LOG IN MANUALLY in the browser window")
        print("   (complete Google OAuth if needed)")
        print("   Once you see the dashboard, come back here")
        print("=" * 50)
        input("\nPress ENTER when you're logged in... ")

        # Check if we're on dashboard
        current = page.url
        if "/login" in current or "accounts.google" in current:
            print("Still on login page. Waiting 10 more seconds...")
            time.sleep(10)
            current = page.url

        print(f"Current URL: {current}")
        print("Starting to intercept API calls...")
        page.on("response", on_response)

        # Navigate through sections
        for section in SECTIONS:
            print(f"\n📁 {section.upper()}")
            try:
                page.goto(f"{BASE}/{section}", wait_until="networkidle", timeout=25000)
            except PWTimeout:
                print("   (page load timeout, continuing)")
            except Exception as e:
                print(f"   Error: {e}")
                continue

            time.sleep(3)
            page.evaluate("window.scrollBy(0, 400)")
            time.sleep(1)

            clicked = click_through(page)
            print(f"   Clicked {clicked} items")

            # Also scroll and try clicking on any visible links/buttons
            for _ in range(2):
                page.evaluate("window.scrollBy(0, 600)")
                time.sleep(1)

            count = len(records)
            print(f"   Records so far: {count}")

        browser.close()

    # Save output
    if records:
        path = os.path.join(OUTPUT, "all_papers.jsonl")
        with open(path, "w") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"\n✅ {len(records)} records saved to {path}")

        # Show summary by section
        from collections import Counter

        sections_found = Counter()
        for r in records:
            q = r["question"].lower()
            if "sociology" in q or "society" in q:
                sections_found["socio"] += 1
            elif "history" in q or "ancient" in q or "medieval" in q:
                sections_found["history"] += 1
            elif "geography" in q or "climate" in q:
                sections_found["geography"] += 1
            elif "polity" in q or "constitution" in q:
                sections_found["polity"] += 1
            elif "economy" in q or "economic" in q:
                sections_found["economy"] += 1
            elif "ethics" in q or "moral" in q:
                sections_found["ethics"] += 1
            else:
                sections_found["general"] += 1
        print("By topic:", dict(sections_found.most_common()))

        # Sample
        print("\nSample:")
        for r in records[:3]:
            print(f"  [{r.get('rank', '')}] {r['topper_name']}")
            print(f"  Q: {r['question'][:80]}...")
            print(f"  PDF: {r['pdf_link'][:80]}...\n")
    else:
        print("\n⚠️ No records intercepted.")
        print("The API calls may use a different data format.")
        print("Try browsing to a question page and re-run.")


if __name__ == "__main__":
    main()
