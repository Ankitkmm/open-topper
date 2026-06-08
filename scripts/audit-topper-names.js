#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  path.join(ROOT, "data", "app", "public-official-pyq-links.json"),
  path.join(ROOT, "data", "app", "public-pyqs.json"),
  path.join(ROOT, "data", "app", "workspace-index.json"),
];

const BAD_LABELS = [
  "Copies",
  "Anthro Tribal",
  "Pub Admn",
  "Public Administration",
  "Guidance IAS",
  "EvaluatedCopy",
  "Evaluated",
  "MTS NL FLT",
  "TSM SOC NICE IAS",
  "Checked",
  "Sent",
  "Scan",
];

const BAD_PATTERNS = BAD_LABELS.map((label) => ({ label, pattern: new RegExp(`^${escapeRegExp(label)}$`, "i") }));
const FALLBACK_NAMES = new Set(["", "topper copy", "anonymous topper", "unknown topper", "mapped topper", "name unavailable"]);

function main() {
  const totals = { named: 0, anonymous: 0, suppressed: 0, records: 0 };
  const bySubject = {};
  const badPublicNames = new Map();

  for (const file of FILES) {
    if (!fs.existsSync(file)) continue;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const record of extractRecords(payload, path.basename(file))) {
      const name = clean(record.topperName);
      const subject = clean(record.subject || record.category || record.paper || "unknown") || "unknown";
      const bucket = bySubject[subject] ||= { named: 0, anonymous: 0, suppressed: 0, records: 0 };
      totals.records += 1;
      bucket.records += 1;

      const badLabel = badLabelFor(name);
      if (badLabel) {
        totals.suppressed += 1;
        bucket.suppressed += 1;
        const key = `${record.file}:${badLabel}:${name}`;
        badPublicNames.set(key, (badPublicNames.get(key) || 0) + 1);
      } else if (FALLBACK_NAMES.has(name.toLowerCase())) {
        totals.anonymous += 1;
        bucket.anonymous += 1;
      } else {
        totals.named += 1;
        bucket.named += 1;
      }
    }
  }

  const report = {
    totals,
    bySubject,
    badPublicNames: [...badPublicNames.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, 50),
  };

  console.log(JSON.stringify(report, null, 2));
  if (badPublicNames.size) {
    console.error("FAIL: known non-person labels appear as public topper names.");
    process.exit(1);
  }
  console.log("PASS: no known bad topper labels appear in public DTO/generated JSON names.");
}

function* extractRecords(payload, file) {
  if (payload && payload.links && typeof payload.links === "object") {
    for (const [questionId, links] of Object.entries(payload.links)) {
      for (const link of Array.isArray(links) ? links : []) yield { ...link, questionId, file };
    }
  }

  for (const card of Array.isArray(payload?.cards) ? payload.cards : []) {
    for (const copy of Array.isArray(card.linkedInsights) ? card.linkedInsights : []) {
      yield { ...copy, subject: card.subjectKey, category: card.category, paper: card.paper, file };
    }
  }

  for (const question of Array.isArray(payload?.questions) ? payload.questions : []) {
    for (const copy of Array.isArray(question.linkedInsights) ? question.linkedInsights : []) {
      yield { ...copy, subject: question.subjectKey, category: question.category, paper: question.paper, file };
    }
  }
}

function badLabelFor(value) {
  if (!value) return "";
  for (const { label, pattern } of BAD_PATTERNS) {
    if (pattern.test(value)) return label;
  }
  return "";
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
