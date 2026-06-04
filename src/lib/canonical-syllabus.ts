import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  SUBJECT_DEFINITIONS,
  getSubjectDefinitions,
  type SubjectKey,
} from "./subject-definitions";

export interface SyllabusNode {
  id: string;
  subjectKey: SubjectKey;
  label: string;
  parentId: string | null;
  order: number;
  kind: "group" | "topic";
  paper: string;
  isFallback?: boolean;
}

interface SyllabusIndex {
  allNodes: SyllabusNode[];
  topicsBySubject: Map<SubjectKey, SyllabusNode[]>;
  groupsBySubject: Map<SubjectKey, SyllabusNode[]>;
  nodeById: Map<string, SyllabusNode>;
  essaySectionByPrompt: Map<string, string>;
}

const ROOT = process.cwd();
const GS_SYLLABUS_FILE = join(
  ROOT,
  "PYQS",
  "UPSC SYLLABUS, topics might be theirs,dont do a 100 match while copying.md",
);
const OPTIONAL_SYLLABUS_FILE = join(ROOT, "PYQS", "Optional Syllabus.md");
const ESSAY_FILE = join(ROOT, "PYQS", "UPSC ESSAYS PYQS.md");
const EXTRACTED_DATA_DIR = join(ROOT, "extracted_data");

const NOISE_LINES = new Set([
  "optional syllabus",
  "psir syllabus",
  "syllabus of psir paper - i",
  "syllabus of psir paper - ii",
  "syllabus of public administration paper - i",
  "syllabus of public administration paper - ii",
]);

let cachedIndex: SyllabusIndex | null = null;

export function loadCanonicalSyllabusIndex(): SyllabusIndex {
  if (cachedIndex) return cachedIndex;

  const allNodes: SyllabusNode[] = [];
  const essaySectionByPrompt = new Map<string, string>();

  addNodes(allNodes, parseGsCore());
  addNodes(allNodes, parseGs4());
  addNodes(allNodes, parseEssay(essaySectionByPrompt));
  addNodes(allNodes, parseExtractedSubject("sociology", "socio"));
  addNodes(allNodes, parseExtractedSubject("psir", "psir"));
  addNodes(allNodes, parseExtractedSubject("history", "history"));
  addNodes(allNodes, parseOptionalMarkdownSubject("public-administration"));
  addNodes(allNodes, parseOptionalMarkdownSubject("geography"));

  const topicsBySubject = new Map<SubjectKey, SyllabusNode[]>();
  const groupsBySubject = new Map<SubjectKey, SyllabusNode[]>();
  const nodeById = new Map<string, SyllabusNode>();

  for (const definition of getSubjectDefinitions()) {
    topicsBySubject.set(definition.key, []);
    groupsBySubject.set(definition.key, []);
  }

  for (const node of allNodes) {
    nodeById.set(node.id, node);
    if (node.kind === "group") {
      groupsBySubject.get(node.subjectKey)?.push(node);
    } else {
      topicsBySubject.get(node.subjectKey)?.push(node);
    }
  }

  cachedIndex = {
    allNodes,
    topicsBySubject,
    groupsBySubject,
    nodeById,
    essaySectionByPrompt,
  };

  return cachedIndex;
}

