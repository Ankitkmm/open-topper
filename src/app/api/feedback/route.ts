import { NextRequest, NextResponse } from "next/server";
import { validateFeedbackPayload } from "@/lib/feedback";
import { insertFeedback } from "@/lib/feedback-store";

// --- In-memory rate limiting: 5 requests per minute per IP ---

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return true;
  }

  bucket.count += 1;
  return false;
}

// --- Response headers ---

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

// --- POST handler ---

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Rate limiting
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: RESPONSE_HEADERS },
    );
  }

  // 2. Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  // 3. Validate input
  const result = validateFeedbackPayload(body);
  if (!result.valid) {
    return NextResponse.json(
      { error: result.error },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  // 4. Insert through Supabase HTTP client.
  // Table is created by supabase/migrations/20260615_feedback.sql.
  const insertResult = await insertFeedback(result.data);
  if (!insertResult.ok) {
    if (insertResult.reason !== "unconfigured") {
      console.error("[feedback] Failed to save feedback", insertResult.message);
    }
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500, headers: RESPONSE_HEADERS },
    );
  }

  // 5. Success
  return NextResponse.json(
    { success: true },
    { status: 201, headers: RESPONSE_HEADERS },
  );
}
