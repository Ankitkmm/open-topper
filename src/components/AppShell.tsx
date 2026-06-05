"use client";

import { ThemeProvider } from "./ThemeProvider";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
