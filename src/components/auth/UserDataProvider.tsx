"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { ActivityMap, ProgressKey, ProgressMap } from "@/lib/local-user-store";
import {
  ACTIVITY_EVENT,
  EMPTY_PROGRESS,
  mergeAnonIntoUserScope,
  normalizeScope,
  PROGRESS_EVENT,
  readActivityMapForScope,
  readProgressMapForScope,
  trackActivityForScope,
  writeProgressMapForScope,
} from "@/lib/local-user-store";
import { createClient } from "@/utils/supabase/client";

interface UserDataContextValue {
  activityMap: ActivityMap;
  authAvailable: boolean;
  isAuthenticated: boolean;
  status: "authenticated" | "loading" | "unauthenticated";
  trackActivity: (amount?: number) => void;
  progressMap: ProgressMap;
  toggleProgress: (itemId: string, key?: ProgressKey) => void;
  userEmail: string | null;
  userName: string | null;
  userScope: string;
}

const UserDataContext = createContext<UserDataContextValue | null>(null);

export function UserDataProvider({
  authAvailable,
  children,
}: {
  authAvailable: boolean;
  children: React.ReactNode;
}) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [status, setStatus] = useState<UserDataContextValue["status"]>(authAvailable ? "loading" : "unauthenticated");
  const userEmail = authUser?.email?.trim() || null;
  const userName = (typeof authUser?.user_metadata?.full_name === "string" && authUser.user_metadata.full_name.trim())
    || authUser?.email?.split("@")[0]
    || null;
  const userScope = normalizeScope(userEmail);
  const [activityMap, setActivityMap] = useState<ActivityMap>({});
  const [progressMap, setProgressMap] = useState<ProgressMap>({});

  useEffect(() => {
    if (!authAvailable) return;

    const supabase = createClient();
    let active = true;

    async function loadUser() {
      try {
        const { data } = await supabase.auth.getUser();
        if (!active) return;
        setAuthUser(data.user ?? null);
        setStatus(data.user ? "authenticated" : "unauthenticated");
      } catch {
        if (!active) return;
        setAuthUser(null);
        setStatus("unauthenticated");
      }
    }

    void loadUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
      setStatus(session?.user ? "authenticated" : "unauthenticated");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [authAvailable]);

  useEffect(() => {
    if (userScope !== "anon") {
      mergeAnonIntoUserScope(userScope);
    }
  }, [userScope]);

  useEffect(() => {
    const update = () => {
      setActivityMap(readActivityMapForScope(userScope));
      setProgressMap(readProgressMapForScope(userScope));
    };

    update();
    window.addEventListener(ACTIVITY_EVENT, update);
    window.addEventListener(PROGRESS_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, update);
      window.removeEventListener(PROGRESS_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [userScope]);

  useEffect(() => {
    if (!authAvailable || status !== "authenticated" || !userEmail) return;
    let cancelled = false;

    async function syncRemoteProgress() {
      try {
        const local = readProgressMapForScope(userScope);
        const response = await fetch("/api/progress", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const remote = progressMapFromEntries(payload?.entries || []);
        const merged = overrideProgressMap(remote, local);
        if (cancelled) return;
        setProgressMap(merged);
        writeProgressMapForScope(userScope, merged);
        await persistProgressEntries(toProgressEntries(merged, true));
      } catch {
        // Local progress remains the source of truth when sync is unavailable.
      }
    }

    void syncRemoteProgress();
    return () => {
      cancelled = true;
    };
  }, [authAvailable, status, userEmail, userScope]);

  const value = useMemo<UserDataContextValue>(
    () => ({
      activityMap,
      authAvailable,
      isAuthenticated: Boolean(authAvailable && status === "authenticated" && userEmail),
      status,
      trackActivity(amount = 1) {
        trackActivityForScope(userScope, amount);
      },
      progressMap,
      toggleProgress(itemId, key = "done") {
        const current = progressMap[itemId] || EMPTY_PROGRESS;
        const nextRecord = { ...current, [key]: !current[key], updatedAt: new Date().toISOString() };
        const next = { ...progressMap, [itemId]: nextRecord };
        setProgressMap(next);
        writeProgressMapForScope(userScope, next);
        trackActivityForScope(userScope);
        if (authAvailable && status === "authenticated" && userEmail) {
          void persistProgressEntries(toProgressEntries({ [itemId]: nextRecord }, true));
        }
      },
      userEmail,
      userName,
      userScope,
    }),
    [activityMap, authAvailable, progressMap, status, userEmail, userName, userScope],
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

async function persistProgressEntries(entries: ProgressEntry[]) {
  if (!entries.length) return;
  try {
    await fetch("/api/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
  } catch {
    // Best-effort sync only.
  }
}

type ProgressEntry = {
  itemType: string;
  itemId: string;
  done: boolean;
};

function toProgressEntries(progress: ProgressMap, includeUndone = false): ProgressEntry[] {
  return Object.entries(progress)
    .filter(([, record]) => includeUndone || record.done)
    .map(([itemId, record]) => {
      const index = itemId.indexOf(":");
      if (index > 0) {
        return {
          itemType: itemId.slice(0, index),
          itemId: itemId.slice(index + 1),
          done: Boolean(record.done),
        };
      }
      return {
        itemType: "pyq",
        itemId,
        done: Boolean(record.done),
      };
    });
}

function progressMapFromEntries(entries: ProgressEntry[]) {
  const progress: ProgressMap = {};
  for (const entry of entries) {
    const key = `${entry.itemType}:${entry.itemId}`;
    progress[key] = { ...EMPTY_PROGRESS, done: Boolean(entry.done) };
  }
  return progress;
}

function overrideProgressMap(base: ProgressMap, incoming: ProgressMap) {
  const merged: ProgressMap = { ...base };
  for (const [itemId, record] of Object.entries(incoming)) {
    merged[itemId] = {
      ...EMPTY_PROGRESS,
      ...merged[itemId],
      ...record,
    };
  }
  return merged;
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) throw new Error("useUserData must be used within UserDataProvider");
  return context;
}
