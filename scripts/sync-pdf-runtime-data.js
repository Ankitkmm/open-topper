#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, "data", "app");
const TARGET_DIR = path.join(ROOT, "data", "pdf-runtime");
const FILES = [
  { name: "answer-sources.json", validate: validateAnswerSources },
  { name: "pdf-r2-map.json", validate: validatePdfR2Map },
];

function main() {
  ensureSafeRuntimeTarget(TARGET_DIR);
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  for (const file of FILES) {
    syncRuntimeFile(file);
  }
}

function syncRuntimeFile(file) {
  const source = path.join(SOURCE_DIR, file.name);
  const target = path.join(TARGET_DIR, file.name);

  if (fs.existsSync(source)) {
    const sourceText = readAndValidateJson(source, file.validate);
    writeIfChanged(target, sourceText);
    console.log(`synced ${path.relative(ROOT, target)}`);
    return;
  }

  if (fs.existsSync(target)) {
    readAndValidateJson(target, file.validate);
    console.warn(
      `source missing for ${file.name}; keeping validated ${path.relative(ROOT, target)}`,
    );
    return;
  }

  throw new Error(
    `Missing source runtime file and fallback target: ${source} -> ${target}`,
  );
}

function readAndValidateJson(file, validate) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${error.message}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(ROOT, file)}: ${error.message}`);
  }

  validate(json, file);
  return text;
}

function writeIfChanged(target, text) {
  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target, "utf8");
    if (current === text) return;
  }

  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      // Best-effort temp cleanup only.
    }
    throw error;
  }
}

function validateAnswerSources(json, file) {
  const label = path.relative(ROOT, file);
  if (!isPlainObject(json)) throw new Error(`${label} must be a JSON object.`);
  if (!isPlainObject(json.sources)) throw new Error(`${label} must contain a sources object.`);

  const sourceEntries = Object.entries(json.sources);
  if (typeof json.count === "number" && json.count !== sourceEntries.length) {
    throw new Error(`${label} count (${json.count}) does not match sources length (${sourceEntries.length}).`);
  }

  for (const [answerId, record] of sourceEntries) {
    if (!/^ans_[a-f0-9]{16}$/.test(answerId)) {
      throw new Error(`${label} has invalid answer id key: ${answerId}`);
    }
    if (!isPlainObject(record)) {
      throw new Error(`${label}.${answerId} must be an object.`);
    }

    const url = typeof record.url === "string" ? record.url.trim() : "";
    if (!url) continue;
    if (!isAllowedRuntimePdfUrl(url)) {
      throw new Error(`${label}.${answerId}.url must be an R2 URL, not ${redactUrl(url)}.`);
    }
    if (record.page != null && (!Number.isFinite(Number(record.page)) || Number(record.page) < 1)) {
      throw new Error(`${label}.${answerId}.page must be a positive page number when present.`);
    }
  }
}

function validatePdfR2Map(json, file) {
  const label = path.relative(ROOT, file);
  if (!isPlainObject(json)) throw new Error(`${label} must be a JSON object.`);

  for (const [sourceKey, url] of Object.entries(json)) {
    if (typeof url !== "string" || !url.trim()) {
      throw new Error(`${label}.${sourceKey} must map to a non-empty string URL.`);
    }
    if (!isAllowedRuntimePdfUrl(url)) {
      throw new Error(`${label}.${sourceKey} must be an R2 URL, not ${redactUrl(url)}.`);
    }
  }
}

function ensureSafeRuntimeTarget(targetDir) {
  const relative = path.relative(ROOT, targetDir);
  if (relative !== path.join("data", "pdf-runtime")) {
    throw new Error(`Refusing to sync PDF runtime data outside data/pdf-runtime/: ${targetDir}`);
  }
  if (relative === "public" || relative.startsWith(`public${path.sep}`)) {
    throw new Error(`Refusing to sync PDF runtime data into public/: ${targetDir}`);
  }
}

function isAllowedRuntimePdfUrl(url) {
  return /^https:\/\/[^\s/]+\.r2\.dev\//i.test(url)
    || /^https:\/\/[^\s/]+\.r2\.cloudflarestorage\.com\//i.test(url);
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/…`;
  } catch {
    return String(url).slice(0, 120);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (require.main === module) {
  main();
}

module.exports = {
  isAllowedRuntimePdfUrl,
  validateAnswerSources,
  validatePdfR2Map,
};
