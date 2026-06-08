import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_TOPPER_NAME_FALLBACK,
  displayPublicTopperName,
  normalizePublicTopperName,
} from "../public-records";
import { getCuratedTopperIdentity } from "../topper-names";

const BAD_PUBLIC_NAMES = [
  "Pub Admn",
  "Copies",
  "Topper copies",
  "Question",
  "Anthro Society",
  "Anthro Theories",
  "Anthro Tribal",
  "TSM SOC NICE IAS",
  "Guidance IAS",
  "Geomorphology Handwritten Notes",
  "Geomorphology_Handwritten_500+_WatermarkedPDF_453.pdf",
  "Climatology 500+ Handwritten Notes.pdf",
  "Evaluated",
  "MTS NL FLT",
  "MTS NL FLT EVALUATED",
  "FLT",
  "Class",
  "Test",
  "Checked",
  "Sent",
  "drive_1uC2jaHpC0mN-7n1iE9RDYgBTzBcOXWdm.pdf",
  "87b1e2d3f4a5c67890",
  "Eb Aa Cd",
  "Anonymous Pttp Tc",
];

test("public topper-name normalization suppresses labels, placeholders, UUID-like names, and watermarked-note titles", () => {
  for (const value of BAD_PUBLIC_NAMES) {
    assert.equal(normalizePublicTopperName(value), null, `expected ${value} to be hidden`);
    assert.equal(displayPublicTopperName(value), "Topper copy", `expected ${value} to use public fallback`);
  }

  assert.equal(PUBLIC_TOPPER_NAME_FALLBACK, "Topper copy");
});

test("public topper-name normalization deterministically cleans known real names from noisy source labels", () => {
  const cases: Array<[string, string]> = [
    ["PSIR-T3-DAMANPREET-ARORA-R103-1750231496542.pdf", "Damanpreet Arora"],
    ["PSIR RAJ KUMAR MAHTO", "Raj Kumar Mahto"],
    ["PSIR SANJEEV KUMAR", "Sanjeev Kumar"],
    ["PSIR ABHI JAIN", "Abhi Jain"],
    ["2. Geomorphologysiddhartha-srivastava-Siddhartha-srivastava.pdf", "Siddhartha Srivastava"],
    ["Watermarksiddhartha Srivastava Siddhartha Srivasta", "Siddhartha Srivastava"],
    ["AIR_251_Aradhana_Chouhan_280_marks_Levelup_Sociology_crash_course.pdf", "Aradhana Chouhan"],
    ["KASTURI SAHA ETHICS CLASS TEST -1_.pdf", "Kasturi Saha"],
    ["ATUL TYAGI ETHICSTEST -3 (1).pdf", "Atul Tyagi"],
    ["1714371567-1-SAIRAJ-MISHRA-Geography-Class.pdf", "Sairaj Mishra"],
    ["Asad Zuberi AIR86 TA03.pdf", "Asad Zuberi"],
  ];

  for (const [raw, expected] of cases) {
    assert.equal(normalizePublicTopperName(raw), expected, `expected ${raw} to clean to ${expected}`);
    assert.equal(displayPublicTopperName(raw), expected, `expected display ${raw} to clean to ${expected}`);
  }
});

test("curated topper identities can carry deterministic rank hints", () => {
  assert.deepEqual(getCuratedTopperIdentity("AIR_251_Aradhana_Chouhan_280_marks_Levelup_Sociology_crash_course.pdf"), {
    name: "Aradhana Chouhan",
    rank: 251,
    year: null,
  });

  assert.deepEqual(getCuratedTopperIdentity("Asad Zuberi AIR86 TA03.pdf"), {
    name: "Asad Zuberi",
    rank: 86,
    year: null,
  });
});
