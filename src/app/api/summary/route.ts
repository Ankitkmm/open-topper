export async function GET() {
  return Response.json(
    {
      error: "Raw OCR summaries are not exposed publicly. Use the subject workspaces for derived study insights.",
    },
    {
      status: 410,
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    },
  );
}
