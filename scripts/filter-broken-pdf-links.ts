import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const QUESTIONS_FILE = join(ROOT, "data", "app", "questions.json");
const CATEGORIES_FILE = join(ROOT, "data", "app", "categories.json");
const CACHE_DIR = join(ROOT, "data-sources", "link-validation");
const CACHE_FILE = join(CACHE_DIR, "pdf-link-status.json");
const CONCURRENCY = 12;
const TIMEOUT_MS = 15000;

type ValueAdd = {
  type: string;
  value: string;
};

type TopperEntry = {
  filename: string;
  rank: string;
  subject_marks: string;
  introduction: string;
  page: string;
  links: string;
  value_adds: ValueAdd[];
};

type QuestionGroup = {
  id: number;
  question: string;
  syllabus_tags: string[];
  keywords: string[];
  category: string;
  toppers: TopperEntry[];
};

type LinkStatus = {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  checkedAt: string;
  error?: string;
};

async function main() {
  const questions = JSON.parse(readFileSync(QUESTIONS_FILE, "utf-8")) as QuestionGroup[];
  const cache = loadCache();
  const links = collectUniqueLinks(questions);

  console.log(`Question groups: ${questions.length.toLocaleString()}`);
  console.log(`Unique non-empty links to validate: ${links.length.toLocaleString()}`);

  const missing = links.filter((link) => !cache[link]);
  console.log(`Links needing fresh validation: ${missing.length.toLocaleString()}`);

  let checked = 0;
  await runPool(missing, CONCURRENCY, async (link) => {
    cache[link] = await validateLink(link);
    checked += 1;
    if (checked % 50 === 0 || checked === missing.length) {
      console.log(`Validated ${checked.toLocaleString()} / ${missing.length.toLocaleString()} links`);
      persistCache(cache);
    }
  });
  persistCache(cache);

  const beforeQuestions = questions.length;
  let beforeToppers = 0;
  let removedMissing = 0;
  let removedBroken = 0;

  const filteredQuestions = questions
    .map((question) => {
      beforeToppers += question.toppers.length;

      const toppers = question.toppers.filter((topper) => {
        const link = normalizeLink(topper.links);
        if (!link) {
          removedMissing += 1;
          return false;
        }
        if (!cache[link]?.ok) {
          removedBroken += 1;
          return false;
        }
        topper.links = link;
        return true;
      });

      return {
        ...question,
        toppers,
      };
    })
    .filter((question) => question.toppers.length > 0)
    .map((question, index) => ({
      ...question,
      id: index + 1,
    }));

  const afterToppers = filteredQuestions.reduce((sum, question) => sum + question.toppers.length, 0);
  writeFileSync(QUESTIONS_FILE, JSON.stringify(filteredQuestions));
  writeFileSync(CATEGORIES_FILE, JSON.stringify(buildCategories(filteredQuestions)));

  console.log(`Removed topper copies with empty links: ${removedMissing.toLocaleString()}`);
  console.log(`Removed topper copies with failing links: ${removedBroken.toLocaleString()}`);
  console.log(`Question groups pruned: ${(beforeQuestions - filteredQuestions.length).toLocaleString()}`);
  console.log(`Topper entries: ${beforeToppers.toLocaleString()} -> ${afterToppers.toLocaleString()}`);
}

function collectUniqueLinks(questions: QuestionGroup[]) {
  const set = new Set<string>();
  for (const question of questions) {
    for (const topper of question.toppers) {
      const link = normalizeLink(topper.links);
      if (link) set.add(link);
    }
  }
  return [...set];
}

function normalizeLink(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.toString();
  } catch {
    return raw;
  }
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as Record<string, LinkStatus>;
  } catch {
    return {};
  }
}

function persistCache(cache: Record<string, LinkStatus>) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

async function validateLink(link: string): Promise<LinkStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(link, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; OpenTopperLinkValidator/1.0)",
        accept: "application/pdf,text/html,application/xhtml+xml,*/*",
        range: "bytes=0-1023",
      },
    });

    try {
      await response.body?.cancel();
    } catch {
      // Ignore body cancellation issues after headers are received.
    }

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || link,
      contentType: response.headers.get("content-type"),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      contentType: null,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function buildCategories(questions: QuestionGroup[]) {
  const categoryCounts: Record<string, number> = {};
  let totalToppers = 0;

  for (const group of questions) {
    categoryCounts[group.category] = (categoryCounts[group.category] || 0) + 1;
    totalToppers += group.toppers.length;
  }

  return {
    categories: Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    total_questions: questions.length,
    total_toppers: totalToppers,
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
