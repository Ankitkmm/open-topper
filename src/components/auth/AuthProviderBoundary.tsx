"use client";

import { UserDataProvider } from "./UserDataProvider";

export function AuthProviderBoundary({
  children,
  authAvailable,
}: {
  children: React.ReactNode;
  authAvailable?: boolean;
}) {
  return <UserDataProvider authAvailable={authAvailable}>{children}</UserDataProvider>;
}
