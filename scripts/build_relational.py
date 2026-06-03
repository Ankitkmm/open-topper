#!/usr/bin/env python3
"""
Build Relational Database from all data sources
================================================
Combines:
  - HAR files (question text, IDs, cross-section links)
  - OCR markdown files (topper copy content, linked by drive ID)
  - PDF R2 map (CDN URLs)
  - questions.json (existing topper metadata)

Outputs:
  data/relational/
    questions.json     — all questions with metadata
    toppers.json       — all topper copies with OCR content
    links.json         — question→topper mappings
    themes.json        — keywords, syllabus tags, cross-links
    index.json         — quick lookup index
"""

import hashlib
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "relational"
OUT.mkdir(parents=True, exist_ok=True)

# ═══════════════════════════════════════════════════════════
# 1. Extract questions from HAR files
# ═══════════════════════════════════════════════════════════


def extract_questions_from_har(har_path):
    """Extract all unique questions from HAR API responses."""
    with open(har_path) as f:
        har = json.load(f)

    questions = {}
    cross_links = []

    for e in har["log"]["entries"]:
        text = e.get("response", {}).get("content", {}).get("text", "")
        if not text or len(text) < 100:
            continue
        try:
            data = json.loads(text)
        except:
            continue

        # browse/pyqs response
        pyqs = data.get("pyqs", [])
        for pyq in pyqs:
            qid = pyq.get("id")
            if qid and qid not in questions:
                questions[qid] = {
                    "id": qid,
                    "question": pyq.get("question", ""),
                    "year": pyq.get("year"),
                    "subject": pyq.get("subject", ""),
                    "paper": pyq.get("paper", ""),
                    "syllabus": pyq.get("syllabus", ""),
                    "microtheme": pyq.get("microtheme", []),
                    "is_case_study": pyq.get("is_case_study", False),
                    "topper_counts_by_year": pyq.get("topper_answers_by_year", []),
                }

        # browse/pyqs/{id} single question
        if "id" in data and "question" in data and "pyqs" not in data:
            qid = data["id"]
            if qid not in questions:
                questions[qid] = {
                    "id": qid,
                    "question": data.get("question", ""),
                    "year": data.get("year"),
                    "subject": data.get("subject", ""),
                    "paper": data.get("paper", ""),
                    "syllabus": data.get("syllabus", ""),
                    "microtheme": data.get("microtheme", []),
                    "is_case_study": data.get("is_case_study", False),
                    "topper_counts_by_year": data.get("topper_answers_by_year", []),
                }

        # cross-section-similarities
        if "by_source_pyq_id" in data:
            for src_id, links in data["by_source_pyq_id"].items():
                for link in links:
                    cross_links.append(
                        {
                            "source_pyq_id": int(src_id),
                            "target_section": link.get("target_section"),
                            "target_pyq_id": link.get("target_pyq_id"),
                            "target_section_display": link.get(
                                "target_section_display"
                            ),
                        }
                    )

    return list(questions.values()), cross_links


# ═══════════════════════════════════════════════════════════
# 2. Link OCR files to toppers
# ═══════════════════════════════════════════════════════════


def build_ocr_index():
    """Build index of OCR files keyed by Google Drive file ID."""
    ocr_dir = ROOT / "UPSC_topper_md"
    ocr_index = {}

    if not ocr_dir.exists():
        return ocr_index

    for f in ocr_dir.iterdir():
        if not f.suffix == ".md":
            continue

        name = f.stem  # e.g., "drive_10TuWAIsYyKb8Fb1M0N1cXIcnngpjrqA0_MASTER"

        # Extract drive ID
        parts = name.split("_")
        if parts[0] == "drive" and len(parts) > 1:
            drive_id = parts[1]
            file_type = parts[-1] if parts[-1] in ("MASTER", "COMPLETE") else "UNKNOWN"

            # Extract page number if present (e.g., _p0_, _p10_)
            page = None
            for p in parts:
                if p.startswith("p") and p[1:].isdigit():
                    page = int(p[1:])
                    break

            if drive_id not in ocr_index:
                ocr_index[drive_id] = {
                    "drive_id": drive_id,
                    "files": [],
                    "pages": {},
                    "content": "",
                }

            # Read content
            try:
                content = f.read_text()
                ocr_index[drive_id]["files"].append(str(f.name))

                if page is not None:
                    ocr_index[drive_id]["pages"][page] = content[
                        :500
                    ]  # First 500 chars per page
                elif file_type in ("MASTER", "COMPLETE"):
                    ocr_index[drive_id]["content"] = content[:2000]  # First 2000 chars
            except:
                pass

    return ocr_index


# ═══════════════════════════════════════════════════════════
# 3. Build R2 PDF link map
# ═══════════════════════════════════════════════════════════


def build_pdf_map():
    """Map drive IDs to R2 CDN URLs."""
    r2_map_path = ROOT / "public" / "data" / "pdf-r2-map.json"
    pdf_map_path = ROOT / "public" / "data" / "pdf-map.json"

    pdf_map = {}

    # Load R2 map
    if r2_map_path.exists():
        with open(r2_map_path) as f:
            r2_data = json.load(f)
        for key, url in r2_data.items():
            pdf_map[key] = {"url": url, "source": "r2"}

    return pdf_map


# ═══════════════════════════════════════════════════════════
# 4. Build topper metadata from questions.json
# ═══════════════════════════════════════════════════════════


