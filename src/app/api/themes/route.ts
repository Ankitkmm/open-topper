import { NextRequest } from "next/server";
import { loadOfficialRows } from "@/lib/official-pyqs";

export async function GET(req: NextRequest) {
  const subject = req.nextUrl.searchParams.get("subject")?.toLowerCase() || "";
  const rows = loadOfficialRows().filter((row) => !subject || row.subjectKey === subject || row.category.toLowerCase() === subject);

  if (subject && rows.length === 0) {
    return Response.json({ error: "Subject not found" }, { status: 404, headers: privateHeaders() });
  }

  const bySubject = new Map<string, ReturnType<typeof buildSubjectThemes>>();
  for (const subjectKey of new Set(rows.map((row) => row.subjectKey))) {
    bySubject.set(subjectKey, buildSubjectThemes(subjectKey));
  }

  const payload = subject
    ? bySubject.values().next().value
    : [...bySubject.values()].map((entry) => ({
      subject: entry.subject,
      label: entry.label,
      totalQuestions: entry.totalQuestions,
      themeCount: entry.themes.length,
    }));

  return Response.json(payload, { headers: privateHeaders() });
}

function buildSubjectThemes(subjectKey: string) {
  const rows = loadOfficialRows().filter((row) => row.subjectKey === subjectKey);
  const themes = new Map<string, { keyword: string; count: number; questionIds: string[] }>();

  for (const row of rows) {
    for (const keyword of row.keywords) {
      const key = keyword.toLowerCase();
      const entry = themes.get(key) || { keyword, count: 0, questionIds: [] };
      entry.count += 1;
      entry.questionIds.push(row.id);
      themes.set(key, entry);
    }
  }

  return {
    subject: subjectKey,
    label: rows[0]?.category || subjectKey.toUpperCase(),
    totalQuestions: rows.length,
    themes: [...themes.values()].sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword)).slice(0, 120),
  };
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}
