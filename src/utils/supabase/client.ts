"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicPublishableKey, getSupabasePublicUrl } from "@/lib/public-env";
import type { Database } from "@/utils/supabase/schema";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  const url = getSupabasePublicUrl();
  const key = getSupabasePublicPublishableKey();
  if (!url || !key) throw new Error("Supabase browser auth is not configured.");
  if (browserClient) return browserClient;

  browserClient = createBrowserClient<Database>(url, key);
  return browserClient;
}
