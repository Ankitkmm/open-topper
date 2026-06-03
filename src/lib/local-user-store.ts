export type ProgressKey = "done" | "notes" | "answer" | "full";
export type ProgressRecord = Record<ProgressKey, boolean>;
export type ProgressMap = Record<string, ProgressRecord>;
export type ActivityMap = Record<string, number>;

export const EMPTY_PROGRESS: ProgressRecord = {
  done: false,
  notes: false,
  answer: false,
  full: false,
};

const LEGACY_DONE_KEY = "openupsc:done-pyqs";
const LEGACY_PROGRESS_KEY = "openupsc:pyq-progress-v2";
const PROGRESS_VERSION = "pyq-progress-v3";
const ACTIVITY_VERSION = "activity-v1";
export const PROGRESS_EVENT = "upscat-progress";
export const ACTIVITY_EVENT = "upscat-activity";

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function progressStorageKey(scope: string) {
  return `upscat:${scope}:${PROGRESS_VERSION}`;
}

function activityStorageKey(scope: string) {
  return `upscat:${scope}:${ACTIVITY_VERSION}`;
}

function mergeMarkerKey(scope: string) {
  return `upscat:${scope}:merged-anon-v1`;
}

function dispatch(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}

export function normalizeScope(scope: string | null | undefined) {
  return scope?.trim() ? scope.trim().toLowerCase() : "anon";
}

function getTodayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readLegacyProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  const stored = safeParse<Record<string, ProgressRecord>>(localStorage.getItem(LEGACY_PROGRESS_KEY), {});
  const oldDone = safeParse<string[]>(localStorage.getItem(LEGACY_DONE_KEY), []);
  for (const id of oldDone) {
    stored[id] ||= { ...EMPTY_PROGRESS };
    stored[id].done = true;
  }
  return stored;
}

export function mergeProgressMaps(base: ProgressMap, incoming: ProgressMap) {
  const merged: ProgressMap = { ...base };
  for (const [questionId, record] of Object.entries(incoming)) {
    const existing = merged[questionId] || EMPTY_PROGRESS;
    merged[questionId] = {
      done: Boolean(existing.done || record.done),
      notes: Boolean(existing.notes || record.notes),
      answer: Boolean(existing.answer || record.answer),
      full: Boolean(existing.full || record.full),
    };
  }
  return merged;
}

export function mergeActivityMaps(base: ActivityMap, incoming: ActivityMap) {
  const merged: ActivityMap = { ...base };
  for (const [date, count] of Object.entries(incoming)) {
    merged[date] = (merged[date] || 0) + count;
  }
  return merged;
}

export function readProgressMapForScope(scope: string) {
  if (typeof window === "undefined") return {};
  const normalized = normalizeScope(scope);
  const scoped = safeParse<ProgressMap>(localStorage.getItem(progressStorageKey(normalized)), {});
  if (normalized === "anon") {
    return mergeProgressMaps(readLegacyProgress(), scoped);
  }
  return scoped;
}

export function writeProgressMapForScope(scope: string, value: ProgressMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(progressStorageKey(normalizeScope(scope)), JSON.stringify(value));
  dispatch(PROGRESS_EVENT);
}

export function readActivityMapForScope(scope: string) {
  if (typeof window === "undefined") return {};
  return safeParse<ActivityMap>(localStorage.getItem(activityStorageKey(normalizeScope(scope))), {});
}

export function writeActivityMapForScope(scope: string, value: ActivityMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(activityStorageKey(normalizeScope(scope)), JSON.stringify(value));
  dispatch(ACTIVITY_EVENT);
}

export function trackActivityForScope(scope: string, amount = 1, date = new Date()) {
  const normalized = normalizeScope(scope);
  const current = readActivityMapForScope(normalized);
  const key = getTodayKey(date);
  const next = { ...current, [key]: (current[key] || 0) + amount };
  writeActivityMapForScope(normalized, next);
  return next;
}

export function mergeAnonIntoUserScope(scope: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizeScope(scope);
  if (normalized === "anon") return;
  if (localStorage.getItem(mergeMarkerKey(normalized)) === "1") return;

  const anonProgress = readProgressMapForScope("anon");
  const anonActivity = readActivityMapForScope("anon");
  const userProgress = readProgressMapForScope(normalized);
  const userActivity = readActivityMapForScope(normalized);

  if (Object.keys(anonProgress).length > 0) {
    writeProgressMapForScope(normalized, mergeProgressMaps(userProgress, anonProgress));
  }
  if (Object.keys(anonActivity).length > 0) {
    writeActivityMapForScope(normalized, mergeActivityMaps(userActivity, anonActivity));
  }

  localStorage.setItem(mergeMarkerKey(normalized), "1");
}
