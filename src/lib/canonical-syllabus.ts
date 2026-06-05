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
  essayPromptByNormalized: Map<string, string>;
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

type OptionalMarkdownSubjectKey = "geography" | "public-administration" | "anthropology";

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
  const essayPromptByNormalized = new Map<string, string>();

  addNodes(allNodes, parseGsCore());
  addNodes(allNodes, parseGs4());
  addNodes(allNodes, parseEssay(essaySectionByPrompt, essayPromptByNormalized));
  addNodes(allNodes, parseExtractedSubject("sociology", "socio"));
  addNodes(allNodes, parseExtractedSubject("psir", "psir"));
  addNodes(allNodes, parseExtractedSubject("history", "history"));
  addNodes(allNodes, parseOptionalMarkdownSubject("public-administration"));
  addNodes(allNodes, parseOptionalMarkdownSubject("geography"));
  addNodes(allNodes, parseOptionalMarkdownSubject("anthropology"));

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
    essayPromptByNormalized,
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
    const sourceLabel = cleanLabel(line);
    const cleaned = cleanSyllabusDisplayLabel(sourceLabel, "gs4");
    if (!cleaned || isNoisySyllabusLine(cleaned, "gs4")) continue;
    if (!/[A-Za-z]/.test(cleaned)) continue;
    nodes.push({
      id: `gs4:topic:${slug(sourceLabel)}`,
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

function parseEssay(
  essaySectionByPrompt: Map<string, string>,
  essayPromptByNormalized: Map<string, string>,
): SyllabusNode[] {
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
    const normalized = normalizeEssayPrompt(prompt);
    const sectionId = `essay:topic:${slug(currentSection)}`;
    essaySectionByPrompt.set(normalized, sectionId);
    essayPromptByNormalized.set(normalized, prompt);
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

function parseOptionalMarkdownSubject(subjectKey: OptionalMarkdownSubjectKey): SyllabusNode[] {
  if (!existsSync(OPTIONAL_SYLLABUS_FILE)) return [];
  const raw = readFileSync(OPTIONAL_SYLLABUS_FILE, "utf-8");

  const subjectRanges: Record<OptionalMarkdownSubjectKey, { start: string; end?: string }> = {
    geography: {
      start: "Geography Syllabus",
      end: "Syllabus of Anthropology Paper - I",
    },
    "public-administration": {
      start: "**Syllabus of Public Administration Paper - I**",
      end: "Geography Syllabus",
    },
    anthropology: {
      start: "Syllabus of Anthropology Paper - I",
    },
  };

  const range = subjectRanges[subjectKey];
  const section = sliceSection(raw, range.start, range.end);
  if (!section) return [];
  if (subjectKey === "geography") return parseGeographyOptional(section);

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
    if (NOISE_LINES.has(lowered) || isNoisySyllabusLine(cleaned, subjectKey)) continue;

    if (
      /^paper[\s-]*1\b/i.test(cleaned)
      || /^syllabus of public administration paper - i$/i.test(cleaned)
      || /^syllabus of anthropology paper - i$/i.test(cleaned)
    ) {
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
    if (
      /^paper[\s-]*2\b/i.test(cleaned)
      || /^syllabus of public administration paper - ii$/i.test(cleaned)
      || /^syllabus of anthropology paper - ii$/i.test(cleaned)
    ) {
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
    const numberedTopic = extractNumberedTopic(cleaned);
    if (numberedTopic) {
      const topic = cleanSyllabusDisplayLabel(numberedTopic, subjectKey);
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
        id: `${subjectKey}:topic:${slug(numberedTopic)}`,
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

function parseGeographyOptional(section: string): SyllabusNode[] {
  const normalized = cleanLabel(section);
  if (!normalized) return [];

  const paper1Start = normalized.search(/\bPAPER-?1\b/i);
  const paper2Start = normalized.search(/\bPAPER-?2\b/i);
  if (paper1Start < 0 || paper2Start < 0) return [];

  const paper1 = normalized.slice(paper1Start, paper2Start);
  const paper2 = normalized.slice(paper2Start);
  const nodes: SyllabusNode[] = [];
  let order = 0;

  order = addGeographyPaperNodes(nodes, "Paper 1", paper1, order);
  addGeographyPaperNodes(nodes, "Paper 2", paper2, order);

  return dedupeNodes(nodes);
}

function addGeographyPaperNodes(
  nodes: SyllabusNode[],
  paperLabel: string,
  text: string,
  order: number,
) {
  const subjectKey: OptionalMarkdownSubjectKey = "geography";
  const paperId = `${subjectKey}:group:${slug(paperLabel)}`;

  const headingMatches = [...text.matchAll(/(?:^|\s)(Physical Geography|Human Geography|GEOGRAPHY OF INDIA)\s+/gi)];
  if (!headingMatches.length) {
    nodes.push({
      id: paperId,
      subjectKey,
      label: paperLabel,
      parentId: null,
      order: order++,
      kind: "group",
      paper: paperLabel,
    });
  }

  const ranges = headingMatches.length
    ? headingMatches.map((match, index) => ({
        label: titleCaseGeographyHeading(match[1]),
        start: (match.index || 0) + match[0].length,
        end: index + 1 < headingMatches.length ? headingMatches[index + 1].index || text.length : text.length,
      }))
    : [{ label: paperLabel, start: 0, end: text.length }];

  for (const range of ranges) {
    const groupLabel = range.label === paperLabel ? paperLabel : `${paperLabel}: ${range.label}`;
    const groupId = `${subjectKey}:group:${slug(groupLabel)}`;
    if (groupId !== paperId) {
      nodes.push({
        id: groupId,
        subjectKey,
        label: groupLabel,
        parentId: null,
        order: order++,
        kind: "group",
        paper: paperLabel,
      });
    }

    const chunk = text.slice(range.start, range.end);
    const topicPattern = /(?:^|\s)(\d{1,2})\.\s+([^:]{2,120}?):\s+/g;
    const matches = [...chunk.matchAll(topicPattern)];
    for (const [index, match] of matches.entries()) {
      const rawTitle = cleanLabel(match[2]);
      const detailsStart = (match.index || 0) + match[0].length;
      const detailsEnd = index + 1 < matches.length ? matches[index + 1].index || chunk.length : chunk.length;
      const details = cleanLabel(chunk.slice(detailsStart, detailsEnd));
      const topic = cleanSyllabusDisplayLabel(`${rawTitle}: ${details}`, subjectKey);
      if (!topic || isNoisySyllabusLine(topic, subjectKey)) continue;
      nodes.push({
        id: `${subjectKey}:topic:${slug(`${paperLabel}-${rawTitle}`)}`,
        subjectKey,
        label: topic,
        parentId: groupId,
        order: order++,
        kind: "topic",
        paper: paperLabel,
      });
    }
  }

  return order;
}

function titleCaseGeographyHeading(value: string) {
  const cleaned = cleanLabel(value);
  if (/^GEOGRAPHY OF INDIA$/i.test(cleaned)) return "Geography of India";
  return cleaned.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
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
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[-:*]+/, "")
    .replace(/\s+[-:*]+$/, "")
    .trim();
}

function cleanSyllabusDisplayLabel(value: string, subjectKey: SubjectKey) {
  let cleaned = cleanLabel(value)
    .replace(/\s+Read more at:\s*\S+.*$/i, "")
    .replace(/\s*https?:\/\/\S+.*$/i, "")
    .replace(/\s*www\.\S+.*$/i, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/:\s*:/g, ":")
    .replace(/\s+/g, " ")
    .trim();

  if (subjectKey === "gs4") {
    const gs4Title = compactGs4Label(cleaned);
    if (gs4Title) return gs4Title;
  }
  if (subjectKey === "anthropology") {
    cleaned = cleaned.replace(/^\([a-z]\)\s*/i, "");
  }

  if (subjectKey === "public-administration") {
    const compact = compactPublicAdministrationLabel(cleaned);
    if (compact) return compact;
  }

  if (subjectKey === "geography" && cleaned.includes(":")) {
    const title = cleanLabel(cleaned.split(":")[0]);
    if (title && title.length <= 80) cleaned = title;
  } else if (subjectKey === "anthropology" && cleaned.includes(":")) {
    const title = cleanLabel(cleaned.split(":")[0]);
    if (title && title.length <= 100) cleaned = title;
  } else if (subjectKey === "anthropology" && /\s+[—–-]\s+|[—–]\s+/.test(cleaned)) {
    const title = cleanLabel(cleaned.split(/\s+[—–-]\s+|[—–]\s+/)[0]);
    if (title && title.length >= 12 && title.length <= 100) cleaned = title;
  } else if (subjectKey === "anthropology" && cleaned.includes(";")) {
    const title = cleanLabel(cleaned.split(";")[0]);
    if (title && title.length >= 12 && title.length <= 100) cleaned = title;
  } else if (subjectKey === "anthropology" && cleaned.includes(",")) {
    const title = cleanLabel(cleaned.split(",")[0]);
    if (title && title.length >= 12 && title.length <= 100) cleaned = title;
  }
  if (subjectKey === "anthropology") cleaned = cleaned.replace(/[.:]\s*$/, "");

  return cleanLabel(cleaned);
}

function compactGs4Label(value: string) {
  const lowered = value.toLowerCase();
  if (lowered.startsWith("ethics and human interface")) return "Ethics and Human Interface";
  if (lowered.startsWith("attitude:")) return "Attitude";
  if (lowered.startsWith("aptitude and foundational values")) return "Aptitude and Foundational Values";
  if (lowered.startsWith("emotional intelligence")) return "Emotional Intelligence";
  if (lowered.startsWith("contributions of moral thinkers")) return "Moral Thinkers and Philosophers";
  if (lowered.startsWith("public/civil service values")) return "Public/Civil Service Values";
  if (lowered.startsWith("probity in governance")) return "Probity in Governance";
  if (lowered.startsWith("case studies on above issues")) return "Case Studies";
  return "";
}

function compactPublicAdministrationLabel(value: string) {
  const title = cleanLabel(value.split(":")[0]);
  const compactLabels: Record<string, string> = {
    "Introduction": "Introduction: Wilson, NPA, Public Choice, LPG, Good Governance, NPM",
    "Administrative Thought": "Administrative Thought: Taylor, Classical Theory, Weber, Follett, Mayo, Barnard, Simon",
    "Administrative Behaviour": "Administrative Behaviour: Decision-making, Communication, Morale, Motivation, Leadership",
    "Organisations": "Organisations: Theory, structures, boards, field relations, regulation, PPP",
    "Accountability and Control": "Accountability and Control: legislature, executive, judiciary, media, civil society, RTI, social audit",
    "Administrative Law": "Administrative Law: Dicey, delegated legislation, tribunals",
    "Comparative Public Administration": "Comparative Public Administration: politics, ecology, Riggsian models",
    "Development Dynamics": "Development Dynamics: bureaucracy, market, liberalisation, women, SHGs",
    "Personnel Administration": "Personnel Administration: HRD, recruitment, training, appraisal, pay, relations, ethics",
    "Public Policy": "Public Policy: models, formulation, implementation, monitoring, evaluation",
    "Techniques of Administrative Improvement": "Administrative Improvement: O&M, work study, e-governance, MIS, PERT/CPM",
    "Financial Administration": "Financial Administration: fiscal policy, debt, budgets, accountability, audit",
    "Evolution of Indian Administration": "Evolution of Indian Administration: Kautilya, Mughal, British legacy, services, district/local government",
    "Philosophical and Constitutional framework of Government": "Constitutional Framework: values, constitutionalism, political culture, bureaucracy, democracy",
    "Public Sector Undertakings": "Public Sector Undertakings: forms, autonomy, accountability, liberalization, privatization",
    "Union Government and Administration": "Union Government: executive, Parliament, judiciary, Cabinet, PMO, ministries, field offices",
    "Plans and Priorities": "Plans and Priorities: Planning Commission, NDC, indicative/decentralized planning",
    "State Government and Administration": "State Government: Union-State relations, Finance Commission, Governor, CM, Secretariat",
    "District Administration since Independence": "District Administration: Collector, local relations, development, law and order",
    "Civil Services": "Civil Services: status, recruitment, training, capacity, governance, conduct, neutrality",
    "Financial Management": "Financial Management: budget, expenditure control, finance ministry, accounting, audit, CAG",
    "Administrative Reforms since Independence": "Administrative Reforms: committees, financial management, HRD, implementation",
    "Rural Development": "Rural Development: institutions, programmes, decentralization, Panchayati Raj",
    "Urban Local Government": "Urban Local Government: municipal governance, finance, 74th Amendment, city management",
    "Law and Order Administration": "Law and Order Administration: police, agencies, paramilitary, insurgency, reforms",
    "Significant issues in Indian Administration": "Issues in Indian Administration: values, regulators, NHRC, coalition, corruption, disaster management",
  };
  return compactLabels[title] || "";
}

function extractNumberedTopic(value: string) {
  const cleaned = cleanLabel(value);
  const match = cleaned.match(/^(?:\d+(?:\.\d+)*\.?|[A-Z]\.)\s*(.+)$/);
  if (!match) return "";
  return cleanLabel(match[1]);
}

function isNoisySyllabusLine(value: string, subjectKey?: SubjectKey) {
  const cleaned = cleanLabel(value);
  const lowered = cleaned.toLowerCase();
  if (!cleaned) return true;
  if (NOISE_LINES.has(lowered)) return true;
  if (cleaned.startsWith("|")) return true;
  if (/^[-|\s]+$/.test(cleaned)) return true;
  if (/^online\/offline programme/i.test(cleaned)) return true;
  if (/^(?:delhi|prayagraj|buy now)(?:\s|$)/i.test(cleaned)) return true;
  if (/https?:\/\//i.test(cleaned) || /\bwww\./i.test(cleaned) || /@/.test(cleaned)) return true;
  if (/\bread more at\b/i.test(cleaned)) return true;
  if (subjectKey === "gs4" && /^this paper will include questions\b/i.test(cleaned)) return true;
  if (subjectKey === "gs4" && /^the following broad areas will be covered\b/i.test(cleaned)) return true;
  return false;
}

function normalizeEssayPrompt(value: string) {
  return cleanLabel(value)
    .toLowerCase()
    .replace(/^(?:section\s+[ab]\s+|topic\s+\d+\s+)?q(?:uestion)?\.?\s*\d+[a-z]?\)?\s*/i, "")
    .replace(/^\d+[a-z]?[.)]\s*/, "")
    .replace(/^["“”']+|["“”']+$/g, "")
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
