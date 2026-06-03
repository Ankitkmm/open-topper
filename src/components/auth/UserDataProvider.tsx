"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
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
  const { data: session, status } = useSession();
  const userEmail = session?.user?.email?.trim().toLowerCase() || null;
  const userName = session?.user?.name?.trim() || null;
  const userScope = normalizeScope(userEmail || "anon");

  useEffect(() => {
    if (userScope !== "anon") {
      mergeAnonIntoUserScope(userScope);
    }
  }, [userScope]);

  const activityMap = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(ACTIVITY_EVENT, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(ACTIVITY_EVENT, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => readActivityMapForScope(userScope),
    () => ({} as ActivityMap),
  );

  const value = useMemo<UserDataContextValue>(
    () => ({
      activityMap,
      authAvailable,
      isAuthenticated: Boolean(userEmail),
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
