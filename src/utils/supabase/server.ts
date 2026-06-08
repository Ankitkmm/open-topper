import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/utils/supabase/schema";

export async function createClient(cookieStoreParam?: Awaited<ReturnType<typeof cookies>>) {
  const url = getSupabaseUrl();
  const key = getSupabasePublishableKey();
  if (!url || !key) throw new Error("Supabase server auth is not configured.");
  const cookieStore = cookieStoreParam ?? await cookies();

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components may not be allowed to write cookies directly.
        }
      },
    },
  });
}
