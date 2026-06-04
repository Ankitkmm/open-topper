import { getAnswerDetail } from "@/lib/db-search";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ answerId: string }> },
) {
  const { answerId } = await params;
  const record = await getAnswerDetail(answerId);

  if (!record) {
    return Response.json({ error: "Answer not found." }, {
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
