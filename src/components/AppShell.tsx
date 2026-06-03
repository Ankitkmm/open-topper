"use client";

import { UserDataProvider } from "@/components/auth/UserDataProvider";
import { ThemeProvider } from "./ThemeProvider";

interface AppShellProps {
  authAvailable: boolean;
  children: React.ReactNode;
}

export function AppShell({ children, authAvailable }: AppShellProps) {
  return (
    <UserDataProvider authAvailable={authAvailable}>
      <ThemeProvider>{children}</ThemeProvider>
    </UserDataProvider>
  );
}
