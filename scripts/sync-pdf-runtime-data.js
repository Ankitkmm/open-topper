const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "data", "app");
const TARGET_DIR = path.join(ROOT, "data", "pdf-runtime");
const FILES = ["answer-sources.json", "pdf-r2-map.json"];

fs.mkdirSync(TARGET_DIR, { recursive: true });

for (const file of FILES) {
  const source = path.join(SOURCE_DIR, file);
  const target = path.join(TARGET_DIR, file);

  if (!fs.existsSync(source)) {
    throw new Error(`Missing source runtime file: ${source}`);
  }

  fs.copyFileSync(source, target);
  console.log(`synced ${path.relative(ROOT, target)}`);
}
