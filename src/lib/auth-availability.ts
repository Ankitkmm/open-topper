import {
  getSupabasePublicConfigState,
  isProductionLikePublicRuntime,
} from "./public-env";

// Temporary QA switch: keep public flows open without sign-in outside production until auth is re-enabled.
// Production must fail closed when Supabase auth is missing/misconfigured; do not hardcode this to true.
export type PublicAuthState =
  | { mode: "qa-disabled" }
  | { mode: "configured" }
  | { mode: "unconfigured-dev" }
  | { mode: "misconfigured-production"; reason: string };

export function isAuthTemporarilyDisabledForQa() {
  if (isProductionLikePublicRuntime()) return false;

  const explicit = parseBooleanEnv(process.env["NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED"]);
  return explicit ?? true;
}

export function getPublicAuthState(): PublicAuthState {
  if (isAuthTemporarilyDisabledForQa()) return { mode: "qa-disabled" };

  const state = getSupabasePublicConfigState();
  if (state.ok) return { mode: "configured" };

  if (isProductionLikePublicRuntime()) {
    return {
      mode: "misconfigured-production",
      reason: `Supabase auth env is required in production; ${state.reason}.`,
    };
  }

  return { mode: "unconfigured-dev" };
}

export function isPublicAuthAvailable() {
  return getPublicAuthState().mode === "configured";
}

export function shouldFailClosedForMissingAuth() {
  return getPublicAuthState().mode === "misconfigured-production";
}

export function sanitizeInternalNextPath(value: string | null | undefined, fallback = "/") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\x00-\x1f\x7f]/.test(raw)) return fallback;
  if (/^\/(?:%2f|%5c)/i.test(raw)) return fallback;

  try {
    const base = "https://upscat.local";
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function parseBooleanEnv(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}
