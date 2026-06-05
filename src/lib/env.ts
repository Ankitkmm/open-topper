import { createHmac, timingSafeEqual } from "crypto";
import { loadLocalEnv } from "./bootstrap-env";

loadLocalEnv();

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_SEARCH = 120;
const DEFAULT_RATE_LIMIT_MAX_PDF = 45;
const DEFAULT_RATE_LIMIT_MAX_AUTH = 12;
const DEFAULT_RATE_LIMIT_MAX_PROGRESS = 180;
const DEFAULT_PDF_TOKEN_TTL_SECONDS = 90;

export function getEnv(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function requireEnv(name: string) {
  const value = getEnv(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function hasDatabaseUrl() {
  return Boolean(getEnv("DATABASE_URL"));
}

export function getDatabaseUrl() {
  return getEnv("DATABASE_URL");
}

export function getAuthSecret() {
  return getEnv("AUTH_SECRET", "upscat-local-secret");
}

export function getPdfTokenSecret() {
  return getEnv("PDF_TOKEN_SECRET", getAuthSecret());
}

export function getRateLimitWindowMs() {
  return parsePositiveInteger(getEnv("RATE_LIMIT_WINDOW_MS"), DEFAULT_RATE_LIMIT_WINDOW_MS);
}

export function getSearchRateLimitMax() {
  return parsePositiveInteger(getEnv("RATE_LIMIT_SEARCH_MAX"), DEFAULT_RATE_LIMIT_MAX_SEARCH);
}

export function getPdfRateLimitMax() {
  return parsePositiveInteger(getEnv("RATE_LIMIT_PDF_MAX"), DEFAULT_RATE_LIMIT_MAX_PDF);
}

export function getAuthRateLimitMax() {
  return parsePositiveInteger(getEnv("RATE_LIMIT_AUTH_MAX"), DEFAULT_RATE_LIMIT_MAX_AUTH);
}

export function getProgressRateLimitMax() {
  return parsePositiveInteger(getEnv("RATE_LIMIT_PROGRESS_MAX"), DEFAULT_RATE_LIMIT_MAX_PROGRESS);
}

export function getPdfTokenTtlSeconds() {
  return parsePositiveInteger(getEnv("PDF_TOKEN_TTL_SECONDS"), DEFAULT_PDF_TOKEN_TTL_SECONDS);
}

export function getR2PublicUrl() {
  return getEnv("R2_PUBLIC_URL").replace(/\/$/, "");
}

export function getR2BucketName() {
  return getEnv("R2_BUCKET_NAME");
}

export function getR2Endpoint() {
  return getEnv("R2_ENDPOINT");
}

export function getR2Credentials() {
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) return null;

  return { accessKeyId, secretAccessKey };
}

export function getSupabaseUrl() {
  return getEnv("NEXT_PUBLIC_SUPABASE_URL", getEnv("SUPABASE_URL"));
}

export function getSupabasePublishableKey() {
  return getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", getEnv("SUPABASE_ANON_KEY")));
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}

export function isSupabaseEmailAuthConfigured() {
  return isSupabaseConfigured();
}

export function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function signValue(payload: string) {
  return createHmac("sha256", getPdfTokenSecret()).update(payload).digest("hex");
}

export function secureEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
