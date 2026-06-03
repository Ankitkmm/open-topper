#!/usr/bin/env python3
"""
parse_gs1_dump.py
==================
Loads raw_gs1_network_dump.json (intercepted from UPSC Path Network tab),
parses it according to strict relational integrity rules, and outputs
clean gs1_mapped.jsonl with one line per topper answer.

Relational Rules Applied:
  1. Resolves ID-based foreign keys across separated arrays in the payload
  2. Explodes one-to-many (one question → multiple toppers = multiple lines)
  3. Drops orphan records (no question text, no topper name, no PDF link)
  4. Appends base domain to relative PDF paths
  5. Escapes special JSON characters in text fields
  6. Strips HTML tags from question text, keeps text verbatim

Usage:
  python3 scripts/parse_gs1_dump.py
"""

import json
import os
import re
import sys
from urllib.parse import urljoin

# ═══════════════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════════════

INPUT_FILE = "raw_gs1_network_dump.json"
OUTPUT_FILE = "gs1_mapped.jsonl"
BASE_DOMAIN = "https://upscpath.com"

# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════


def load_json(path):
    """Load a JSON file from disk."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def strip_html(text):
    """Remove HTML tags, keep text verbatim."""
    if not text or not isinstance(text, str):
        return text
    return re.sub(r"<[^>]+>", "", text).strip()


def escape_json(s):
    """Escape special characters to produce valid JSON strings."""
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
    """Convert relative URLs to absolute using the base domain."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return urljoin(BASE_DOMAIN, url)


def get_nested(obj, *keys):
    """Safely traverse nested dicts/objects. Returns None if any key is missing."""
    for key in keys:
        if isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return None
        if obj is None:
            return None
    return obj


def is_valid_entry(question, topper_name, pdf_link):
    """Reject entries missing any of the three required fields."""
    if not question or not isinstance(question, str) or not question.strip():
        return False
    if not topper_name or not isinstance(topper_name, str) or not topper_name.strip():
        return False
    # Allow empty pdf_link (will be written as "")
    return True


# ═══════════════════════════════════════════════════════════════════════════
# PARSERS — handle different payload structures
# ═══════════════════════════════════════════════════════════════════════════


def parse_flat_array(data):
    """Payload is a flat array of {question, topper_name, pdf_link} objects."""
    entries = []
    seen = set()

    items = (
        data if isinstance(data, list) else data.get("data", data.get("results", []))
    )
    if not isinstance(items, list):
        items = [items]

    for item in items:
        q = strip_html(
            item.get("question") or item.get("question_text") or item.get("text") or ""
        )
        t = (
            item.get("topper_name")
            or item.get("name")
            or item.get("student_name")
            or ""
        )
        p = make_absolute(
            item.get("pdf_link")
            or item.get("pdf_url")
            or item.get("copy_url")
            or item.get("link")
            or ""
        )

        if is_valid_entry(q, t, p):
            dedupe = f"{q}|{t}|{p}"
            if dedupe not in seen:
                seen.add(dedupe)
                entries.append(
                    {
                        "question": escape_json(q),
                        "topper_name": escape_json(t.strip()),
                        "pdf_link": p,
                    }
                )

    return entries


def parse_relational(data):
    """
    Payload has separated arrays:
      data["questions"] → [{id, text, ...}]
      data["topper_answers"] → [{question_id, topper_name, pdf_url, ...}]
    Perform a relational JOIN on question_id.
    """
    entries = []
    seen = set()

    questions_raw = data.get("questions") or data.get("pyqs") or []
    answers_raw = (
        data.get("topper_answers")
        or data.get("answers")
        or data.get("copies")
        or data.get("topper_copies")
        or []
    )

    # Build question lookup by ID
    q_lookup = {}
    for q in questions_raw:
        qid = str(q.get("id") or q.get("_id") or q.get("question_id") or "")
        qtext = strip_html(
            q.get("question")
            or q.get("question_text")
            or q.get("text")
            or q.get("title")
            or ""
        )
        if qid and qtext:
            q_lookup[qid] = qtext

    # Join answers to questions
    for ans in answers_raw:
        qid = str(
            ans.get("question_id")
            or ans.get("pyq_id")
            or ans.get("q_id")
            or ans.get("questionId")
            or ""
        )
        qtext = q_lookup.get(qid, "")
        tname = (
            ans.get("topper_name")
            or ans.get("name")
            or ans.get("student_name")
            or ans.get("topperName")
            or ""
        )
        pdf = make_absolute(
            ans.get("pdf_url")
            or ans.get("pdf_link")
            or ans.get("copy_url")
            or ans.get("link")
            or ans.get("url")
            or ""
        )

        if is_valid_entry(qtext, tname, pdf):
            dedupe = f"{qtext}|{tname}|{pdf}"
            if dedupe not in seen:
                seen.add(dedupe)
                entries.append(
                    {
                        "question": escape_json(qtext),
                        "topper_name": escape_json(tname.strip()),
                        "pdf_link": pdf,
                    }
                )

    return entries


