import { IBM_Plex_Mono, Inter, Newsreader } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SITE_NAME } from "@/lib/marketing";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

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

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex",
  display: "swap",
  weight: ["400", "500", "600"],
});

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
      className={`${inter.variable} ${newsreader.variable} ${ibmPlexMono.variable}`}
    >
      <body suppressHydrationWarning>
        <AppShell>{children}</AppShell>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
