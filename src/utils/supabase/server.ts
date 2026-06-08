import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfigState } from "@/lib/public-env";
import type { Database } from "@/utils/supabase/schema";

export async function createClient(cookieStoreParam?: Awaited<ReturnType<typeof cookies>>) {
  const config = getSupabasePublicConfigState();
  if (!config.ok) throw new Error(`Supabase server auth is not configured: ${config.reason}.`);
  const cookieStore = cookieStoreParam ?? await cookies();

  return createServerClient<Database>(config.url, config.key, {
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
