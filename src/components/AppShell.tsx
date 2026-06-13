"use client";

import { FeedbackWidget } from "./FeedbackWidget";
import { ThemeProvider } from "./ThemeProvider";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <ThemeProvider>
      {children}
      <FeedbackWidget />
    </ThemeProvider>
  );
}
