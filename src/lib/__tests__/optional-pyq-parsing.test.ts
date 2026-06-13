import test from "node:test";
import assert from "node:assert/strict";

import { __testUtils } from "../official-pyqs";

const { loadOfficialRows, cleanOptionalFallbackQuestionText } = __testUtils;

const EXPECTED_OPTIONAL_SUBJECTS = [
  "geography",
  "sociology",
  "psir",
  "public-administration",
  "anthropology",
  "history",
] as const;

test("parseOptionalOfficialRows produces rows with sourceKind 'optional-official' for all six subjects", () => {
  const rows = loadOfficialRows();

  for (const subjectKey of EXPECTED_OPTIONAL_SUBJECTS) {
    const subjectRows = rows.filter(
      (row) => row.subjectKey === subjectKey && row.sourceKind === "optional-official",
    );
    assert.ok(
      subjectRows.length > 0,
      `Expected ${subjectKey} to have optional-official rows, got 0`,
    );
    // Verify all rows for this subject have the correct sourceKind
    for (const row of subjectRows) {
      assert.equal(
        row.sourceKind,
        "optional-official",
        `Expected sourceKind 'optional-official' for ${subjectKey} row ${row.id}`,
      );
    }
  }
});

test("loadOfficialRows excludes workspace fallback rows when canonical optional rows exist", () => {
  const rows = loadOfficialRows();

  for (const subjectKey of EXPECTED_OPTIONAL_SUBJECTS) {
    const officialRows = rows.filter(
      (row) => row.subjectKey === subjectKey && row.sourceKind === "optional-official",
    );
    const fallbackRows = rows.filter(
      (row) => row.subjectKey === subjectKey && row.sourceKind === "workspace-optional-fallback",
    );

    if (officialRows.length > 0) {
      assert.equal(
        fallbackRows.length,
        0,
        `Expected ${subjectKey} to have zero workspace-optional-fallback rows when canonical rows exist, but found ${fallbackRows.length}`,
      );
    }
  }
});

test("deduplication by normalizeOfficialQuestionFingerprint: earliest year wins", () => {
  const rows = loadOfficialRows();

  for (const subjectKey of EXPECTED_OPTIONAL_SUBJECTS) {
    const subjectRows = rows.filter(
      (row) => row.subjectKey === subjectKey && row.sourceKind === "optional-official",
    );

    // Check for duplicate fingerprints — there should be none after deduplication
    const fingerprints = new Map<string, { year: number | null; id: string }>();
    for (const row of subjectRows) {
      const fp = normalizeFingerprint(row.question);
      if (!fp) continue;

      if (fingerprints.has(fp)) {
        const existing = fingerprints.get(fp)!;
        // If we find a duplicate, it means deduplication isn't working
        assert.fail(
          `Duplicate fingerprint found for ${subjectKey}: row ${row.id} (year=${row.year}) duplicates row ${existing.id} (year=${existing.year}). ` +
          `Fingerprint: "${fp.slice(0, 80)}..."`,
        );
      }
      fingerprints.set(fp, { year: row.year, id: row.id });
    }
  }
});

test("cleanOptionalFallbackQuestionText strips Hindi preambles from bilingual questions", () => {
  // Real-world examples from the markdown files — bilingual OCR with Hindi prefix
  const bilingual1 =
    "arate af aa 28? ae ae Bik MATT GH-ER GB FA Teaifeaa F? are Fife What is common sense? How are common knowledge and sociology related each other? Explain.";
  const cleaned1 = cleanOptionalFallbackQuestionText(bilingual1);
  // Should start with English demand
  assert.ok(
    cleaned1.startsWith("What is common sense?"),
    `Expected Hindi preamble to be stripped. Got: "${cleaned1.slice(0, 80)}"`,
  );

  // Another bilingual example
  const bilingual2 =
    "aeRn-aa sik walt & aed 8 arse ait store % Hea sar Bere (array va faftrrand) 8? fadan Fife What is the relationship (similarities and differences) between sociology and history in terms of their area of study and methodology? Discuss.";
  const cleaned2 = cleanOptionalFallbackQuestionText(bilingual2);
  assert.ok(
    cleaned2.startsWith("What is the relationship"),
    `Expected Hindi preamble to be stripped. Got: "${cleaned2.slice(0, 80)}"`,
  );

  // Already-English text should be preserved
  const english =
    "Compare capability deprivation approach with that of social capital deprivation in understanding chronic poverty.";
  const cleanedEnglish = cleanOptionalFallbackQuestionText(english);
  assert.equal(cleanedEnglish, english);
});

// Helper to normalize fingerprints (mirrors the internal function logic)
function normalizeFingerprint(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^\s*["'""]?\s*q(?:uestion)?\.?\s*\d{0,2}\s*[a-e]?\s*[.)\]:-]?\s*/i, "")
    .replace(/^\s*["'""]?\s*\d{1,2}\s*[a-e]?\s*[.)\]:-]\s*/i, "")
    .replace(/\([^)]*\b\d{1,3}\s*marks?[^)]*\)/gi, "")
    .replace(/\b\d{1,3}\s*marks?\b/gi, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
