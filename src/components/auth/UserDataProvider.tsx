"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ActivityMap } from "@/lib/local-user-store";
import {
  ACTIVITY_EVENT,
  mergeAnonIntoUserScope,
  normalizeScope,
  readActivityMapForScope,
  trackActivityForScope,
} from "@/lib/local-user-store";

interface UserDataContextValue {
  activityMap: ActivityMap;
  authAvailable: boolean;
  isAuthenticated: boolean;
  status: "authenticated" | "loading" | "unauthenticated";
  trackActivity: (amount?: number) => void;
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
  const userEmail = null;
  const userName = null;
  const userScope = normalizeScope("anon");
  const status = "unauthenticated" as const;
  const [activityMap, setActivityMap] = useState<ActivityMap>({});

  useEffect(() => {
    if (userScope !== "anon") {
      mergeAnonIntoUserScope(userScope);
    }
  }, [userScope]);

  useEffect(() => {
    const update = () => {
      setActivityMap(readActivityMapForScope(userScope));
    };

    update();
    window.addEventListener(ACTIVITY_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [userScope]);

  const value = useMemo<UserDataContextValue>(
    () => ({
      activityMap,
      authAvailable,
      isAuthenticated: false,
      status,
      trackActivity(amount = 1) {
        trackActivityForScope(userScope, amount);
      },
      userEmail,
      userName,
      userScope,
    }),
    [activityMap, authAvailable, status, userEmail, userName, userScope],
  );

  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) throw new Error("useUserData must be used within UserDataProvider");
  return context;
}
