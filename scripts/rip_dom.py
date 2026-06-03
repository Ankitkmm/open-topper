#!/usr/bin/env python3
"""
UPSC Path — Hybrid DOM Ripper
===============================
Opens Brave, you log in manually, then it auto-clicks
through all sections and extracts question→topper→pdf
data directly from the rendered page DOM.

Usage:
  python3 scripts/rip_dom.py
"""

import json
import os
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


def extract_from_dom(page):
    """Scrape all visible question→topper→pdf from the current page DOM."""
    return page.evaluate("""() => {
        const records = [];
        const seen = new Set();

        // Find ALL links/buttons that point to PDFs or topper copies
        const allLinks = document.querySelectorAll('a[href], button');

        allLinks.forEach(el => {
            const href = el.href || el.getAttribute('data-url') || el.getAttribute('data-link') || '';
            const text = (el.textContent || '').trim();

            // Skip if not a PDF/topper link
            const isPdf = href.includes('.pdf') || href.includes('copy') || href.includes('topper') || href.includes('r2.dev') || href.includes('drive.google.com');
            if (!isPdf && text.length < 3) return;

            // Find the nearest question text — walk up to find a container with question
            let container = el.closest('div[class*="question"], div[class*="card"], div[class*="item"], section, article, li');
            if (!container) container = el.closest('div');

            // Get question text from the container
            let questionText = '';
            if (container) {
                const qEl = container.querySelector('h1, h2, h3, h4, p[class*="question"], p[class*="text"], [class*="question"]');
                if (qEl) questionText = qEl.textContent.trim();
                if (!questionText) {
                    // Just take the first meaningful text paragraph
                    const paragraphs = container.querySelectorAll('p, h3, h4');
                    for (const p of paragraphs) {
                        const t = p.textContent.trim();
                        if (t.length > 20 && !t.includes('View') && !t.includes('Open') && !t.includes('Copy') && !t.includes('PDF')) {
                            questionText = t;
                            break;
                        }
                    }
                }
            }

            // Get topper name from nearby elements
            let topperName = '';
            const nameEl = el.closest('div')?.querySelector('[class*="name"], [class*="topper"], span[class*="font"]');
            if (nameEl) topperName = nameEl.textContent.trim();
            if (!topperName && container) {
                const badges = container.querySelectorAll('span[class*="badge"], span[class*="rank"], span[class*="name"]');
                for (const b of badges) {
                    const t = b.textContent.trim();
                    if (t.length > 2 && !t.match(/^\\d+$/) && t !== 'View' && t !== 'Open') {
                        topperName = t;
                        break;
                    }
                }
            }
            if (!topperName) topperName = el.getAttribute('title') || el.getAttribute('aria-label') || '';

            if (questionText && href && href.startsWith('http')) {
                const key = questionText.slice(0,60) + '|' + topperName + '|' + href;
                if (!seen.has(key)) {
                    seen.add(key);
                    records.push({ question: questionText, topper_name: topperName, pdf_link: href });
                }
            }
        });

        // Also try looking for topper copy sections specifically
        document.querySelectorAll('[class*="topper"], [class*="copy"], [class*="answer"]').forEach(section => {
            const links = section.querySelectorAll('a[href]');
            const text = section.textContent || '';
            links.forEach(a => {
                const href = a.href || '';
                if (href && href.startsWith('http')) {
                    records.push({ question: text.slice(0,200), topper_name: a.textContent.trim() || 'Topper', pdf_link: href });
                }
            });
        });

        return records;
    }""")


def wait_for_dashboard(page, timeout=120):
    """Wait until user logs in and reaches dashboard."""
    print("\n👆 LOG IN NOW in the Brave window that opened")
    print("   Complete Google OAuth → wait for dashboard")

    waited = 0
    while waited < timeout:
        url = page.url
        if "/dashboard" in url or "/browse" in url or "/gs1" in url or "/socio" in url:
            print(f"✅ Dashboard detected! ({url})")
            return True
        if "accounts.google" in url:
            print("   (Google OAuth in progress, waiting...)")
        time.sleep(2)
        waited += 2

    print(f"⚠️  Dashboard not reached after {timeout}s. Current: {page.url}")
    return False


