#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "data", "app", "public-official-pyq-links.json");

const TOP_LEVEL_FLOORS = {
  officialQuestionCount: 900,
  linkedQuestionCount: 800,
  linkedCopyCount: 15000,
  sourceAvailableCount: 12000,
};

const CATEGORY_FLOORS = {
  "GS 1": 1000,
  "GS 2": 3000,
  "GS 3": 2000,
  "GS 4": 100,
  Essay: 3,
};

function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const links = Object.values(data.links || {}).flat();
  const byType = {};
  const byCategory = {};

  for (const link of links) {
    const type = link.matchType || "unknown";
    const category = link.category || link.paper || "unknown";
    byType[type] = (byType[type] || 0) + 1;
    byCategory[category] = (byCategory[category] || 0) + 1;
  }

  const metrics = {
    generatedAt: data.generatedAt,
    officialQuestionCount: Number(data.officialQuestionCount || 0),
    linkedQuestionCount: Number(data.linkedQuestionCount || 0),
    linkedCopyCount: Number(data.linkedCopyCount || 0),
    sourceAvailableCount: Number(data.sourceAvailableCount || 0),
    byType,
    byCategory,
  };

  const failures = [];
  for (const [key, floor] of Object.entries(TOP_LEVEL_FLOORS)) {
    if (metrics[key] < floor) failures.push(`${key}=${metrics[key]} below floor ${floor}`);
  }
  for (const [category, floor] of Object.entries(CATEGORY_FLOORS)) {
    const actual = Number(byCategory[category] || 0);
    if (actual < floor) failures.push(`${category} linked copies=${actual} below floor ${floor}`);
  }

  console.log(JSON.stringify(metrics, null, 2));
  if (failures.length) {
    console.error("FAIL: official PYQ link health floors were not met:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("PASS: official PYQ link health floors are met.");
}

main();
