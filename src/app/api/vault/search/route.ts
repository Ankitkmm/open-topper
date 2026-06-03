export async function GET() {
  return Response.json({ error: "Vault search is not a public endpoint." }, {
    status: 410,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
    },
  });
}
