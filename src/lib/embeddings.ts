import { getEnv } from "./env";

const EMBED_MODEL = getEnv("EMBED_MODEL", "Xenova/all-MiniLM-L6-v2");
const EMBED_DIMENSIONS = Number.parseInt(getEnv("OPENAI_EMBEDDING_DIMENSIONS", "256"), 10) || 256;
const OPENAI_API_KEY = getEnv("OPENAI_API_KEY");
const OPENAI_BASE_URL = getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_EMBEDDING_MODEL = getEnv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small");
const ENABLE_LOCAL_EMBEDDINGS = getEnv("ENABLE_LOCAL_EMBEDDINGS") === "true";

type Extractor = (input: string | string[], options?: Record<string, unknown>) => Promise<{
  tolist: () => number[] | number[][];
}>;

let extractorPromise: Promise<Extractor> | null = null;
const queryCache = new Map<string, number[]>();

export function hasEmbeddingApi() {
  return Boolean(OPENAI_API_KEY || ENABLE_LOCAL_EMBEDDINGS);
}

export async function embedText(text: string) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  if (queryCache.has(clean)) return queryCache.get(clean)!;
  const [vector] = await embedTexts([clean]);
  if (vector) queryCache.set(clean, vector);
  return vector;
}

export async function embedTexts(texts: string[]) {
  const inputs = texts.map((text) => String(text || "").trim()).filter(Boolean);
  if (!inputs.length) return [];

  if (OPENAI_API_KEY) {
    return await embedTextsViaOpenAi(inputs);
  }

  if (!ENABLE_LOCAL_EMBEDDINGS) return [];

  const extractor = await getExtractor();
  const output = await extractor(inputs, {
    pooling: "mean",
    normalize: true,
  });
  const raw = output.tolist();
  const list = Array.isArray(raw[0]) ? raw as number[][] : [raw as number[]];
  return list.map(projectVector);
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function toVectorLiteral(vector: number[]) {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

async function embedTextsViaOpenAi(inputs: string[]) {
  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input: inputs,
      dimensions: EMBED_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed with status ${response.status}`);
  }

  const payload = await response.json() as {
    data?: Array<{ embedding: number[] }>;
  };

  return (payload.data || []).map((item) => projectVector(item.embedding || []));
}

function projectVector(vector: number[]) {
  const sliced = vector.slice(0, EMBED_DIMENSIONS);
  if (sliced.length < EMBED_DIMENSIONS) {
    return [...sliced, ...Array.from({ length: EMBED_DIMENSIONS - sliced.length }, () => 0)];
  }
  return sliced;
}

async function getExtractor() {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = typeof window !== "undefined";
    return await pipeline("feature-extraction", EMBED_MODEL, {
      quantized: true,
      progress_callback: undefined,
    }) as unknown as Extractor;
  })();
  return extractorPromise;
}
