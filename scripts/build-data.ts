/**
 * build-data.ts
 *
 * Loops through every .xlsx file in the project root, reads ALL sheets,
 * resolves Google Drive hyperlinks via the Links sheet cross-reference,
 * cross-references legacy Cloud Storage URLs, and merges into public/data.json.
 *
 * Usage: npx tsx scripts/build-data.ts
 */

import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT_DIR, "public", "data.json");
const LEGACY_DIR = path.join(
  ROOT_DIR,
  "upscpath.com",
  "prod-api.upscpath.com",
  "api",
  "v1",
);

const HEADER_KEYWORDS = [
  "filename",
  "links",
  "question",
  "introduction",
  "page",
  "syllabus",
  "name",
  "rank",
  "year",
  "examples",
  "teachings",
  "drive_id",
  "analysis",
  "similar pyqs",
  "file_name",
  "topper copies",
  "subject marks",
  "essay title",
];

const SKIP_SHEETS = new Set(["disclaimer", "temp", "ethics temp"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isHeaderRow(row: string[]): boolean {
  const cleaned = row
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean);
  if (cleaned.length === 0) return false;
  const matches = cleaned.filter((cell) =>
    HEADER_KEYWORDS.some((kw) => cell.includes(kw)),
  );
  return matches.length >= 2 || (cleaned.length <= 3 && matches.length >= 1);
}

function isEmptyRow(row: string[]): boolean {
  return row.every((c) => String(c).trim() === "");
}

function isDisclaimerCell(cell: string): boolean {
  const t = cell.trim().toLowerCase();
  if (t.length > 200) return true;
  if (t.startsWith("compiled by") || t.startsWith("disclaimer")) return true;
  return false;
}

function normalizeKey(raw: string): string {
  return raw
    .toString()
    .trim()
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

// ─── Link resolution (Google Drive Links sheet) ──────────────────────────────

function buildLinksMap(workbook: XLSX.WorkBook): Map<string, string> {
  const linksSheetName = workbook.SheetNames.find((s) =>
    s.toLowerCase().includes("link"),
  );
  if (!linksSheetName) return new Map();

  const ws = workbook.Sheets[linksSheetName];
  const data: string[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
  }) as string[][];

  const map = new Map<string, string>();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || isEmptyRow(row)) continue;
    const fname = String(row[0] || "").trim();
    const url = String(row[2] || row[1] || "").trim();
    if (fname && url && url.startsWith("http")) {
      map.set(fname, url);
    }
    const base = fname.replace(/^.*[/\\]/, "");
    if (base !== fname) map.set(base, url);
  }
  return map;
}

// ─── Legacy Cloud Storage URL extraction ──────────────────────────────────────

interface LegacyEntry {
  fileName: string;
  topper_name: string;
  topper: string;
  filename: string;
  pdf_url: string;
}

function buildLegacyUrlMap(): Map<string, string> {
  const map = new Map<string, string>();

  // Scan all legacy API response files for pdf_url entries
  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith(".html")) {
        try {
          const raw = fs.readFileSync(full, "utf-8");
          const data = JSON.parse(raw);
          extractUrls(data, map);
        } catch {
          // Skip non-JSON or unparseable files
        }
      }
    }
  }

  scanDir(LEGACY_DIR);
  return map;
}

