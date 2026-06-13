#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, ".cloudflare-runtime-data");
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");
const DEFAULT_PREFIX = process.env.UPSCAT_RUNTIME_DATA_PREFIX || "runtime/v1";

const INPUTS = [
  { key: "public-pyqs", path: "data/app/public-pyqs.json", shard: "array:cards", maxBytes: 4 * 1024 * 1024 },
  { key: "public-official-pyq-links", path: "data/app/public-official-pyq-links.json", shard: "record:links", maxBytes: 4 * 1024 * 1024 },
  { key: "workspace-index", path: "data/app/workspace-index.json", shard: "array:questions", maxBytes: 4 * 1024 * 1024 },
  { key: "topper-answer-canonical", path: "data/app/topper-answer-canonical.json", shard: "array:records", maxBytes: 4 * 1024 * 1024 },
  { key: "answer-sources", path: "data/pdf-runtime/answer-sources.json", shard: "copy", maxBytes: 4 * 1024 * 1024, private: true },
  { key: "pdf-r2-map", path: "data/pdf-runtime/pdf-r2-map.json", shard: "copy", maxBytes: 4 * 1024 * 1024, private: true },
];

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  prefix: DEFAULT_PREFIX,
  datasets: {},
};

for (const input of INPUTS) {
  const absolute = join(ROOT, input.path);
  const data = JSON.parse(readFileSync(absolute, "utf8"));
  const datasetDir = join(OUT_DIR, input.key);
  mkdirSync(datasetDir, { recursive: true });

  if (input.shard === "copy") {
    const file = join(datasetDir, basename(input.path));
    writeJson(file, data);
    manifest.datasets[input.key] = datasetManifest(input, [{ file, count: objectSize(data) }]);
    continue;
  }

  const [kind, property] = input.shard.split(":");
  const collection = data[property];
  if (kind === "array") {
    manifest.datasets[input.key] = datasetManifest(input, shardArray(datasetDir, collection, input.maxBytes));
  } else if (kind === "record") {
    manifest.datasets[input.key] = datasetManifest(input, shardRecord(datasetDir, collection, input.maxBytes));
  } else {
    throw new Error(`Unknown shard mode ${input.shard}`);
  }

  const metadata = { ...data };
  delete metadata[property];
  writeJson(join(datasetDir, "metadata.json"), metadata);
}

writeJson(MANIFEST_PATH, manifest);
console.log(`Prepared Cloudflare runtime data at ${OUT_DIR}`);
console.log(`Manifest: ${MANIFEST_PATH}`);
for (const [key, dataset] of Object.entries(manifest.datasets)) {
  console.log(`${key}: ${dataset.count} records in ${dataset.shards.length} shard(s), ${formatBytes(dataset.bytes)}`);
}

function shardArray(dir, items, maxBytes) {
  if (!Array.isArray(items)) throw new Error(`Expected array collection in ${dir}`);
  const shards = [];
  let current = [];
  let currentBytes = 2;
  for (const item of items) {
    const itemBytes = byteLength(item) + (current.length ? 1 : 0);
    if (current.length && currentBytes + itemBytes > maxBytes) {
      shards.push(writeShard(dir, shards.length, current));
      current = [];
      currentBytes = 2;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length) shards.push(writeShard(dir, shards.length, current));
  return shards;
}

function shardRecord(dir, record, maxBytes) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Expected object collection in ${dir}`);
  const shards = [];
  let current = {};
  let currentBytes = 2;
  for (const [key, value] of Object.entries(record)) {
    const entryBytes = Buffer.byteLength(JSON.stringify(key)) + 1 + byteLength(value) + (Object.keys(current).length ? 1 : 0);
    if (Object.keys(current).length && currentBytes + entryBytes > maxBytes) {
      shards.push(writeShard(dir, shards.length, current));
      current = {};
      currentBytes = 2;
    }
    current[key] = value;
    currentBytes += entryBytes;
  }
  if (Object.keys(current).length) shards.push(writeShard(dir, shards.length, current));
  return shards;
}

function writeShard(dir, index, value) {
  const file = join(dir, `${String(index).padStart(4, "0")}.json`);
  writeJson(file, value);
  return { file, count: objectSize(value) };
}

function datasetManifest(input, shards) {
  const entries = shards.map((shard) => {
    const relative = shard.file.slice(OUT_DIR.length + 1).replaceAll("\\", "/");
    const bytes = statSync(shard.file).size;
    return {
      key: `${DEFAULT_PREFIX}/${relative}`,
      file: relative,
      bytes,
      sha256: sha256(readFileSync(shard.file)),
      count: shard.count,
    };
  });
  return {
    source: input.path,
    mode: input.shard,
    private: Boolean(input.private),
    count: entries.reduce((sum, entry) => sum + entry.count, 0),
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    shards: entries,
  };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function objectSize(value) {
  return Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 1;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
