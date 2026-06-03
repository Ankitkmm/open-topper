import { IBM_Plex_Mono, Sora } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { SITE_NAME } from "@/lib/marketing";

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

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "700"],
});

const authAvailable = false;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sora.variable} ${ibmPlexMono.variable}`}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
