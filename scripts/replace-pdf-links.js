/**
 * replace-pdf-links.js
 *
 * Scans public/pdfs/ for local PDF files and replaces Google Drive URLs
 * in questions.json with local /pdfs/... paths.
 *
 * Usage: node scripts/replace-pdf-links.js
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const PDFS_DIR = path.join(PROJECT_ROOT, "public", "pdfs");
const QUESTIONS_FILE = path.join(PROJECT_ROOT, "public", "data", "questions.json");
const QUESTIONS_BAK = path.join(PROJECT_ROOT, "public", "data", "questions.json.bak");

// ─── Build map: Google Drive file ID → local /pdfs/ path ──────────────────
function buildPdfMap() {
  const map = new Map();
  if (!fs.existsSync(PDFS_DIR)) return map;

  const entries = fs.readdirSync(PDFS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith(".pdf")) continue;

    const relativePath = "/pdfs/" + entry.name;

    // Strip ".pdf" extension and "drive_" prefix to get the Google Drive file ID
    const nameNoExt = entry.name.replace(/\.pdf$/i, "");
    const cleanId = nameNoExt.replace(/^drive_/, "");

    // Index by: clean file ID, full URL, and also the raw filename (for non-drive files)
    map.set(cleanId.toLowerCase(), relativePath);
    map.set(
      `https://drive.google.com/file/d/${cleanId}/view`.toLowerCase(),
      relativePath,
    );
    // Also index by filename without extension (for non-drive-named files)
    map.set(nameNoExt.toLowerCase(), relativePath);
  }

  return map;
}

function replaceLinks(link, pdfMap) {
  if (!link || typeof link !== "string") return link;

  // Already a local path?
  if (link.startsWith("/pdfs/")) return link;

  // Try direct map lookup
  const lower = link.toLowerCase().trim();
  if (pdfMap.has(lower)) return pdfMap.get(lower);

  // Extract Google Drive file ID from URL
  const m = link.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) {
    const fileId = m[1].toLowerCase();
    if (pdfMap.has(fileId)) return pdfMap.get(fileId);
    // Also try with drive_ prefix
    if (pdfMap.has("drive_" + fileId)) return pdfMap.get("drive_" + fileId);
  }

  return link; // No match found, keep original
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  console.log("🔍 Scanning local PDFs in public/pdfs/...");
  const pdfMap = buildPdfMap();
  console.log(`   Found ${pdfMap.size} index entries`);

  if (pdfMap.size === 0) {
    console.log("⚠️  No PDFs found in public/pdfs/. Nothing to do.");
    return;
  }

  console.log("📖 Reading questions.json...");
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf-8"));

  let totalReplaced = 0;
  let totalToppers = 0;

  for (const question of questions) {
    for (const topper of question.toppers) {
      totalToppers++;
      const oldLink = topper.links;
      const newLink = replaceLinks(topper.links, pdfMap);
      if (newLink !== oldLink) {
        topper.links = newLink;
        totalReplaced++;
      }
    }
  }

  console.log(`📊 Total toppers: ${totalToppers}`);
  console.log(`✅ Replaced: ${totalReplaced} links → local /pdfs/ paths`);

  if (totalReplaced === 0) {
    console.log("⚠️  No matches found. Check if PDF filenames contain the Google Drive file IDs.");
    return;
  }

  // Backup existing questions.json if not already backed up
  if (!fs.existsSync(QUESTIONS_BAK)) {
    fs.copyFileSync(QUESTIONS_FILE, QUESTIONS_BAK);
    console.log("💾 Backup saved to questions.json.bak");
  }

  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions));
  console.log("💾 Updated questions.json written");
  console.log("\n🎉 Done! PDF links now point to local files.");
}

main();
