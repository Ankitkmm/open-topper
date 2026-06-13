type RuntimeDataResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

type RuntimeDataBucket = {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
};

const DEFAULT_RUNTIME_DATA_PREFIX = "runtime/v1";
const RUNTIME_DATA_ERROR = "Runtime dataset is unavailable on the server.";
const loggedRuntimeDataFailures = new Set<string>();

export async function loadRuntimeJson<T>(options: {
  key: string;
  localPath: string;
  label: string;
}): Promise<RuntimeDataResult<T>> {
  const bucket = await getRuntimeDataBucket();
  if (bucket) {
    const r2Key = `${getRuntimeDataPrefix()}/${options.key}`.replace(/^\/+/, "");
    try {
      const object = await bucket.get(r2Key);
      if (object) return { ok: true, value: JSON.parse(await object.text()) as T };
      logRuntimeDataFailure(options.label, r2Key, new Error("R2 object not found"));
    } catch (error) {
      logRuntimeDataFailure(options.label, r2Key, error);
    }
  }

  try {
    const { readFile } = await import("node:fs/promises");
    return { ok: true, value: JSON.parse(await readFile(options.localPath, "utf-8")) as T };
  } catch (error) {
    logRuntimeDataFailure(options.label, options.localPath, error);
    return { ok: false, error: RUNTIME_DATA_ERROR };
  }
}

export function getRuntimeDataPrefix() {
  return (process.env["UPSCAT_RUNTIME_DATA_PREFIX"] || DEFAULT_RUNTIME_DATA_PREFIX).replace(/^\/+|\/+$/g, "");
}

async function getRuntimeDataBucket(): Promise<RuntimeDataBucket | null> {
  try {
    const mod = await import("@opennextjs/cloudflare");
    const context = await mod.getCloudflareContext({ async: true });
    const bucket = (context.env as Record<string, unknown>)["UPSCAT_RUNTIME_DATA"];
    return isRuntimeDataBucket(bucket) ? bucket : null;
  } catch {
    return null;
  }
}

function isRuntimeDataBucket(value: unknown): value is RuntimeDataBucket {
  return Boolean(value && typeof value === "object" && typeof (value as { get?: unknown }).get === "function");
}

function logRuntimeDataFailure(label: string, location: string, error: unknown) {
  const key = `${label}:${location}`;
  if (loggedRuntimeDataFailures.has(key)) return;
  loggedRuntimeDataFailures.add(key);
  console.error(`[runtime-data] Failed to load ${label} from ${location}`, error);
}
