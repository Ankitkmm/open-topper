"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfigState } from "@/lib/public-env";
import type { Database } from "@/utils/supabase/schema";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  const config = getSupabasePublicConfigState();
  if (!config.ok) throw new Error(`Supabase browser auth is not configured: ${config.reason}.`);
  if (browserClient) return browserClient;

  browserClient = createBrowserClient<Database>(config.url, config.key);
  return browserClient;
}
