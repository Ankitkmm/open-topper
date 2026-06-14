import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "frame-src 'self' https://pub-3476e7cc4efd44b58da659c67aad1348.r2.dev https://*.r2.dev https://*.r2.cloudflarestorage.com",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' https://pub-3476e7cc4efd44b58da659c67aad1348.r2.dev https://*.r2.dev https://*.r2.cloudflarestorage.com https://*.supabase.co wss://*.supabase.co",
      "form-action 'self'",
    ].join("; "),
  },
];

const apiSecurityHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  ...securityHeaders,
  { key: "Cache-Control", value: "private, no-store" },
];

const pdfProxyHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "Cache-Control", value: "private, no-store" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/answer-source": [
      "data/pdf-runtime/answer-sources.json",
      "data/pdf-runtime/pdf-r2-map.json",
    ],
    "/api/answer-source/\\[answerId\\]": [
      "data/pdf-runtime/answer-sources.json",
      "data/pdf-runtime/pdf-r2-map.json",
    ],
    "/pdf/\\[answerId\\]": [
      "data/pdf-runtime/answer-sources.json",
      "data/pdf-runtime/pdf-r2-map.json",
    ],
  },
  outputFileTracingExcludes: {
    "/api/answer-source": [
      "data/app/**/*",
    ],
    "/api/answer-source/\\[answerId\\]": [
      "data/app/**/*",
    ],
    "/pdf/\\[answerId\\]": [
      "data/app/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: apiSecurityHeaders,
      },
      {
        source: "/api/search",
        headers: [
          ...apiSecurityHeaders,
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
      {
        source: "/browse",
        headers: [
          ...apiSecurityHeaders,
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/vault",
        headers: [
          ...apiSecurityHeaders,
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/pdf/:path*",
        headers: pdfProxyHeaders,
      },
      {
        source: "/api/answer-source/:answerId",
        headers: pdfProxyHeaders,
      },
      {
        source: "/data/:path*",
        headers: [
          ...apiSecurityHeaders,
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/data/:path*",
        destination: "/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
