export type SubjectKey =
  | "gs1"
  | "gs2"
  | "gs3"
  | "gs4"
  | "essay"
  | "geography"
  | "sociology"
  | "psir"
  | "public-administration"
  | "anthropology"
  | "history";

export interface SubjectDefinition {
  key: SubjectKey;
  label: string;
  shortLabel: string;
  title: string;
  description: string;
  href: string;
  categoryLabels: string[];
  paperLabel: string;
}

export const SUBJECT_DEFINITIONS: Record<SubjectKey, SubjectDefinition> = {
  gs1: {
    key: "gs1",
    label: "GS 1",
    shortLabel: "GS I",
    title: "GS Paper I",
    description: "History, society, and geography PYQs arranged by the actual GS I syllabus.",
    href: "/gs1",
    categoryLabels: ["GS 1", "GS-1", "GS I"],
    paperLabel: "GS Paper 1",
  },
  gs2: {
    key: "gs2",
    label: "GS 2",
    shortLabel: "GS II",
    title: "GS Paper II",
    description: "Polity, governance, social justice, and IR PYQs arranged by the actual GS II syllabus.",
    href: "/gs2",
    categoryLabels: ["GS 2", "GS-2", "GS II"],
    paperLabel: "GS Paper 2",
  },
  gs3: {
    key: "gs3",
    label: "GS 3",
    shortLabel: "GS III",
    title: "GS Paper III",
    description: "Economy, agriculture, science, environment, disaster, and security PYQs arranged by the actual GS III syllabus.",
    href: "/gs3",
    categoryLabels: ["GS 3", "GS-3", "GS III"],
    paperLabel: "GS Paper 3",
  },
  gs4: {
    key: "gs4",
    label: "GS 4",
    shortLabel: "GS IV",
    title: "GS Paper IV",
    description: "Ethics and case-study PYQs arranged by the actual GS IV syllabus.",
    href: "/gs4",
    categoryLabels: ["GS 4", "GS-4", "GS IV"],
    paperLabel: "GS Paper 4",
  },
  essay: {
    key: "essay",
    label: "Essay",
    shortLabel: "Essay",
    title: "Essay",
    description: "Essay prompts grouped by theme so the search stays simple and the structure stays useful.",
    href: "/essay",
    categoryLabels: ["Essay"],
    paperLabel: "Essay",
  },
  geography: {
    key: "geography",
    label: "Geography",
    shortLabel: "Geography",
    title: "Geography Optional",
    description: "Geography optional PYQs arranged by the optional syllabus.",
    href: "/optional/geography",
    categoryLabels: ["Geography"],
    paperLabel: "Geography Optional",
  },
  sociology: {
    key: "sociology",
    label: "Sociology",
    shortLabel: "Sociology",
    title: "Sociology Optional",
    description: "Sociology optional PYQs arranged by the optional syllabus.",
    href: "/optional/sociology",
    categoryLabels: ["Sociology"],
    paperLabel: "Sociology Optional",
  },
  psir: {
    key: "psir",
    label: "PSIR",
    shortLabel: "PSIR",
    title: "PSIR Optional",
    description: "PSIR optional PYQs arranged by the optional syllabus.",
    href: "/optional/psir",
    categoryLabels: ["PSIR"],
    paperLabel: "PSIR Optional",
  },
  "public-administration": {
    key: "public-administration",
    label: "Public Administration",
    shortLabel: "Pub Ad",
    title: "Public Administration Optional",
    description: "Public Administration optional PYQs arranged by the optional syllabus.",
    href: "/optional/public-administration",
    categoryLabels: ["Public Administration", "Public-Administration", "Pub Ad"],
    paperLabel: "Public Administration Optional",
  },
  anthropology: {
    key: "anthropology",
    label: "Anthropology",
    shortLabel: "Anthropology",
    title: "Anthropology Optional",
    description: "Anthropology optional PYQs arranged by the best available syllabus cues in the repo.",
    href: "/optional/anthropology",
    categoryLabels: ["Anthropology"],
    paperLabel: "Anthropology Optional",
  },
  history: {
    key: "history",
    label: "History",
    shortLabel: "History",
    title: "History Optional",
    description: "History optional PYQs arranged by the best available syllabus cues in the repo.",
    href: "/optional/history",
    categoryLabels: ["History"],
    paperLabel: "History Optional",
  },
};

const SUBJECT_ORDER: SubjectKey[] = [
  "gs1",
  "gs2",
  "gs3",
  "gs4",
  "essay",
  "geography",
  "sociology",
  "psir",
  "public-administration",
  "anthropology",
  "history",
];

export function getSubjectDefinition(subjectKey: SubjectKey) {
  return SUBJECT_DEFINITIONS[subjectKey];
}

export function getSubjectDefinitions() {
  return SUBJECT_ORDER.map((key) => SUBJECT_DEFINITIONS[key]);
}

export function getSubjectKeyFromValue(value: string) {
  const normalized = normalizeSubjectValue(value);
  for (const definition of getSubjectDefinitions()) {
    const aliases = [definition.key, definition.label, definition.shortLabel, definition.title, ...definition.categoryLabels];
    if (aliases.some((alias) => normalizeSubjectValue(alias) === normalized)) {
      return definition.key;
    }
  }
  return null;
}

function normalizeSubjectValue(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
