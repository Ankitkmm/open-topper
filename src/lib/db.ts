import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getDatabaseUrl, hasDatabaseUrl } from "./env";

type PgPool = import("pg").Pool;

let pool: PgPool | null = null;

export async function getDbPool() {
  if (!hasDatabaseUrl()) return null;
  if (pool) return pool;

  const { Pool } = await import("pg");
  pool = new Pool({
    connectionString: getDatabaseUrl(),
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: shouldUseSsl(getDatabaseUrl()) ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function withDb<T>(fn: (client: PoolClient) => Promise<T>) {
  const current = await getDbPool();
  if (!current) throw new Error("DATABASE_URL is not configured.");

  const client = await current.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function queryDb<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return withDb((client) => client.query(text, values) as Promise<QueryResult<T>>);
}

function shouldUseSsl(url: string) {
  return /render\.com|neon\.tech|supabase\.(?:co|com)|railway\.app|aws|azure|gcp/i.test(url);
}
