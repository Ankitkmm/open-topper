#!/usr/bin/env node
/*
 * Guardrail for the public/client data boundary.
 *
 * Server-only runtime PDF maps intentionally live under data/pdf-runtime and may
 * contain R2 URLs. This script deliberately scans only public/static/client
 * surfaces plus the two public app JSON datasets.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const includeBuild = args.has("--include-build") || process.env.CHECK_PUBLIC_LEAKS_INCLUDE_BUILD === "1";

const PUBLIC_JSON_FILES = [
  "data/app/public-pyqs.json",
  "data/app/public-official-pyq-links.json",
];

const TEXT_EXTENSIONS = new Set([
  "", ".css", ".csv", ".html", ".js", ".json", ".mjs", ".rsc", ".svg", ".txt", ".xml",
]);

const BUILD_STATIC_ARTIFACT_EXTENSIONS = new Set([
  ".body", ".css", ".html", ".js", ".json", ".meta", ".mjs", ".rsc", ".txt",
]);

const FORBIDDEN_TEXT_PATTERNS = [
  { name: "Cloudflare R2 public URL/domain", pattern: /\br2\.dev\b/i },
  { name: "Cloudflare R2 storage URL/domain", pattern: /\br2\.cloudflarestorage\.com\b/i },
  { name: "Google Drive URL/domain", pattern: /\bdrive\.google\.com\b/i },
  { name: "absolute macOS user path", pattern: /\/Users\// },
  { name: "absolute macOS volume path", pattern: /\/Volumes\// },
  { name: "local PDF corpus path", pattern: /\blocal-pdfs\b/i },
  { name: "raw full-answer markdown key", pattern: /"full_answer_markdown"\s*:/i },
  { name: "raw OCR markdown key", pattern: /"ocr_markdown"\s*:/i },
  { name: "raw OCR camelCase key", pattern: /"rawOcr"\s*:/i },
  { name: "raw OCR snake_case key", pattern: /"raw_ocr"\s*:/i },
  { name: "full markdown key", pattern: /"fullMarkdown"\s*:/i },
  { name: "workspace private searchText key", pattern: /"searchText"\s*:/ },
];

const FORBIDDEN_PUBLIC_JSON_KEYS = new Set([
  "searchText",
  "sourceUrl",
  "sourceCdnUrl",
  "sourcePath",
  "localPdfPath",
  "sourceDriveId",
  "sourceFilename",
  "originalFilename",
  "cleanFilename",
  "filename",
  "full_answer_markdown",
  "full_answer_markdown_source",
  "ocr_markdown",
  "rawOcr",
  "raw_ocr",
  "fullMarkdown",
  "hiddenSummary",
  "rawSummary",
  "fullSummary",
  "longSummary",
]);

const LONG_PUBLIC_STRING_WARN_CHARS = Number(process.env.PUBLIC_LEAK_LONG_STRING_WARN_CHARS || 12_000);

function main() {
  const violations = [];
  const warnings = [];

  scanDirectory(path.join(ROOT, "public"), {
    label: "public/",
    extensions: TEXT_EXTENSIONS,
    jsonKeys: true,
    violations,
    warnings,
  });

  for (const rel of PUBLIC_JSON_FILES) {
    scanFile(path.join(ROOT, rel), {
      label: rel,
      jsonKeys: true,
      required: true,
      violations,
      warnings,
    });
  }

  if (includeBuild) {
    scanDirectory(path.join(ROOT, ".next", "static"), {
      label: ".next/static/",
      extensions: BUILD_STATIC_ARTIFACT_EXTENSIONS,
      jsonKeys: false,
      violations,
      warnings,
      optional: true,
    });

    scanDirectory(path.join(ROOT, ".next", "server", "app"), {
      label: ".next/server/app static payloads",
      extensions: new Set([".body", ".html", ".json", ".meta", ".rsc", ".txt"]),
      jsonKeys: true,
      violations,
      warnings,
      optional: true,
    });
  }

  for (const warning of warnings.slice(0, 20)) {
    console.warn(`[public-leak-check] warning: ${warning}`);
  }
  if (warnings.length > 20) {
    console.warn(`[public-leak-check] warning: ${warnings.length - 20} additional warnings omitted.`);
  }

  if (violations.length) {
    console.error("Public/client PDF data boundary check failed:");
    for (const violation of violations.slice(0, 50)) {
      console.error(`- ${violation}`);
    }
    if (violations.length > 50) {
      console.error(`- ${violations.length - 50} additional violations omitted.`);
    }
    console.error("\nServer-only runtime maps under data/pdf-runtime/ are intentionally not scanned as public assets.");
    process.exitCode = 1;
    return;
  }

  const buildSuffix = includeBuild ? " + build static payloads" : "";
  console.log(`Public/client PDF leak check passed (${PUBLIC_JSON_FILES.join(", ")}, public/${buildSuffix}).`);
}

function scanDirectory(dir, options) {
  if (!fs.existsSync(dir)) {
    if (!options.optional) {
      options.warnings.push(`${options.label || relativePath(dir)} does not exist; skipped.`);
    }
    return;
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    options.violations.push(`${relativePath(dir)} is expected to be a directory.`);
    return;
  }

  for (const file of walkFiles(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (!options.extensions.has(ext)) continue;
    scanFile(file, options);
  }
}

function scanFile(file, options) {
  if (!fs.existsSync(file)) {
    if (options.required) options.violations.push(`${options.label || relativePath(file)} is missing.`);
    return;
  }

  const stat = fs.statSync(file);
  if (!stat.isFile()) return;

  const rel = relativePath(file);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    options.violations.push(`${rel}: could not be read as UTF-8 (${error.message}).`);
    return;
  }

  for (const rule of FORBIDDEN_TEXT_PATTERNS) {
    const match = rule.pattern.exec(text);
    if (match) {
      options.violations.push(`${rel}:${lineForIndex(text, match.index)} contains ${rule.name}.`);
    }
  }

  if (!options.jsonKeys || path.extname(file).toLowerCase() !== ".json") return;

  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    options.violations.push(`${rel}: invalid JSON (${error.message}).`);
    return;
  }

  scanJsonValue(json, {
    rel,
    path: "$",
    violations: options.violations,
    warnings: options.warnings,
  });
}

function scanJsonValue(value, context) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJsonValue(item, { ...context, path: `${context.path}[${index}]` }));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${context.path}.${key}`;
      if (FORBIDDEN_PUBLIC_JSON_KEYS.has(key)) {
        context.violations.push(`${context.rel}:${childPath} uses forbidden public JSON key "${key}".`);
      }
      scanJsonValue(child, { ...context, path: childPath });
    }
    return;
  }

  if (typeof value !== "string") return;

  if (value.length > LONG_PUBLIC_STRING_WARN_CHARS) {
    context.warnings.push(`${context.rel}:${context.path} is a very long public string (${value.length.toLocaleString()} chars).`);
  }
}

function* walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function lineForIndex(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function relativePath(file) {
  const rel = path.relative(ROOT, file);
  return rel && !rel.startsWith("..") ? rel : file;
}

if (require.main === module) {
  main();
}

module.exports = {
  FORBIDDEN_PUBLIC_JSON_KEYS,
  FORBIDDEN_TEXT_PATTERNS,
};
