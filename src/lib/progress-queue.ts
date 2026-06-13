"use client";

import type { ProgressItemType } from "@/types/progress";

/**
 * A queued progress write entry, stored in localStorage when offline or
 * when the server API call fails.
 */
export interface QueuedWrite {
  id: string;
  timestamp: number;
  payload: { itemType: ProgressItemType; itemId: string; done: boolean };
  retryCount: number;
}

/**
 * Client-side offline write queue for progress syncing.
 *
 * Stores writes in localStorage when offline or when the API fails,
 * flushes on `online` event, and caps at 1000 entries (drops oldest on overflow).
 */
export class ProgressQueue {
  private queue: QueuedWrite[] = [];
  private readonly STORAGE_KEY = "upscat_progress_queue";
  private readonly MAX_ENTRIES = 1000;
  private readonly MAX_RETRIES = 3;
  private flushing = false;

  constructor() {
    this.loadFromStorage();
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        void this.flush();
      });
    }
  }

  /**
   * Add a progress write to the queue. If online, attempts an immediate flush.
   */
  enqueue(payload: QueuedWrite["payload"]): void {
    const entry: QueuedWrite = {
      id: typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
      payload,
      retryCount: 0,
    };

    this.queue.push(entry);

    // Cap at MAX_ENTRIES — drop oldest on overflow
    if (this.queue.length > this.MAX_ENTRIES) {
      this.queue = this.queue.slice(this.queue.length - this.MAX_ENTRIES);
    }

    this.persistToStorage();

    // If online, attempt flush immediately
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void this.flush();
    }
  }

  /**
   * Process queue items in order. On success: remove from queue and persist.
   * On failure: increment retryCount and stop flushing.
   * Items exceeding MAX_RETRIES are discarded.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;

    try {
      while (this.queue.length > 0) {
        const entry = this.queue[0];

        // Discard dead entries (exceeded max retries)
        if (entry.retryCount >= this.MAX_RETRIES) {
          this.queue.shift();
          this.persistToStorage();
          continue;
        }

        try {
          const res = await fetch("/api/progress", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entries: [
                {
                  itemType: entry.payload.itemType,
                  itemId: entry.payload.itemId,
                  done: entry.payload.done,
                },
              ],
            }),
          });

          if (res.ok) {
            this.queue.shift();
            this.persistToStorage();
          } else {
            // Server error — increment retry and stop
            entry.retryCount++;
            this.persistToStorage();
            break;
          }
        } catch {
          // Network error — increment retry and stop flushing
          entry.retryCount++;
          this.persistToStorage();
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Returns the current number of queued items.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear the entire queue (for logout scenarios).
   */
  clear(): void {
    this.queue = [];
    this.persistToStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.queue = parsed;
        }
      }
    } catch {
      // Corrupted storage — start fresh
      this.queue = [];
    }
  }

  private persistToStorage(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // localStorage full or unavailable — best effort
    }
  }
}

// Singleton instance
let instance: ProgressQueue | null = null;

/**
 * Get the singleton ProgressQueue instance. Creates one on first call.
 * Use this instead of constructing ProgressQueue directly.
 */
export function getProgressQueue(): ProgressQueue {
  if (!instance) {
    instance = new ProgressQueue();
  }
  return instance;
}
