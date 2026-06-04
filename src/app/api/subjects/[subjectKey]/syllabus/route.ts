import { getSubjectKeyFromValue } from "@/lib/subject-definitions";
import { getWorkspaceSyllabusNodes } from "@/lib/question-bank";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ subjectKey: string }> },
) {
  const { subjectKey } = await params;
  const resolved = getSubjectKeyFromValue(subjectKey);
  if (!resolved) {
    return Response.json({ error: "Unknown subject." }, { status: 404 });
  }

  const rows = getWorkspaceSyllabusNodes(resolved).map((node) => ({
    id: node.id,
    label: node.label,
    parentId: node.parentId,
    subjectKey: node.subjectKey,
    questionCount: node.questionCount,
    paper: node.paper,
  }));

  return Response.json({
    subjectKey: resolved,
    rows,
  }, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
