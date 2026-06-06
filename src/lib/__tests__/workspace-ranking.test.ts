import test from "node:test";
import assert from "node:assert/strict";

import {
  __setWorkspaceIndexForTests as setRuntimeWorkspaceIndex,
  searchWorkspaceQuestions as searchRuntimeWorkspaceQuestions,
  type WorkspaceQuestion as RuntimeWorkspaceQuestion,
  type WorkspaceSyllabusNode as RuntimeWorkspaceSyllabusNode,
} from "../question-bank-runtime";
import {
  __setWorkspaceIndexForTests as setWorkspaceIndex,
  searchWorkspaceQuestions,
  type WorkspaceQuestion,
  type WorkspaceSyllabusNode,
} from "../question-bank";

type SnapshotQuestion = WorkspaceQuestion | RuntimeWorkspaceQuestion;
type SnapshotNode = WorkspaceSyllabusNode | RuntimeWorkspaceSyllabusNode;

function makeNode(): WorkspaceSyllabusNode {
  return {
    id: "node-1",
    subjectKey: "gs2",
    label: "Parliament",
    parentId: null,
    order: 1,
    kind: "topic",
    paper: "GS Paper 2",
    questionCount: 2,
  };
}

function makeQuestion(overrides: Partial<WorkspaceQuestion>): WorkspaceQuestion {
  return {
    id: overrides.id ?? "q-1",
    question: overrides.question ?? "Default question",
    paper: overrides.paper ?? "GS Paper 2",
    category: overrides.category ?? "Polity",
    subjectKey: overrides.subjectKey ?? "gs2",
    subjectLabel: overrides.subjectLabel ?? "GS Paper 2",
    estimatedYear: overrides.estimatedYear ?? 2024,
    marks: overrides.marks ?? 10,
    syllabusNodeId: overrides.syllabusNodeId ?? "node-1",
    syllabusPath: overrides.syllabusPath ?? ["Parliament"],
    linkedInsights: overrides.linkedInsights ?? [],
    topperCount: overrides.topperCount ?? 0,
    searchText: overrides.searchText ?? overrides.question?.toLowerCase() ?? "default question",
  };
}

function setSnapshots(questions: SnapshotQuestion[], nodes: SnapshotNode[] = [makeNode()]) {
  const snapshot = {
    generatedAt: "2026-06-06T00:00:00.000Z",
    questions,
    syllabusNodes: nodes,
  };
  setWorkspaceIndex(snapshot);
  setRuntimeWorkspaceIndex(snapshot);
}

test.afterEach(() => {
  setWorkspaceIndex(null);
  setRuntimeWorkspaceIndex(null);
});

test("more relevant question outranks higher topper count", () => {
  setSnapshots([
    makeQuestion({
      id: "exact",
      question: "How does the Parliament scrutinize delegated legislation in India?",
      searchText: "how does the parliament scrutinize delegated legislation in india polity",
      topperCount: 1,
    }),
    makeQuestion({
      id: "broad",
      question: "Discuss delegated legislation in India.",
      searchText: "delegated legislation india polity",
      topperCount: 9,
    }),
  ]);

  const result = searchWorkspaceQuestions({ query: "parliament delegated legislation", subjectKey: "gs2" });
  assert.deepEqual(result.map((question) => question.id), ["exact", "broad"]);
});

test("topper count breaks ties after relevance", () => {
  setSnapshots([
    makeQuestion({
      id: "high-topper",
      question: "Explain Parliament accountability in India.",
      searchText: "explain parliament accountability in india",
      topperCount: 8,
    }),
    makeQuestion({
      id: "low-topper",
      question: "Explain Parliament accountability in India.",
      searchText: "explain parliament accountability in india",
      topperCount: 2,
    }),
  ]);

  const result = searchWorkspaceQuestions({ query: "parliament accountability", subjectKey: "gs2" });
  assert.deepEqual(result.map((question) => question.id), ["high-topper", "low-topper"]);
});

test("runtime and non-runtime workspace ranking stay in sync", () => {
  setSnapshots([
    makeQuestion({
      id: "exact",
      question: "How does the Parliament scrutinize delegated legislation in India?",
      searchText: "how does the parliament scrutinize delegated legislation in india polity",
      topperCount: 1,
    }),
    makeQuestion({
      id: "broad",
      question: "Discuss delegated legislation in India.",
      searchText: "delegated legislation india polity",
      topperCount: 9,
    }),
    makeQuestion({
      id: "tie-high",
      question: "Explain Parliament accountability in India.",
      searchText: "explain parliament accountability in india",
      topperCount: 8,
    }),
    makeQuestion({
      id: "tie-low",
      question: "Explain Parliament accountability in India.",
      searchText: "explain parliament accountability in india",
      topperCount: 2,
    }),
  ]);

  const query = "parliament accountability";
  const standard = searchWorkspaceQuestions({ query, subjectKey: "gs2" }).map((question) => question.id);
  const runtime = searchRuntimeWorkspaceQuestions({ query, subjectKey: "gs2" }).map((question) => question.id);

  assert.deepEqual(runtime, standard);
});
