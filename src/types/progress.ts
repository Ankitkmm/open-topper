export const PROGRESS_ITEM_TYPES = ["pyq", "relevant_question", "topper_copy"] as const;

export type ProgressItemType = (typeof PROGRESS_ITEM_TYPES)[number];
export type ProgressKey = "done" | "notes" | "answer" | "full";

export interface StoredProgressRecord {
  done: boolean;
  notes: boolean;
  answer: boolean;
  full: boolean;
  itemType?: ProgressItemType;
  updatedAt?: string | null;
}

export type ProgressMap = Record<string, StoredProgressRecord>;
export type ActivityMap = Record<string, number>;

export interface ProgressItemRef {
  id: string;
  type?: ProgressItemType;
}

export interface ProgressSyncPayload {
  activityMap: ActivityMap;
  progressMap: ProgressMap;
  remoteAvailable: boolean;
  updatedAt: string | null;
}
