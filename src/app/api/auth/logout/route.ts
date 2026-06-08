import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireSameOriginMutation } from "@/lib/request-guards";
import { PRIVATE_JSON_HEADERS, isEmailPasswordAuthConfigured } from "@/lib/session-access";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const originError = requireSameOriginMutation(req);
  if (originError) return originError;

  if (!isEmailPasswordAuthConfigured()) {
    return Response.json({ ok: true }, { headers: PRIVATE_JSON_HEADERS });
  }

  const supabase = await createClient(await cookies());
  await supabase.auth.signOut();
  return Response.json({ ok: true }, { headers: PRIVATE_JSON_HEADERS });
}
