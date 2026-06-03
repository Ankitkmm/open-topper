/**
 * Subject configuration — safe for both client and server components.
 */
export interface SubjectConfig {
  key: string;
  label: string;
  icon: string;
  desc: string;
  gradient: string;
}

export const SUBJECTS: Record<string, SubjectConfig> = {
  "gs 1": {
    key: "gs 1",
    label: "GS Paper I",
    icon: "📜",
    desc: "History, Geography, Society",
    gradient: "from-blue-700 via-indigo-800 to-purple-900",
  },
  "gs 2": {
    key: "gs 2",
    label: "GS Paper II",
    icon: "🏛️",
    desc: "Polity, Governance, IR",
    gradient: "from-emerald-700 via-teal-800 to-cyan-900",
  },
  "gs 3": {
    key: "gs 3",
    label: "GS Paper III",
    icon: "📊",
    desc: "Economy, Environment, Security",
    gradient: "from-amber-600 via-orange-700 to-red-800",
  },
  "gs 4": {
    key: "gs 4",
    label: "GS Paper IV",
    icon: "⚖️",
    desc: "Ethics, Integrity, Aptitude",
    gradient: "from-purple-700 via-violet-800 to-pink-900",
  },
  essay: {
    key: "essay",
    label: "Essay",
    icon: "✍️",
    desc: "Essay Papers & Answers",
    gradient: "from-rose-700 via-pink-800 to-fuchsia-900",
  },
  geography: {
    key: "geography",
    label: "Geography",
    icon: "🌍",
    desc: "Geography Optional",
    gradient: "from-teal-700 via-cyan-800 to-sky-900",
  },
  sociology: {
    key: "sociology",
    label: "Sociology",
    icon: "👥",
    desc: "Sociology Optional",
    gradient: "from-orange-700 via-red-800 to-rose-900",
  },
  psir: {
    key: "psir",
    label: "PSIR",
    icon: "🌐",
    desc: "Political Science & IR",
    gradient: "from-indigo-700 via-blue-800 to-cyan-900",
  },
  "public administration": {
    key: "public administration",
    label: "Public Admin",
    icon: "🏢",
    desc: "Public Admin Optional",
    gradient: "from-stone-700 via-zinc-800 to-gray-900",
  },
  anthropology: {
    key: "anthropology",
    label: "Anthropology",
    icon: "🧬",
    desc: "Anthropology Optional",
    gradient: "from-lime-700 via-green-800 to-emerald-900",
  },
};
