/**
 * upload-pdfs.js
 *
 * Uploads all local PDFs from public/pdfs/ to Cloudflare R2.
 * Tracks mapping: Google Drive file ID → R2 public URL.
 * RESUME-SAFE: skips files already uploaded.
 *
 * Usage: node scripts/upload-pdfs.js
 */

require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const path = require("path");
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const PDFS_DIR = path.join(__dirname, "..", "local-pdfs");
const MAP_FILE = path.join(
  __dirname,
  "..",
  "public",
  "data",
  "pdf-r2-map.json",
);
const BATCH_SIZE = 25;

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL.replace(/\/$/, "");

function extractFileId(filename) {
  return filename.replace(/\.pdf$/i, "").replace(/^drive_/, "");
}

function canonicalR2Key(filename, fileId) {
  const safeId = String(fileId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 96);
  return `sources/${safeId || extractFileId(filename)}.pdf`;
}

function loadMap() {
  try {
    if (fs.existsSync(MAP_FILE))
      return JSON.parse(fs.readFileSync(MAP_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveMap(map) {
  fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
}

async function uploadOne(filePath, filename, fileId, map) {
  const r2Key = canonicalR2Key(filename, fileId);

  // Skip if already uploaded
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: r2Key }));
    map[fileId] = `${PUBLIC_URL}/${r2Key}`;
    return "skipped";
  } catch {}

  const fileSize = fs.statSync(filePath).size;
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: r2Key,
      Body: fs.createReadStream(filePath),
      ContentType: "application/pdf",
      ContentDisposition: "inline",
    },
  });

  upload.on("httpUploadProgress", (p) => {
    if (p.total)
      process.stdout.write(
        `\r   ⬆  ${filename}: ${Math.round((p.loaded / p.total) * 100)}%`,
      );
  });

  await upload.done();
  map[fileId] = `${PUBLIC_URL}/${r2Key}`;
  process.stdout.write(
    `\r   ✅ ${filename} (${(fileSize / 1024 / 1024).toFixed(1)}MB)\n`,
  );
  return "uploaded";
}

async function main() {
  console.log("🚀 Cloudflare R2 Uploader\n");

  if (!fs.existsSync(PDFS_DIR)) {
    console.error("❌ public/pdfs/ not found");
    process.exit(1);
  }

  const files = fs
    .readdirSync(PDFS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((name) => ({
      name,
      path: path.join(PDFS_DIR, name),
      id: extractFileId(name),
    }));

  console.log(`📁 ${files.length} PDFs to upload`);
  const totalGB = (
    files.reduce((s, f) => s + fs.statSync(f.path).size, 0) /
    1024 /
    1024 /
    1024
  ).toFixed(1);
  console.log(`📦 ${totalGB}GB total\n`);

  const map = loadMap();
  if (Object.keys(map).length)
    console.log(`📋 Resuming: ${Object.keys(map).length} already mapped\n`);

  let up = 0,
    sk = 0,
    fl = 0;
  const start = Date.now();

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((f) => uploadOne(f.path, f.name, f.id, map)),
    );

    for (const r of results) {
      if (r.status === "fulfilled") r.value === "uploaded" ? up++ : sk++;
      else {
        fl++;
        console.error(`   ❌ ${r.reason?.message}`);
      }
    }

    saveMap(map);
    const done = up + sk + fl;
    console.log(
      `   📊 ${done}/${files.length} (${Math.round((done / files.length) * 100)}%) | ✅${up} ⏭${sk} ❌${fl}\n`,
    );
  }

  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(
    `\n🎉 Done! ✅${up} ⏭${sk} ❌${fl} | ${mins}min | ${PUBLIC_URL}/`,
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
