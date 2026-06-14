import type { MetadataRoute } from "next";

const SITE_URL = "https://upscat.click";

const ROUTES = [
  "",
  "/about",
  "/privacy",
  "/terms",
  "/gs1",
  "/gs2",
  "/gs3",
  "/gs4",
  "/essay",
  "/optional/geography",
  "/optional/sociology",
  "/optional/psir",
  "/optional/public-administration",
  "/optional/anthropology",
  "/optional/history",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-06-14T00:00:00.000Z");

  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified,
    changeFrequency: route ? "weekly" : "daily",
    priority: route ? 0.7 : 1,
  }));
}
