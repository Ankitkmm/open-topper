"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/utils/supabase/schema";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase browser auth is not configured.");
  if (browserClient) return browserClient;

  browserClient = createBrowserClient<Database>(url, key);
  return browserClient;
}
