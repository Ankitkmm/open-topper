import type { NextRequest } from "next/server";
import { hasDatabaseUrl } from "./env";
import { queryDb } from "./db";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

let rateLimitTableReady = false;

export async function checkRateLimit(req: NextRequest, options: { scope: string; max: number; windowMs: number }) {
  if (hasDatabaseUrl()) {
    return checkDatabaseRateLimit(req, options);
  }
  return checkMemoryRateLimit(req, options);
}

function checkMemoryRateLimit(req: NextRequest, options: { scope: string; max: number; windowMs: number }) {
  const key = `${options.scope}:${clientIdentity(req)}`;
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return {
      ok: true,
      remaining: options.max - 1,
      resetAt: now + options.windowMs,
    };
  }

  if (current.count >= options.max) {
    return {
      ok: false,
      remaining: 0,
      resetAt: current.resetAt,
    };
  }

  current.count += 1;
  return {
    ok: true,
    remaining: Math.max(0, options.max - current.count),
    resetAt: current.resetAt,
  };
}

async function checkDatabaseRateLimit(req: NextRequest, options: { scope: string; max: number; windowMs: number }) {
  await ensureRateLimitTable();
  const identity = clientIdentity(req);
  const now = Date.now();
  const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
  const resetAt = windowStart + options.windowMs;

  const result = await queryDb<{ hit_count: number }>(
    `insert into api_rate_limits (scope, client_key, window_started_at, hit_count, expires_at)
     values ($1, $2, to_timestamp($3 / 1000.0), 1, to_timestamp($4 / 1000.0))
     on conflict (scope, client_key, window_started_at)
     do update set hit_count = api_rate_limits.hit_count + 1, expires_at = excluded.expires_at
     returning hit_count`,
    [options.scope, identity, windowStart, resetAt],
  );

  const hitCount = Number(result.rows[0]?.hit_count || 1);
  return {
    ok: hitCount <= options.max,
    remaining: Math.max(0, options.max - hitCount),
    resetAt,
  };
}

async function ensureRateLimitTable() {
  if (rateLimitTableReady) return;
  await queryDb(`
    create table if not exists api_rate_limits (
      scope text not null,
      client_key text not null,
      window_started_at timestamptz not null,
      hit_count integer not null default 0,
      expires_at timestamptz not null,
      primary key (scope, client_key, window_started_at)
    )
  `);
  rateLimitTableReady = true;
}

function clientIdentity(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = req.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "local";
}