function extractUrls(obj: unknown, map: Map<string, string>) {
  if (!obj || typeof obj !== "object") return;

  // Direct match: { pdf_url: "...", fileName: "..." }
  if (
    "pdf_url" in obj &&
    typeof (obj as Record<string, unknown>).pdf_url === "string"
  ) {
    const entry = obj as Record<string, unknown>;
    const url = entry.pdf_url as string;

    // Index by fileName
    const fn = String(
      entry.fileName || entry.filename || entry.topper_name || "",
    ).trim();
    if (fn && url.startsWith("http")) {
      map.set(fn, url);
      // Also index by just the basename (no extension)
      const base = fn.replace(/\.pdf$/i, "");
      if (base !== fn) map.set(base, url);
    }

    // Index by topper name
    const tname = String(entry.topper_name || entry.topper || "").trim();
    if (tname && url.startsWith("http") && !map.has(tname)) {
      map.set(tname, url);
    }
  }

  // Recurse into arrays and nested objects
  if (Array.isArray(obj)) {
    for (const item of obj) extractUrls(item, map);
  } else {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      if (val && typeof val === "object") extractUrls(val, map);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface DataRecord {
  source_file: string;
  sheet_name: string;
  row_index: number;
  [key: string]: unknown;
}

function main() {
  // Build legacy URL map from upscpath.com data dump
  console.log("🔍 Scanning legacy data for Cloud Storage URLs...");
  const legacyUrlMap = buildLegacyUrlMap();
  console.log(
    `   Found ${legacyUrlMap.size} legacy filename → Cloud Storage URL mappings\n`,
  );

  const allFiles = fs.readdirSync(ROOT_DIR).filter((f) => f.endsWith(".xlsx"));
  console.log(`Found ${allFiles.length} Excel file(s) in root.\n`);

  const allRecords: DataRecord[] = [];
  let totalSheets = 0;
  let skippedSheets = 0;
  let totalLinksResolved = 0;
  let legacyMatches = 0;

  for (const filename of allFiles) {
    const filePath = path.join(ROOT_DIR, filename);
    console.log(`📂 Processing: ${filename}`);

    const workbook = XLSX.readFile(filePath);
    const sheetNames = workbook.SheetNames;

    const linksMap = buildLinksMap(workbook);
    if (linksMap.size > 0) {
      console.log(
        `   🔗 Links sheet found: ${linksMap.size} filename→URL mappings`,
      );
    }

    for (const sheetName of sheetNames) {
      const lowerSheet = sheetName.trim().toLowerCase();

      if (SKIP_SHEETS.has(lowerSheet)) {
        console.log(`   ⏭  Skipping sheet: "${sheetName}"`);
        skippedSheets++;
        continue;
      }

      if (lowerSheet.includes("link") && !lowerSheet.includes("question")) {
        skippedSheets++;
        continue;
      }

      totalSheets++;
      const worksheet = workbook.Sheets[sheetName];
      const rawData: string[][] = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",
      }) as string[][];

      if (rawData.length === 0) {
        console.log(`   ⚠  Sheet "${sheetName}" is empty`);
        continue;
      }

      let headerRowIndex = -1;
      let headers: string[] = [];

      for (let i = 0; i < Math.min(rawData.length, 20); i++) {
        const row = rawData[i];
        if (isEmptyRow(row)) continue;
        if (row.some((c) => isDisclaimerCell(String(c)))) continue;
        if (isHeaderRow(row)) {
          headerRowIndex = i;
          headers = row.map(normalizeKey);
          break;
        }
      }

      if (headerRowIndex === -1 || headers.length === 0) {
        console.log(
          `   ⚠  Sheet "${sheetName}" — could not detect headers, skipping`,
        );
        skippedSheets++;
        continue;
      }

      const filenameColIdx = headers.findIndex(
        (h) => h === "filename" || h === "file_name" || h === "name",
      );
      const linksColIdx = headers.findIndex(
        (h) => h === "links" || h === "link",
      );

      console.log(
        `   ✅ Sheet "${sheetName}" — headers: [${headers.join(", ")}]`,
      );

      let dataRowCount = 0;
      let resolvedCount = 0;
      let legacyCount = 0;

      for (let i = headerRowIndex + 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (isEmptyRow(row)) continue;

        let resolvedLinksValue: string | null = null;

        // Try legacy Cloud Storage URL first (highest priority)
        if (legacyUrlMap.size > 0 && filenameColIdx >= 0) {
          const fname = String(row[filenameColIdx] || "").trim();
          if (fname) {
            // Try exact fileName match
            let cloudUrl = legacyUrlMap.get(fname);
            // Try basename (strip .pdf)
            if (!cloudUrl) {
              const base = fname.replace(/\.pdf$/i, "");
              cloudUrl = legacyUrlMap.get(base);
            }
            if (cloudUrl) {
              resolvedLinksValue = cloudUrl;
              legacyCount++;
            }
          }
        }

        // Fall back to Links sheet cross-reference
        if (
          !resolvedLinksValue &&
          linksMap.size > 0 &&
          linksColIdx >= 0 &&
          filenameColIdx >= 0
        ) {
          const linksVal = String(row[linksColIdx] || "").trim();
          const fname = String(row[filenameColIdx] || "").trim();
          if (
            fname &&
            (linksVal === "Link" ||
              linksVal === "link" ||
              linksVal === "" ||
              linksVal === "LINK")
          ) {
            const actualUrl = linksMap.get(fname);
            if (actualUrl) {
              resolvedLinksValue = actualUrl;
              resolvedCount++;
            }
          }
        }

        const record: DataRecord = {
          source_file: filename,
          sheet_name: sheetName,
          row_index: i + 1,
        };

        for (let col = 0; col < headers.length; col++) {
          const key = headers[col];
          let value = col < row.length ? String(row[col]).trim() : "";
          if (resolvedLinksValue && col === linksColIdx) {
            value = resolvedLinksValue;
          }
          if (key && value) {
            record[key] = value;
          }
        }

        allRecords.push(record);
        dataRowCount++;
      }

      const parts: string[] = [`→ ${dataRowCount} rows`];
      if (legacyCount > 0)
        parts.push(`☁️ ${legacyCount} Cloud Storage matches`);
      if (resolvedCount > 0)
        parts.push(`🔗 ${resolvedCount} Drive links resolved`);
      console.log(`      ${parts.join(", ")}`);
      totalLinksResolved += resolvedCount;
      legacyMatches += legacyCount;
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(allRecords, null, 2), "utf-8");

  console.log(`\n═══════════════════════════════════════`);
  console.log(`📊 Summary`);
  console.log(`   Files processed:    ${allFiles.length}`);
  console.log(`   Sheets processed:   ${totalSheets}`);
  console.log(`   Sheets skipped:     ${skippedSheets}`);
  console.log(`   Total records:      ${allRecords.length.toLocaleString()}`);
  console.log(`   ☁️  Legacy matches:   ${legacyMatches.toLocaleString()}`);
  console.log(`   🔗 Drive resolved:   ${totalLinksResolved.toLocaleString()}`);
  console.log(`   Output:             ${OUTPUT}`);
  console.log(`═══════════════════════════════════════\n`);
}

main();