def click_topic_items(page):
    """Click syllabus topic items to load questions."""
    clicked = 0

    # Try multiple selector strategies
    strategies = [
        # Strategy 1: Look for the syllabus sidebar items
        ("nav a, aside a, [class*='sidebar'] a, [class*='nav'] a", "sidebar links"),
        # Strategy 2: Click list items
        ("li, [role='listitem']", "list items"),
        # Strategy 3: Click buttons with topic text
        ("button", "buttons"),
        # Strategy 4: Any clickable div with content
        ("div[class*='item'], div[class*='topic'], div[class*='row']", "topic divs"),
    ]

    for selector, label in strategies:
        try:
            items = page.locator(selector).all()
            if 3 < len(items) < 60:
                print(f"   Trying {len(items)} {label}...")
                for item in items[:12]:
                    try:
                        # Only click if it has visible text and isn't a nav link
                        text = item.text_content() or ""
                        if len(text) > 5 and len(text) < 300:
                            item.click(timeout=2000)
                            clicked += 1
                            time.sleep(1.2)
                    except:
                        pass
                if clicked > 2:
                    break
        except:
            continue

    return clicked


def main():
    print("=" * 50)
    print("UPSC Path — Hybrid DOM Ripper")
    print("=" * 50)
    os.makedirs(OUTPUT, exist_ok=True)

    all_records = []
    seen = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            headless=False,
        )
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # Go to UPSC Path
        page.goto(BASE, wait_until="domcontentloaded", timeout=20000)
        time.sleep(1)

        # Wait for manual login
        if not wait_for_dashboard(page):
            print("Could not reach dashboard. Make sure you're logged in.")
            input("Press Enter to try continuing anyway...")

        page.wait_for_load_state("networkidle")
        time.sleep(2)

        for section in SECTIONS:
            print(f"\n📁 {section.upper()}")
            try:
                page.goto(f"{BASE}/{section}", wait_until="networkidle", timeout=25000)
            except PWTimeout:
                print("   (timeout, continuing)")
            except Exception as e:
                print(f"   Error: {e}")
                continue

            time.sleep(4)
            page.evaluate("window.scrollBy(0, 400)")
            time.sleep(1)

            # Click through topics
            clicked = click_topic_items(page)
            print(f"   Clicked {clicked} items")

            if clicked > 0:
                time.sleep(2)

            # Extract data from DOM
            records = extract_from_dom(page)
            for r in records:
                key = f"{r['question'][:80]}|{r['topper_name']}|{r['pdf_link']}"
                if key not in seen:
                    seen.add(key)
                    r["section"] = section
                    all_records.append(r)

            print(f"   DOM records: {len(records)} (total: {len(all_records)})")

            # Scroll more and try again
            page.evaluate("window.scrollBy(0, 800)")
            time.sleep(1)
            records2 = extract_from_dom(page)
            for r in records2:
                key = f"{r['question'][:80]}|{r['topper_name']}|{r['pdf_link']}"
                if key not in seen:
                    seen.add(key)
                    r["section"] = section
                    all_records.append(r)

        browser.close()

    # Save
    if all_records:
        path = os.path.join(OUTPUT, "dom_scraped.jsonl")
        with open(path, "w") as f:
            for r in all_records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"\n✅ {len(all_records)} records → {path}")
        for r in all_records[:5]:
            print(f"  [{r.get('section', '')}] {r['topper_name'][:30]}")
            print(f"  Q: {r['question'][:80]}...")
            print(f"  → {r['pdf_link'][:80]}\n")
    else:
        print("\n⚠️ No records found. The page structure may need different selectors.")
        print("Try running again and let me know what you see on screen.")


if __name__ == "__main__":
    main()
