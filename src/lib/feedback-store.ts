import { createClient } from "@supabase/supabase-js";
import { getSupabasePublicConfigState } from "@/lib/public-env";
import type { FeedbackPayload } from "@/lib/feedback";
import type { Database } from "@/utils/supabase/schema";

let feedbackClient: ReturnType<typeof createClient<Database>> | null = null;

export async function insertFeedback(payload: FeedbackPayload) {
  const config = getSupabasePublicConfigState();
  if (!config.ok) {
    return { ok: false as const, reason: "unconfigured" as const, message: config.reason };
  }

  const supabase = feedbackClient ?? createClient<Database>(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  feedbackClient = supabase;

  const { error } = await supabase
    .from("feedback")
    .insert({
      page_path: payload.page_path,
      category: payload.category,
      message: payload.message,
    });

  if (error) {
    return { ok: false as const, reason: "insert_failed" as const, message: error.message };
  }

  return { ok: true as const };
}
