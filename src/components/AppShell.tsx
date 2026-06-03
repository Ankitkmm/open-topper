"use client";

import { SessionProvider } from "next-auth/react";
import { UserDataProvider } from "@/components/auth/UserDataProvider";
import { ThemeProvider } from "./ThemeProvider";

interface AppShellProps {
  authAvailable: boolean;
  children: React.ReactNode;
}

export function AppShell({ children, authAvailable }: AppShellProps) {
  return (
    <SessionProvider>
      <UserDataProvider authAvailable={authAvailable}>
        <ThemeProvider>{children}</ThemeProvider>
      </UserDataProvider>
    </SessionProvider>
  );
}
