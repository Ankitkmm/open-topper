/**
 * build-ocr-links.ts
 *
 * Links OCR markdown files (UPSC_topper_md/) to topper copies via Google Drive ID.
 * Extracts summary text from each OCR file and outputs a compact JSON map.
 *
 * Usage: npx tsx scripts/build-ocr-links.ts
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const OCR_DIR = path.join(ROOT, "UPSC_topper_md");
const OUTPUT = path.join(ROOT, "public", "data", "ocr-summaries.json");

interface OcrEntry {
  /** First ~1000 chars of cleaned OCR text (as summary preview) */
  summary: string;
  /** Drive file ID */
  driveId: string;
  /** Whether we have the full text (COMPLETE) or just pages (MASTER) */
  source: "complete" | "master";
}

function extractDriveId(filename: string): string | null {
  // Pattern: drive_{ID}_COMPLETE.md or drive_{ID}_MASTER.md or drive_{ID}_p0_COMPLETE.md
  const m = filename.match(/^drive_(.+?)_(?:COMPLETE|MASTER|p\d+_COMPLETE)\.md$/);
  return m ? m[1] : null;
}

function cleanOcrText(raw: string): string {
  return raw
    // Remove markdown headers from page markers
    .replace(/^#{1,4}\s+.*$/gm, "")
    // Remove horizontal rules
    .replace(/^---+\s*$/gm, "")
    // Remove "Source:" lines
    .replace(/^###\s*Source:.*$/gm, "")
    // Remove <trans> tags
    .replace(/<\/?trans>/g, "")
    // Remove file header line
    .replace(/^#\s+drive_.*$/gm, "")
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractSummary(text: string, maxLen = 1200): string {
  // Take first meaningful paragraph block
  const blocks = text.split("\n\n").filter((b) => {
    const t = b.trim();
    return t.length > 30 && !t.startsWith("---") && !t.startsWith("#");
  });

  let summary = "";
  for (const block of blocks) {
    if (summary.length + block.length > maxLen) {
      const remaining = maxLen - summary.length;
      if (remaining > 50) {
        summary += block.slice(0, remaining) + "…";
      }
      break;
    }
    summary += (summary ? "\n\n" : "") + block;
  }

  return summary || text.slice(0, maxLen) + "…";
}

function main() {
  console.log("🔍 Scanning OCR markdown files...");

  if (!fs.existsSync(OCR_DIR)) {
    console.error(`   ❌ OCR directory not found: ${OCR_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(OCR_DIR).filter((f) => f.endsWith(".md"));
  console.log(`   Found ${files.length} markdown files`);

  const ocrMap: Record<string, OcrEntry> = {};
  let completeCount = 0;
  let masterCount = 0;
  let skippedNoId = 0;

  for (const filename of files) {
    const driveId = extractDriveId(filename);
    if (!driveId) {
      skippedNoId++;
      continue;
    }

    // Prefer COMPLETE over MASTER if both exist
    const isComplete = filename.includes("_COMPLETE.md");
    const existing = ocrMap[driveId];
    if (existing && existing.source === "complete") continue; // Already have best
    if (existing && existing.source === "master" && !isComplete) continue;

    try {
      const raw = fs.readFileSync(path.join(OCR_DIR, filename), "utf-8");
      const cleaned = cleanOcrText(raw);
      const summary = extractSummary(cleaned);

      ocrMap[driveId] = {
        summary,
        driveId,
        source: isComplete ? "complete" : "master",
      };

      if (isComplete) completeCount++;
      else masterCount++;
    } catch (err) {
      console.warn(`   ⚠️  Failed to read ${filename}: ${err}`);
    }
  }

  const entries = Object.values(ocrMap);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(ocrMap));

  console.log(`\n✅ OCR summaries built:`);
  console.log(`   COMPLETE files:  ${completeCount}`);
  console.log(`   MASTER files:    ${masterCount}`);
  console.log(`   Total entries:   ${entries.length}`);
  console.log(`   Skipped (no ID): ${skippedNoId}`);
  console.log(`   Output:          ${OUTPUT}`);

  // Report size
  const sizeKb = Math.round(fs.statSync(OUTPUT).size / 1024);
  console.log(`   File size:       ${sizeKb.toLocaleString()} KB`);
}

main();
