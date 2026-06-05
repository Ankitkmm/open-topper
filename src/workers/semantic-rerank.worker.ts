import type { SearchAnswerCard } from "@/lib/search-api";

type Extractor = (input: string | string[], options?: Record<string, unknown>) => Promise<{
  tolist: () => number[] | number[][];
}>;

type WorkerInput = {
  query: string;
  cards: SearchAnswerCard[];
};

type WorkerOutput = {
  ok: boolean;
  results?: Array<{ answerId: string; rerankScore: number }>;
  error?: string;
};

let extractorPromise: Promise<Extractor> | null = null;

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  try {
    const { query, cards } = event.data;
    const queryVector = await embedText(query);
    if (!queryVector) {
      postMessage({ ok: false, error: "Query embedding unavailable." } satisfies WorkerOutput);
      return;
    }

    const results: Array<{ answerId: string; rerankScore: number }> = [];
    for (const card of cards) {
      const cardVector = await embedText([
        card.question,
        card.summary,
        card.topperName,
        card.institute || "",
        card.syllabusPath.join(" "),
        card.topicTags.join(" "),
        card.valueAdds.join(" "),
      ].join(" "));
      const semantic = cardVector ? cosineSimilarity(queryVector, cardVector) : 0;
      const rerankScore = semantic * 0.7 + (card.serverScore || card.score || 0) * 0.3;
      results.push({
        answerId: card.answerId,
        rerankScore,
      });
    }

    results.sort((a, b) => b.rerankScore - a.rerankScore || a.answerId.localeCompare(b.answerId));
    postMessage({ ok: true, results } satisfies WorkerOutput);
  } catch (error) {
    postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Browser rerank failed.",
    } satisfies WorkerOutput);
  }
};

async function embedText(text: string) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  const extractor = await getExtractor();
  const output = await extractor(clean, {
    pooling: "mean",
    normalize: true,
  });
  const raw = output.tolist();
  const vector = Array.isArray(raw[0]) ? (raw as number[][])[0] : (raw as number[]);
  return projectVector(vector);
}

function cosineSimilarity(a: number[], b: number[]) {
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

function projectVector(vector: number[]) {
  const sliced = vector.slice(0, 256);
  if (sliced.length < 256) {
    return [...sliced, ...Array.from({ length: 256 - sliced.length }, () => 0)];
  }
  return sliced;
}

async function getExtractor() {
  if (extractorPromise) return extractorPromise;
  extractorPromise = (async () => {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    return await pipeline("feature-extraction", "Xenova/paraphrase-MiniLM-L3-v2", {
      quantized: true,
      progress_callback: undefined,
    }) as unknown as Extractor;
  })();
  return extractorPromise;
}
