import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getProgressRateLimitMax, getRateLimitWindowMs } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { readBoundedJson, requireJsonMutationRequest } from "@/lib/request-guards";
import { PRIVATE_JSON_HEADERS, isEmailPasswordAuthConfigured, requireSessionResponseIfConfigured } from "@/lib/session-access";
import type { ProgressItemType } from "@/utils/supabase/schema";
import { createClient } from "@/utils/supabase/server";

const ITEM_TYPES = new Set<ProgressItemType>(["pyq", "relevant_question", "topper_copy"]);

type ProgressEntryRow = {
  item_type: ProgressItemType;
  item_id: string;
  done: boolean;
  updated_at: string;
};

export async function GET(req: NextRequest) {
  const sessionError = await requireSessionResponseIfConfigured();
  if (sessionError) return sessionError;

  if (!isEmailPasswordAuthConfigured()) {
    return Response.json({ entries: [], configured: false }, { headers: PRIVATE_JSON_HEADERS });
  }

  const limit = await checkRateLimit(req, {
    scope: "progress-read",
    max: getProgressRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many progress requests. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const supabase = await createClient(await cookies());
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user?.id) {
    return Response.json({ error: "Sign in required." }, { status: 401, headers: PRIVATE_JSON_HEADERS });
  }

  const { data, error } = await supabase
    .from("user_progress")
    .select("item_type, item_id, done, updated_at")
    .order("updated_at", { ascending: false }) as unknown as { data: ProgressEntryRow[] | null; error: { message: string } | null };

  if (error) {
    console.error("[progress] Failed to read user progress", error);
    return Response.json({ error: "Progress sync is temporarily unavailable." }, { status: 500, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json({
    configured: true,
    entries: (data || []).map((entry) => ({
      itemType: entry.item_type,
      itemId: entry.item_id,
      done: entry.done,
      updatedAt: entry.updated_at,
    })),
  }, { headers: PRIVATE_JSON_HEADERS });
}

export async function PUT(req: NextRequest) {
  const requestError = requireJsonMutationRequest(req, 64_000);
  if (requestError) return requestError;

  if (!isEmailPasswordAuthConfigured()) {
    return Response.json({ configured: false }, { status: 503, headers: PRIVATE_JSON_HEADERS });
  }

  const limit = await checkRateLimit(req, {
    scope: "progress-write",
    max: getProgressRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many progress updates. Please slow down." }, {
      status: 429,
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  const supabase = await createClient(await cookies());
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user?.id) {
    return Response.json({ error: "Sign in required." }, { status: 401, headers: PRIVATE_JSON_HEADERS });
  }

  const bodyResult = await readBoundedJson<{ entries?: Array<{ itemType?: string; itemId?: string; done?: boolean }> }>(req, 64_000);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

  const entries = (body.entries || [])
    .map((entry) => ({
      itemType: String(entry.itemType || "") as ProgressItemType,
      itemId: String(entry.itemId || "").trim(),
      done: Boolean(entry.done),
    }))
    .filter((entry) => entry.itemId.length <= 160 && ITEM_TYPES.has(entry.itemType))
    .slice(0, 500);

  if (!entries.length) {
    return Response.json({ ok: true, count: 0 }, { headers: PRIVATE_JSON_HEADERS });
  }

  const rows = entries.map((entry) => ({
    user_id: authData.user.id,
    item_type: entry.itemType,
    item_id: entry.itemId,
    done: entry.done,
  }));

  const { error } = await supabase
    .from("user_progress")
    .upsert(rows as never[], { onConflict: "user_id,item_type,item_id" });

  if (error) {
    console.error("[progress] Failed to write user progress", error);
    return Response.json({ error: "Progress sync is temporarily unavailable." }, { status: 500, headers: PRIVATE_JSON_HEADERS });
  }

  return Response.json({ ok: true, count: rows.length }, { headers: PRIVATE_JSON_HEADERS });
}
