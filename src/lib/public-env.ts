export type SupabasePublicConfigState =
  | { ok: true; url: string; key: string }
  | { ok: false; reason: string };

export function getPublicRuntimeEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function getSupabasePublicUrl() {
  return getPublicRuntimeEnv("NEXT_PUBLIC_SUPABASE_URL", getPublicRuntimeEnv("SUPABASE_URL"));
}

export function getSupabasePublicPublishableKey() {
  return getPublicRuntimeEnv(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    getPublicRuntimeEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", getPublicRuntimeEnv("SUPABASE_ANON_KEY")),
  );
}

export function getSupabasePublicConfigState(): SupabasePublicConfigState {
  const url = getSupabasePublicUrl();
  const key = getSupabasePublicPublishableKey();
  if (!url && !key) return { ok: false, reason: "missing Supabase URL and publishable key" };
  if (!url) return { ok: false, reason: "missing Supabase URL" };
  if (!key) return { ok: false, reason: "missing Supabase publishable key" };

  const urlError = validateSupabasePublicUrl(url);
  if (urlError) return { ok: false, reason: urlError };

  const keyError = validateSupabasePublishableKey(key);
  if (keyError) return { ok: false, reason: keyError };

  return { ok: true, url, key };
}

export function isSupabasePublicConfigured() {
  return getSupabasePublicConfigState().ok;
}

export function isProductionLikePublicRuntime() {
  const nodeEnv = getPublicRuntimeEnv("NODE_ENV");
  const vercelEnv = getPublicRuntimeEnv("VERCEL_ENV");
  const publicVercelEnv = getPublicRuntimeEnv("NEXT_PUBLIC_VERCEL_ENV");

  if (vercelEnv === "preview" || publicVercelEnv === "preview") return false;

  return nodeEnv === "production"
    || vercelEnv === "production"
    || publicVercelEnv === "production";
}

function validateSupabasePublicUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Supabase URL is invalid";
  }

  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(localHttp && !isProductionLikePublicRuntime())) {
    return "Supabase URL must use HTTPS";
  }
  if (parsed.username || parsed.password) return "Supabase URL must not include credentials";
  return "";
}

function validateSupabasePublishableKey(key: string) {
  if (/[\x00-\x20\x7f]/.test(key)) return "Supabase publishable key contains invalid whitespace/control characters";

  const jwtPayload = decodeJwtPayload(key);
  if (jwtPayload?.role === "service_role") {
    return "Supabase service-role keys must not be used as public publishable keys";
  }
  return "";
}

function decodeJwtPayload(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return null;

  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;

  try {
    return JSON.parse(globalThis.atob(padded)) as { role?: unknown };
  } catch {
    return null;
  }
}
