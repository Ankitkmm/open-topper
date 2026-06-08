import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SITE_NAME } from "@/lib/marketing";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  metadataBase: new URL("https://upscat.click"),
  title: SITE_NAME,
  description: "Track UPSC prep, search PYQs faster, and revisit the right topics at the right time.",
  openGraph: {
    title: SITE_NAME,
    description: "Track UPSC prep, search PYQs faster, and revisit the right topics at the right time.",
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: "Track UPSC prep, search PYQs faster, and revisit the right topics at the right time.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
        <Analytics />
      </body>
    </html>
  );
}