export function normalizeSyllabusText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[`'".,()[\]{}]/g, " ")
    .replace(/[/-]+/g, " ")
    .replace(/\b(?:paper|gs|section|topic|general studies|optional)\b/g, " ")
    .replace(/\b[ivx]+\b/g, " ")
    .replace(/\b\d+(?:\.\d+)*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function syllabusTokens(value: string) {
  return normalizeSyllabusText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function parseGsCore(): SyllabusNode[] {
  if (!existsSync(GS_SYLLABUS_FILE)) return [];
  const lines = readFileSync(GS_SYLLABUS_FILE, "utf-8").split(/\r?\n/);
  const nodes: SyllabusNode[] = [];
  const groupIds = new Set<string>();
  let order = 0;

  for (const line of lines) {
    const parts = line.split("\t").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const subjectKey = gsKeyFromLabel(parts[0]);
    if (!subjectKey || subjectKey === "gs4") continue;

    const groupLabel = parts[1];
    const topicLabel = cleanLabel(parts.slice(2).join(" "));
    if (!groupLabel || !topicLabel) continue;

    const groupId = `${subjectKey}:group:${slug(groupLabel)}`;
    if (!groupIds.has(groupId)) {
      groupIds.add(groupId);
      nodes.push({
        id: groupId,
        subjectKey,
        label: groupLabel,
        parentId: null,
        order: order++,
        kind: "group",
        paper: SUBJECT_DEFINITIONS[subjectKey].paperLabel,
      });
    }

    nodes.push({
      id: `${subjectKey}:topic:${slug(`${groupLabel}-${topicLabel}`)}`,
      subjectKey,
      label: topicLabel,
      parentId: groupId,
      order: order++,
      kind: "topic",
      paper: SUBJECT_DEFINITIONS[subjectKey].paperLabel,
    });
  }

  return nodes;
}

function parseGs4(): SyllabusNode[] {
  if (!existsSync(GS_SYLLABUS_FILE)) return [];
  const raw = readFileSync(GS_SYLLABUS_FILE, "utf-8");
  const start = raw.indexOf("GS IV");
  if (start < 0) return [];

  const section = raw.slice(start).split(/\r?\n/).slice(1);
  const nodes: SyllabusNode[] = [];
  const groupId = "gs4:group:core-areas";
  nodes.push({
    id: groupId,
    subjectKey: "gs4",
    label: "Core Areas",
    parentId: null,
    order: 0,
    kind: "group",
    paper: SUBJECT_DEFINITIONS.gs4.paperLabel,
  });

  let order = 1;
  for (const line of section) {
    const cleaned = cleanLabel(line);
    if (!cleaned || cleaned.startsWith("read more at")) continue;
    if (!/[A-Za-z]/.test(cleaned)) continue;
    nodes.push({
      id: `gs4:topic:${slug(cleaned)}`,
      subjectKey: "gs4",
      label: cleaned,
      parentId: groupId,
      order: order++,
      kind: "topic",
      paper: SUBJECT_DEFINITIONS.gs4.paperLabel,
    });
  }

  return dedupeNodes(nodes);
}

function parseEssay(essaySectionByPrompt: Map<string, string>): SyllabusNode[] {
  if (!existsSync(ESSAY_FILE)) return [];
  const lines = readFileSync(ESSAY_FILE, "utf-8").split(/\r?\n/);
  const nodes: SyllabusNode[] = [];
  let currentSection = "Philosophy, Values and Ideas";
  let order = 0;

  const rootId = "essay:group:themes";
  nodes.push({
    id: rootId,
    subjectKey: "essay",
    label: "Essay Themes",
    parentId: null,
    order: order++,
    kind: "group",
    paper: SUBJECT_DEFINITIONS.essay.paperLabel,
  });

  for (const line of lines) {
    if (line.startsWith("## ")) {
      currentSection = cleanLabel(line.replace(/^##\s+/, ""));
      const sectionId = `essay:topic:${slug(currentSection)}`;
      nodes.push({
        id: sectionId,
        subjectKey: "essay",
        label: currentSection,
        parentId: rootId,
        order: order++,
        kind: "topic",
        paper: SUBJECT_DEFINITIONS.essay.paperLabel,
      });
      continue;
    }

    if (!line.trim().startsWith("*")) continue;
    const prompt = cleanLabel(line.replace(/^\*\s+/, ""));
    if (!prompt) continue;
    essaySectionByPrompt.set(normalizeEssayPrompt(prompt), `essay:topic:${slug(currentSection)}`);
  }

  return dedupeNodes(nodes);
}

function parseExtractedSubject(subjectKey: SubjectKey, sectionKey: string): SyllabusNode[] {
  const file = join(EXTRACTED_DATA_DIR, subjectDir(subjectKey), "api_responses.json");
  if (!existsSync(file)) return [];

  let responses: Array<{ url?: string; body?: { syllabus?: Array<{ topic?: string; paper?: string }> } }> = [];
  try {
    responses = JSON.parse(readFileSync(file, "utf-8")) as typeof responses;
  } catch {
    return [];
  }

  const record = responses.find((entry) => entry.url?.includes(`browse/syllabus?section=${sectionKey}`));
  const syllabus = record?.body?.syllabus || [];
  if (!syllabus.length) return [];

  const nodes: SyllabusNode[] = [];
  const groupIds = new Set<string>();
  let order = 0;

  for (const row of syllabus) {
    const paperLabel = cleanLabel(row.paper || SUBJECT_DEFINITIONS[subjectKey].paperLabel) || SUBJECT_DEFINITIONS[subjectKey].paperLabel;
    const topic = cleanLabel(row.topic || "");
    if (!topic) continue;
    const groupId = `${subjectKey}:group:${slug(paperLabel)}`;
    if (!groupIds.has(groupId)) {
      groupIds.add(groupId);
      nodes.push({
        id: groupId,
        subjectKey,
        label: paperLabel,
        parentId: null,
        order: order++,
        kind: "group",
        paper: paperLabel,
      });
    }
    nodes.push({
      id: `${subjectKey}:topic:${slug(topic)}`,
      subjectKey,
      label: topic,
      parentId: groupId,
      order: order++,
      kind: "topic",
      paper: paperLabel,
    });
  }

  return dedupeNodes(nodes);
}

function parseOptionalMarkdownSubject(subjectKey: "geography" | "public-administration"): SyllabusNode[] {
  if (!existsSync(OPTIONAL_SYLLABUS_FILE)) return [];
  const raw = readFileSync(OPTIONAL_SYLLABUS_FILE, "utf-8");

  const subjectRanges: Record<typeof subjectKey, { start: string; end?: string }> = {
    geography: {
      start: "Geography Syllabus",
    },
    "public-administration": {
      start: "**Syllabus of Public Administration Paper - I**",
      end: "Geography Syllabus",
    },
  };

  const range = subjectRanges[subjectKey];
  const section = sliceSection(raw, range.start, range.end);
  if (!section) return [];

  const lines = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const nodes: SyllabusNode[] = [];
  let currentGroupId: string | null = null;
  let currentPaper = SUBJECT_DEFINITIONS[subjectKey].paperLabel;
  let order = 0;

  for (const line of lines) {
    const cleaned = cleanLabel(line);
    if (!cleaned) continue;
    const lowered = cleaned.toLowerCase();
    if (NOISE_LINES.has(lowered) || cleaned.startsWith("|") || cleaned.startsWith("Online/Offline Programme")) continue;
    if (cleaned.startsWith("www.") || cleaned.includes("@") || cleaned.includes("Read more at")) continue;

    if (/^paper[\s-]*1\b/i.test(cleaned) || /^syllabus of public administration paper - i$/i.test(cleaned)) {
      currentPaper = "Paper 1";
      currentGroupId = `${subjectKey}:group:${slug(currentPaper)}`;
      nodes.push({
        id: currentGroupId,
        subjectKey,
        label: currentPaper,
        parentId: null,
        order: order++,
        kind: "group",
        paper: currentPaper,
      });
      continue;
    }
    if (/^paper[\s-]*2\b/i.test(cleaned) || /^syllabus of public administration paper - ii$/i.test(cleaned)) {
      currentPaper = "Paper 2";
      currentGroupId = `${subjectKey}:group:${slug(currentPaper)}`;
      nodes.push({
        id: currentGroupId,
        subjectKey,
        label: currentPaper,
        parentId: null,
        order: order++,
        kind: "group",
        paper: currentPaper,
      });
      continue;
    }
    if (/^\d+\.\s+/.test(cleaned)) {
      const topic = cleanLabel(cleaned.replace(/^\d+\.\s+/, ""));
      if (!topic) continue;
      if (!currentGroupId) {
        currentGroupId = `${subjectKey}:group:${slug(currentPaper)}`;
        nodes.push({
          id: currentGroupId,
          subjectKey,
          label: currentPaper,
          parentId: null,
          order: order++,
          kind: "group",
          paper: currentPaper,
        });
      }
      nodes.push({
        id: `${subjectKey}:topic:${slug(topic)}`,
        subjectKey,
        label: topic,
        parentId: currentGroupId,
        order: order++,
        kind: "topic",
        paper: currentPaper,
      });
      continue;
    }
  }

  return dedupeNodes(nodes);
}

function subjectDir(subjectKey: SubjectKey) {
  if (subjectKey === "anthropology") return "anthro";
  if (subjectKey === "sociology") return "socio";
  return subjectKey;
}

function sliceSection(raw: string, startMarker: string, endMarker?: string) {
  const start = raw.indexOf(startMarker);
  if (start < 0) return "";
  const rest = raw.slice(start);
  if (!endMarker) return rest;
  const end = rest.indexOf(endMarker, startMarker.length);
  return end > 0 ? rest.slice(0, end) : rest;
}

function gsKeyFromLabel(value: string): SubjectKey | null {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  if (normalized === "gsi") return "gs1";
  if (normalized === "gsii") return "gs2";
  if (normalized === "gsiii") return "gs3";
  if (normalized === "gsiv") return "gs4";
  return null;
}

function cleanLabel(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-:*]+/, "")
    .replace(/\s+[-:*]+$/, "")
    .trim();
}

function normalizeEssayPrompt(value: string) {
  return cleanLabel(value)
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slug(value: string) {
  return cleanLabel(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function dedupeNodes(nodes: SyllabusNode[]) {
  const seen = new Set<string>();
  const out: SyllabusNode[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
  }
  return out;
}

function addNodes(target: SyllabusNode[], nodes: SyllabusNode[]) {
  target.push(...nodes);
}
