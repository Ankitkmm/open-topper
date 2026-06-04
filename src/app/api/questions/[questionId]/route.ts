import { getWorkspaceQuestionById } from "@/lib/question-bank";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ questionId: string }> },
) {
  const { questionId } = await params;
  const record = getWorkspaceQuestionById(questionId);

  if (!record) {
    return Response.json({ error: "Question not found." }, {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
      },
    });
  }

  return Response.json(record, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
