import { createHmac, timingSafeEqual } from "crypto";
import { loadLocalEnv } from "./bootstrap-env";
import {
  getSupabasePublicConfigState,
  getSupabasePublicPublishableKey,
  getSupabasePublicUrl,
  isProductionLikePublicRuntime,
} from "./public-env";

loadLocalEnv();

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_SEARCH = 120;
const DEFAULT_RATE_LIMIT_MAX_PDF = 45;
const DEFAULT_RATE_LIMIT_MAX_AUTH = 12;
const DEFAULT_RATE_LIMIT_MAX_PROGRESS = 180;
const DEFAULT_PDF_TOKEN_TTL_SECONDS = 300;
const DEFAULT_PDF_UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_PDF_TOKEN_TTL_SECONDS = 300;
const MAX_PDF_UPSTREAM_TIMEOUT_MS = 30_000;
const LOCAL_AUTH_SECRET_FALLBACK = "upscat-local-secret";
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const KNOWN_WEAK_SECRETS = new Set([
  LOCAL_AUTH_SECRET_FALLBACK,
  "changeme",
  "change-me",
  "change_me",
  "development",
  "dev-secret",
  "secret",
  "test-secret",
]);

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
  const value = getEnv("AUTH_SECRET");
  if (!value) {
    if (isProductionLikeRuntime()) {
      throw new Error("Missing required environment variable: AUTH_SECRET");
    }
    return LOCAL_AUTH_SECRET_FALLBACK;
  }
  return assertProductionSecret("AUTH_SECRET", value);
}

export function getPdfTokenSecret() {
  const value = getEnv("PDF_TOKEN_SECRET");
  if (!value) {
    if (isProductionLikeRuntime()) {
      throw new Error("Missing required environment variable: PDF_TOKEN_SECRET");
    }
    return getAuthSecret();
  }
  return assertProductionSecret("PDF_TOKEN_SECRET", value);
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
  return parsePositiveInteger(getEnv("PDF_TOKEN_TTL_SECONDS"), DEFAULT_PDF_TOKEN_TTL_SECONDS, MAX_PDF_TOKEN_TTL_SECONDS);
}

export function getPdfUpstreamTimeoutMs() {
  return parsePositiveInteger(getEnv("PDF_UPSTREAM_TIMEOUT_MS"), DEFAULT_PDF_UPSTREAM_TIMEOUT_MS, MAX_PDF_UPSTREAM_TIMEOUT_MS);
}

export function getR2PublicUrl() {
  return getEnv("R2_PUBLIC_URL").replace(/\/$/, "");
}

export function getR2AllowedPublicHosts() {
  return getEnv("R2_ALLOWED_PUBLIC_HOSTS")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
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
  return getSupabasePublicUrl();
}

export function getSupabasePublishableKey() {
  return getSupabasePublicPublishableKey();
}

export function isSupabaseConfigured() {
  return getSupabasePublicConfigState().ok;
}

export function isSupabaseEmailAuthConfigured() {
  return isSupabaseConfigured();
}

export function parsePositiveInteger(value: string, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function isProductionLikeRuntime() {
  return isProductionLikePublicRuntime();
}

export function assertProductionPdfSecrets() {
  if (!isProductionLikeRuntime()) return;
  getAuthSecret();
  getPdfTokenSecret();
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

function assertProductionSecret(name: string, value: string) {
  if (!isProductionLikeRuntime()) return value;

  const normalized = value.trim();
  if (normalized.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`);
  }
  if (KNOWN_WEAK_SECRETS.has(normalized.toLowerCase())) {
    throw new Error(`${name} is using an unsafe development placeholder in production.`);
  }

  return normalized;
}
