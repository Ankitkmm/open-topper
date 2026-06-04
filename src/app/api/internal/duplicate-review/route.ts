import { getDuplicateReviewRecords } from "@/lib/search-status";

export async function GET(req: Request) {
  const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get("limit") || "200")));
  const payload = await getDuplicateReviewRecords(limit);
  return Response.json({ count: payload.length, rows: payload }, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
