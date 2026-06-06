// Temporary QA switch: keep public flows open without sign-in until auth is re-enabled.
const TEMPORARY_QA_AUTH_DISABLED = true;

export function isAuthTemporarilyDisabledForQa() {
  return TEMPORARY_QA_AUTH_DISABLED;
}

export function isPublicAuthAvailable() {
  if (isAuthTemporarilyDisabledForQa()) return false;

  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    && (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    ),
  );
}