def parse_nested_topics(data):
    """
    Payload is organized by topic/syllabus:
      data["syllabus"] → [{topic, pyqs: [{question, topper_answers: [...]}]}]
    """
    entries = []
    seen = set()

    topics = data.get("syllabus") or data.get("topics") or data.get("papers") or []
    if isinstance(topics, dict):
        topics = list(topics.values())

    for topic in topics:
        if isinstance(topic, str):
            continue
        pyqs = topic.get("pyqs") or topic.get("questions") or []
        for pyq in pyqs:
            qtext = strip_html(
                pyq.get("question") or pyq.get("question_text") or pyq.get("text") or ""
            )
            answers = (
                pyq.get("topper_answers")
                or pyq.get("answers")
                or pyq.get("copies")
                or pyq.get("topper_copies")
                or []
            )
            for ans in answers:
                tname = (
                    ans.get("topper_name")
                    or ans.get("name")
                    or ans.get("student_name")
                    or ""
                )
                pdf = make_absolute(
                    ans.get("pdf_url")
                    or ans.get("pdf_link")
                    or ans.get("copy_url")
                    or ans.get("link")
                    or ans.get("url")
                    or ""
                )

                if is_valid_entry(qtext, tname, pdf):
                    dedupe = f"{qtext}|{tname}|{pdf}"
                    if dedupe not in seen:
                        seen.add(dedupe)
                        entries.append(
                            {
                                "question": escape_json(qtext),
                                "topper_name": escape_json(tname.strip()),
                                "pdf_link": pdf,
                            }
                        )

    return entries


def parse_generic(data):
    """Recursively walk any JSON structure looking for question/topper/pdf patterns."""
    entries = []
    seen = set()

    def walk(obj, parent_question=None):
        if isinstance(obj, dict):
            # Check if this dict looks like a topper answer
            tname = (
                obj.get("topper_name")
                or obj.get("name")
                or obj.get("student_name")
                or obj.get("topperName")
                or ""
            )
            pdf = make_absolute(
                obj.get("pdf_url")
                or obj.get("pdf_link")
                or obj.get("copy_url")
                or obj.get("link")
                or obj.get("url")
                or ""
            )
            qtext = strip_html(
                obj.get("question")
                or obj.get("question_text")
                or obj.get("text")
                or parent_question
                or ""
            )

            if tname and pdf and qtext:
                if is_valid_entry(qtext, tname, pdf):
                    dedupe = f"{qtext}|{tname}|{pdf}"
                    if dedupe not in seen:
                        seen.add(dedupe)
                        entries.append(
                            {
                                "question": escape_json(qtext),
                                "topper_name": escape_json(tname.strip()),
                                "pdf_link": pdf,
                            }
                        )

            # Track the question context as we recurse
            current_q = qtext if qtext else parent_question
            for v in obj.values():
                walk(v, current_q)

        elif isinstance(obj, list):
            for item in obj:
                walk(item, parent_question)

    walk(data)
    return entries


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════


def main():
    # Resolve input path relative to the project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    input_path = os.path.join(project_root, INPUT_FILE)
    output_path = os.path.join(project_root, OUTPUT_FILE)

    if not os.path.exists(input_path):
        print(f"❌ Input file not found: {input_path}")
        print(f"   Place your intercepted JSON dump as: {INPUT_FILE}")
        print(f"   (in the project root directory)")
        sys.exit(1)

    print(f"📖 Loading {INPUT_FILE}...")
    data = load_json(input_path)

    # Detect payload structure and parse accordingly
    entries = []

    if isinstance(data, list):
        print("   Detected: flat array")
        entries = parse_flat_array(data)

    elif isinstance(data, dict):
        # Check for relational structure (separated questions + answers arrays)
        has_questions = bool(data.get("questions") or data.get("pyqs"))
        has_answers = bool(
            data.get("topper_answers")
            or data.get("answers")
            or data.get("copies")
            or data.get("topper_copies")
        )

        if has_questions and has_answers:
            print("   Detected: relational (questions + topper_answers arrays)")
            entries = parse_relational(data)

        elif data.get("syllabus") or data.get("topics") or data.get("papers"):
            print("   Detected: nested topics/papers")
            entries = parse_nested_topics(data)

        elif data.get("data") or data.get("results"):
            print("   Detected: wrapped response")
            inner = data.get("data") or data.get("results")
            if isinstance(inner, list):
                entries = parse_flat_array(inner)
            elif isinstance(inner, dict):
                entries = parse_relational(inner) or parse_nested_topics(inner)

        # Fallback: generic recursive walk
        if not entries:
            print("   Detected: unknown structure → using generic recursive parser")
            entries = parse_generic(data)

    # Write output
    with open(output_path, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"\n✅ Done!")
    print(f"   Entries written: {len(entries)}")
    print(f"   Output file:     {OUTPUT_FILE}")

    if entries:
        print(f"\n📋 First 3 lines:")
        for entry in entries[:3]:
            print(f"   {json.dumps(entry, ensure_ascii=False)[:140]}")

    if not entries:
        print(f"\n⚠️  No entries extracted. The payload structure may not match")
        print(f"   any known pattern. Dump the first 500 chars of your file:")
        print(f"   head -c 500 {INPUT_FILE}")


if __name__ == "__main__":
    main()
