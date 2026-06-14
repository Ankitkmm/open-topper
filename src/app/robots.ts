import type { MetadataRoute } from "next";

const SITE_URL = "https://upscat.click";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about", "/privacy", "/terms", "/gs1", "/gs2", "/gs3", "/gs4", "/essay", "/optional/"],
      disallow: ["/api/", "/pdf/", "/browse", "/vault", "/account", "/data/"],
      crawlDelay: 10,
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
