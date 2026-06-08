import test from "node:test";
import assert from "node:assert/strict";

import { getInitialWorkspaceSubjectShells } from "../static-shell-data";
import {
  __setWorkspaceIndexForTests,
  toPublicWorkspaceQuestion,
  toWorkspaceQuestionShell,
  type WorkspaceQuestion,
  type WorkspaceSyllabusNode,
} from "../question-bank-runtime";

const FORBIDDEN_PUBLIC_MARKERS = [
  "searchText",
  "sourceUrl",
  "sourceCdnUrl",
  "sourcePath",
  "localPdfPath",
  "sourceDriveId",
  "full_answer_markdown",
  "ocr_markdown",
  "rawOcr",
  "raw_ocr",
  "https://pub-test.r2.dev/",
  "drive.google.com",
  "/Users/",
  "/Volumes/",
  "local-pdfs",
  "PRIVATE_SEARCH_TOKEN",
  "PRIVATE_FULL_MARKDOWN",
];

function makeNode(): WorkspaceSyllabusNode {
  return {
    id: "node-polity",
    subjectKey: "gs2",
    label: "Parliament",
    parentId: null,
    order: 1,
    kind: "topic",
    paper: "GS Paper 2",
    questionCount: 1,
  };
}

function makeQuestion(): WorkspaceQuestion {
  return {
    id: "q-public-boundary",
    question: "How does Parliament scrutinize delegated legislation?",
    paper: "GS Paper 2",
    category: "Polity",
    subjectKey: "gs2",
    subjectLabel: "GS Paper 2",
    estimatedYear: 2024,
    marks: 10,
    syllabusNodeId: "node-polity",
    syllabusPath: ["Polity", "Parliament"],
    linkedInsights: [
      {
        answerId: "ans_0123456789abcdef",
        topperName: "Test Topper",
        rank: 1,
        year: 2024,
        institute: "Test Institute",
        marks: "7/10",
        pageHint: 3,
        pageStatus: "valid",
        sourceAvailable: true,
        sourceStatus: "available",
        summary: "A concise public study summary that is safe to show to users.",
        summaryAvailable: true,
        summarySource: "ocr",
        sourceUrl: "https://pub-test.r2.dev/secret.pdf",
        sourceDriveId: "drive-secret",
        localPdfPath: "/Users/test/local-pdfs/secret.pdf",
        full_answer_markdown: "PRIVATE_FULL_MARKDOWN",
      } as never,
    ],
    topperCount: 1,
    searchText: "PRIVATE_SEARCH_TOKEN delegated legislation /Volumes/private drive.google.com local-pdfs",
    sourceUrl: "https://pub-test.r2.dev/question-secret.pdf",
    ocr_markdown: "PRIVATE_FULL_MARKDOWN",
  } as never;
}

function assertNoForbiddenMarkers(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const marker of FORBIDDEN_PUBLIC_MARKERS) {
    assert.ok(
      !serialized.includes(marker),
      `expected public payload not to contain private marker ${marker}`,
    );
  }
}

test.afterEach(() => {
  __setWorkspaceIndexForTests(null);
});

test("workspace public detail DTO allow-lists fields and strips private search/source metadata", () => {
  const dto = toPublicWorkspaceQuestion(makeQuestion());

  assert.equal(Object.hasOwn(dto, "searchText"), false);
  assert.equal(Object.hasOwn(dto, "sourceUrl"), false);
  assert.equal(Object.hasOwn(dto, "ocr_markdown"), false);
  assert.equal(dto.linkedInsights.length, 1);
  assert.equal(dto.linkedInsights[0]?.answerId, "ans_0123456789abcdef");
  assert.equal(Object.hasOwn(dto.linkedInsights[0] || {}, "sourceUrl"), false);
  assert.equal(Object.hasOwn(dto.linkedInsights[0] || {}, "localPdfPath"), false);
  assert.equal(Object.hasOwn(dto.linkedInsights[0] || {}, "full_answer_markdown"), false);
  assertNoForbiddenMarkers(dto);
});

test("workspace public detail DTO normalizes non-person topper labels server-side", () => {
  const question = makeQuestion();
  question.linkedInsights[0] = {
    ...question.linkedInsights[0],
    topperName: "Copies",
  };

  const dto = toPublicWorkspaceQuestion(question);
  assert.equal(dto.linkedInsights[0]?.topperName, "Topper copy");
  assertNoForbiddenMarkers(dto);
  assert.ok(!JSON.stringify(dto).includes("Copies"));
});

test("workspace shell DTO strips search text and all linked copy metadata", () => {
  const shell = toWorkspaceQuestionShell(makeQuestion());

  assert.equal(Object.hasOwn(shell, "searchText"), false);
  assert.deepEqual(shell.linkedInsights, []);
  assertNoForbiddenMarkers(shell);
});

test("initial workspace static shells do not serialize private search text", async () => {
  __setWorkspaceIndexForTests({
    generatedAt: "2026-06-07T00:00:00.000Z",
    questions: [makeQuestion()],
    syllabusNodes: [makeNode()],
  });

  const shells = await getInitialWorkspaceSubjectShells("gs2");

  assert.equal(shells.length, 1);
  assert.equal(Object.hasOwn(shells[0] || {}, "searchText"), false);
  assert.deepEqual(shells[0]?.linkedInsights, []);
  assertNoForbiddenMarkers(shells);
});
