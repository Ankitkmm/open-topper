/**
 * download-pdfs.ts
 *
 * Downloads PDFs from Google Drive using resolved links,
 * saves them to public/pdfs/, and outputs a link replacement map.
 *
 * Usage: npx tsx scripts/download-pdfs.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_FILE = path.join(ROOT, "public", "data", "questions.json");
const PDF_DIR = path.join(ROOT, "public", "pdfs");
const MAP_FILE = path.join(ROOT, "public", "data", "pdf-map.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : null;
}

/** Download a file from a URL and save to disk */
function downloadFile(url: string, dest: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;

    const req = protocol.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0" } },
      (res) => {
        // Follow redirects (Google Drive download confirmation)
        if (res.statusCode === 302 || res.statusCode === 301) {
          const redirect = res.headers.location;
          if (redirect) {
            file.close();
            fs.unlinkSync(dest);
            downloadFile(redirect, dest).then(resolve);
            return;
          }
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          resolve(false);
          return;
        }

        // Check if it's HTML (virus scan page)
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          file.write(chunk);
        });

        res.on("end", () => {
          file.end();
          const buffer = Buffer.concat(chunks);
          // If the response starts with HTML, it's a virus scan page
          const start = buffer.slice(0, 100).toString().toLowerCase();
          if (start.includes("<!doctype") || start.includes("<html")) {
            fs.unlinkSync(dest);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      },
    );

    req.on("error", () => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      resolve(false);
    });

    req.setTimeout(30000, () => {
      req.destroy();
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      resolve(false);
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf-8"));

  // Collect unique Google Drive links
  const linkMap = new Map<string, { filename: string; driveUrl: string; fileId: string }>();

  for (const group of questions) {
    for (const topper of group.toppers) {
      const url = topper.links || "";
      const fileId = extractFileId(url);
      if (!fileId) continue;

      // Create a clean filename from the topper name
      const cleanName = (topper.filename || "unknown")
        .replace(/\.pdf$/i, "")
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .slice(0, 60);
      const pdfFilename = `${cleanName}_${fileId.slice(0, 8)}.pdf`;

      if (!linkMap.has(fileId)) {
        linkMap.set(fileId, { filename: pdfFilename, driveUrl: url, fileId });
      }
    }
  }

  console.log(`📦 ${linkMap.size} unique PDFs to download\n`);
  fs.mkdirSync(PDF_DIR, { recursive: true });

  const entries = Array.from(linkMap.values());
  let downloaded = 0;
  let failed = 0;

  // Build the replacement map
  const replacementMap: Record<string, string> = {};

  async function processAll() {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const dest = path.join(PDF_DIR, entry.filename);

      // Skip if already downloaded
      if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
        console.log(`   ✅ [${i + 1}/${entries.length}] ${entry.filename} (cached)`);
        downloaded++;
        replacementMap[entry.driveUrl] = `/pdfs/${entry.filename}`;
        replacementMap[`https://drive.google.com/file/d/${entry.fileId}/view`] = `/pdfs/${entry.filename}`;
        continue;
      }

      // Try direct download URL
      const downloadUrl = `https://drive.google.com/uc?export=download&id=${entry.fileId}`;
      console.log(`   ⬇  [${i + 1}/${entries.length}] ${entry.filename}...`);

      const success = await downloadFile(downloadUrl, dest);

      if (success) {
        console.log(`   ✅ Downloaded (${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB)`);
        downloaded++;
        replacementMap[entry.driveUrl] = `/pdfs/${entry.filename}`;
        replacementMap[`https://drive.google.com/file/d/${entry.fileId}/view`] = `/pdfs/${entry.filename}`;
      } else {
        console.log(`   ❌ Failed (may need authentication or be too large for direct download)`);
        failed++;
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      }

      // Rate limit: wait 500ms between requests
      await new Promise((r) => setTimeout(r, 500));
    }

    // Write the replacement map
    fs.writeFileSync(MAP_FILE, JSON.stringify(replacementMap, null, 2), "utf-8");

    console.log(`\n═══════════════════════════════`);
    console.log(`📊 Summary`);
    console.log(`   Downloaded: ${downloaded}`);
    console.log(`   Failed:     ${failed}`);
    console.log(`   Map saved:  ${MAP_FILE}`);
    console.log(`═══════════════════════════════`);
  }

  processAll();
}

main();
