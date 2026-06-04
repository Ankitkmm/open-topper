import { getSearchStatus } from "@/lib/search-status";

export async function GET() {
  const payload = await getSearchStatus();
  return Response.json(payload, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
