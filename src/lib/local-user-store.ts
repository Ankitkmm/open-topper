import type {
  ActivityMap,
  ProgressItemType,
  ProgressMap,
  StoredProgressRecord,
} from "@/types/progress";
import { PROGRESS_ITEM_TYPES } from "@/types/progress";

export type { ActivityMap, ProgressItemType, ProgressKey, ProgressMap, StoredProgressRecord } from "@/types/progress";

export const EMPTY_PROGRESS: StoredProgressRecord = {
  done: false,
  notes: false,
  answer: false,
  full: false,
  updatedAt: null,
};

const LEGACY_DONE_KEY = "openupsc:done-pyqs";
const LEGACY_PROGRESS_KEY = "openupsc:pyq-progress-v2";
const PROGRESS_VERSION = "pyq-progress-v4";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProgressItemType(value: unknown): value is ProgressItemType {
  return typeof value === "string" && PROGRESS_ITEM_TYPES.includes(value as ProgressItemType);
}

function parseCompositeItemId(itemId: string) {
  const index = itemId.indexOf(":");
  if (index <= 0) return null;
  const itemType = itemId.slice(0, index);
  const rawId = itemId.slice(index + 1);
  if (!isProgressItemType(itemType) || !rawId) return null;
  return { itemType, rawId };
}

function latestTimestamp(a?: string | null, b?: string | null) {
  if (!a) return b ?? null;
  if (!b) return a;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left)) return b;
  if (!Number.isFinite(right)) return a;
  return right > left ? b : a;
}

export function inferProgressItemType(itemId: string): ProgressItemType {
  const composite = parseCompositeItemId(itemId);
  if (composite) return composite.itemType;
  if (/^ans_[a-f0-9]{16}$/i.test(itemId)) return "topper_copy";
  if (/_ans_[a-f0-9]{16}$/i.test(itemId) || /^rel_/i.test(itemId)) return "relevant_question";
  return "pyq";
}

export function normalizeProgressRecord(itemId: string, value: unknown): StoredProgressRecord {
  const record = isRecord(value) ? value : {};
  return {
    done: Boolean(record.done),
    notes: Boolean(record.notes),
    answer: Boolean(record.answer),
    full: Boolean(record.full),
    itemType: isProgressItemType(record.itemType) ? record.itemType : inferProgressItemType(itemId),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null,
  };
}

export function sanitizeProgressMap(value: unknown): ProgressMap {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([itemId]) => typeof itemId === "string" && itemId.trim())
    .map(([itemId, record]) => [itemId, normalizeProgressRecord(itemId, record)] as const);
  return Object.fromEntries(entries);
}

export function sanitizeActivityMap(value: unknown): ActivityMap {
  if (!isRecord(value)) return {};
  const next: ActivityMap = {};
  for (const [date, count] of Object.entries(value)) {
    const parsed = Number(count);
    if (!date || !Number.isFinite(parsed) || parsed <= 0) continue;
    next[date] = Math.round(parsed);
  }
  return next;
}

function readLegacyProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  const stored = sanitizeProgressMap(safeParse<unknown>(localStorage.getItem(LEGACY_PROGRESS_KEY), {}));
  const oldDone = safeParse<string[]>(localStorage.getItem(LEGACY_DONE_KEY), []);
  for (const id of oldDone) {
    const current = stored[id] || EMPTY_PROGRESS;
    stored[id] = {
      ...current,
      done: true,
      itemType: current.itemType ?? inferProgressItemType(id),
      updatedAt: current.updatedAt ?? null,
    };
  }
  return aliasLegacyPyqKeys(stored);
}

export function mergeProgressMaps(base: ProgressMap, incoming: ProgressMap) {
  const merged: ProgressMap = { ...sanitizeProgressMap(base) };
  for (const [itemId, record] of Object.entries(sanitizeProgressMap(incoming))) {
    const existing = merged[itemId] || normalizeProgressRecord(itemId, EMPTY_PROGRESS);
    merged[itemId] = {
      done: Boolean(existing.done || record.done),
      notes: Boolean(existing.notes || record.notes),
      answer: Boolean(existing.answer || record.answer),
      full: Boolean(existing.full || record.full),
      itemType: record.itemType ?? existing.itemType ?? inferProgressItemType(itemId),
      updatedAt: latestTimestamp(existing.updatedAt, record.updatedAt),
    };
  }
  return merged;
}

export function mergeActivityMaps(base: ActivityMap, incoming: ActivityMap) {
  const merged: ActivityMap = { ...sanitizeActivityMap(base) };
  for (const [date, count] of Object.entries(sanitizeActivityMap(incoming))) {
    merged[date] = (merged[date] || 0) + count;
  }
  return merged;
}

export function mergeActivityMapsForSync(base: ActivityMap, incoming: ActivityMap) {
  const merged: ActivityMap = { ...sanitizeActivityMap(base) };
  for (const [date, count] of Object.entries(sanitizeActivityMap(incoming))) {
    merged[date] = Math.max(merged[date] || 0, count);
  }
  return merged;
}

export function readProgressMapForScope(scope: string) {
  if (typeof window === "undefined") return {};
  const normalized = normalizeScope(scope);
  const scoped = aliasLegacyPyqKeys(sanitizeProgressMap(safeParse<unknown>(localStorage.getItem(progressStorageKey(normalized)), {})));
  if (normalized === "anon") {
    return mergeProgressMaps(readLegacyProgress(), scoped);
  }
  return scoped;
}

export function writeProgressMapForScope(scope: string, value: ProgressMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(progressStorageKey(normalizeScope(scope)), JSON.stringify(aliasLegacyPyqKeys(sanitizeProgressMap(value))));
  dispatch(PROGRESS_EVENT);
}

export function readActivityMapForScope(scope: string) {
  if (typeof window === "undefined") return {};
  return sanitizeActivityMap(safeParse<unknown>(localStorage.getItem(activityStorageKey(normalizeScope(scope))), {}));
}

export function writeActivityMapForScope(scope: string, value: ActivityMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(activityStorageKey(normalizeScope(scope)), JSON.stringify(sanitizeActivityMap(value)));
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

function aliasLegacyPyqKeys(value: ProgressMap) {
  const next: ProgressMap = { ...value };
  for (const [itemId, record] of Object.entries(value)) {
    if (itemId.includes(":")) continue;
    const compositeId = `pyq:${itemId}`;
    const existing = next[compositeId];
    next[compositeId] = {
      ...normalizeProgressRecord(compositeId, existing || EMPTY_PROGRESS),
      done: Boolean(existing?.done || record.done),
      notes: Boolean(existing?.notes || record.notes),
      answer: Boolean(existing?.answer || record.answer),
      full: Boolean(existing?.full || record.full),
      itemType: "pyq",
      updatedAt: latestTimestamp(existing?.updatedAt, record.updatedAt),
    };
  }
  return next;
}