def build_topper_index():
    """Build topper index from questions.json with metadata."""
    q_path = ROOT / "public" / "data" / "questions.json"
    if not q_path.exists():
        return {}, []

    with open(q_path) as f:
        questions = json.load(f)

    toppers = {}
    links = []

    for q in questions:
        qid = q["id"]
        for t in q["toppers"]:
            # Extract drive ID from filename or link
            filename = t.get("filename", "")
            link = t.get("links", "")

            # Try to extract Google Drive file ID
            drive_id = None
            # From filename: "drive_10TuWAIs..." pattern
            m = re.match(r"^drive_([a-zA-Z0-9_-]{20,})", filename.replace(".pdf", ""))
            if m:
                drive_id = m.group(1)
            # From link: /file/d/ID/view pattern
            if not drive_id:
                m = re.search(r"/file/d/([a-zA-Z0-9_-]{20,})", link)
                if m:
                    drive_id = m.group(1)

            topper_key = f"{filename}|{link}"[:80]
            if topper_key not in toppers:
                toppers[topper_key] = {
                    "filename": filename,
                    "link": link,
                    "drive_id": drive_id,
                    "introduction": t.get("introduction", ""),
                    "page": t.get("page", ""),
                    "value_adds": t.get("value_adds", []),
                    "question_ids": [],
                }

            if qid not in toppers[topper_key]["question_ids"]:
                toppers[topper_key]["question_ids"].append(qid)
                links.append(
                    {
                        "question_id": qid,
                        "topper_key": topper_key,
                        "drive_id": drive_id,
                    }
                )

    return toppers, links


# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════


def main():
    print("Building Relational Database...\n")

    # Extract questions from both HAR files
    all_questions = {}
    all_cross_links = []

    for har_name in ["upscpath.com.har", "upscpath2.com.har"]:
        har_path = ROOT / har_name
        if har_path.exists():
            print(f"📖 Parsing {har_name}...")
            qs, cls = extract_questions_from_har(har_path)
            for q in qs:
                if q["id"] not in all_questions:
                    all_questions[q["id"]] = q
            all_cross_links.extend(cls)
            print(f"   {len(qs)} questions, {len(cls)} cross-links")

    print(f"\n   Total unique questions: {len(all_questions)}")
    print(f"   Total cross-links: {len(all_cross_links)}")

    # Build OCR index
    print(f"\n📝 Building OCR index...")
    ocr_index = build_ocr_index()
    print(f"   {len(ocr_index)} topper copies with OCR content")

    # Build PDF map
    print(f"\n🔗 Building PDF map...")
    pdf_map = build_pdf_map()
    print(f"   {len(pdf_map)} PDF URLs")

    # Build topper index
    print(f"\n👤 Building topper index...")
    toppers, topper_links = build_topper_index()
    print(f"   {len(toppers)} unique topper entries")
    print(f"   {len(topper_links)} question→topper links")

    # Enrich toppers with OCR and PDF data
    for t_key, t_data in toppers.items():
        drive_id = t_data.get("drive_id")
        if drive_id and drive_id in ocr_index:
            t_data["ocr_content"] = ocr_index[drive_id].get("content", "")[:500]
            t_data["ocr_pages"] = list(ocr_index[drive_id].get("pages", {}).keys())
        if drive_id and drive_id in pdf_map:
            t_data["r2_url"] = pdf_map[drive_id]["url"]

    # ── Write output files ──
    print(f"\n💾 Writing output...")

    # Questions
    q_list = sorted(all_questions.values(), key=lambda x: x["id"])
    with open(OUT / "questions.json", "w") as f:
        json.dump(q_list, f, indent=2, ensure_ascii=False)
    print(f"   questions.json: {len(q_list)} questions")

    # Toppers
    t_list = [{"key": k, **v} for k, v in toppers.items()]
    with open(OUT / "toppers.json", "w") as f:
        json.dump(t_list, f, indent=2, ensure_ascii=False)
    print(f"   toppers.json: {len(t_list)} toppers")

    # Links
    with open(OUT / "links.json", "w") as f:
        json.dump(topper_links, f, indent=2, ensure_ascii=False)
    print(f"   links.json: {len(topper_links)} question→topper mappings")

    # Cross-section links
    with open(OUT / "cross_links.json", "w") as f:
        json.dump(all_cross_links, f, indent=2, ensure_ascii=False)
    print(f"   cross_links.json: {len(all_cross_links)} cross-section links")

    # Index
    index = {
        "total_questions": len(all_questions),
        "total_toppers": len(toppers),
        "total_links": len(topper_links),
        "total_cross_links": len(all_cross_links),
        "total_ocr_copies": len(ocr_index),
        "sections": {},
    }
    for q in q_list:
        sec = q.get("subject", "Unknown")
        index["sections"][sec] = index["sections"].get(sec, 0) + 1

    with open(OUT / "index.json", "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    print(f"   index.json: summary")

    # ── Stats ──
    print(f"\n{'=' * 50}")
    print(f"Relational Database Complete!")
    print(f"{'=' * 50}")
    print(f"Questions:  {len(all_questions):,}")
    print(f"Toppers:    {len(toppers):,}")
    print(f"Links:      {len(topper_links):,}")
    print(f"Cross-refs: {len(all_cross_links):,}")
    print(f"OCR copies: {len(ocr_index):,}")
    print(f"\nBy section:")
    for sec, count in sorted(index["sections"].items(), key=lambda x: -x[1]):
        print(f"  {sec}: {count:,}")
    print(f"\n📁 Output: data/relational/")


if __name__ == "__main__":
    main()
