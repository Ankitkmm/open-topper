import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

import {
  getAuthSecret,
  getAnswerSourceRateLimitMax,
  getPdfTokenSecret,
  getPdfTokenTtlSeconds,
  getPdfUpstreamTimeoutMs,
  isCloudflareTarget,
  isProductionLikeRuntime,
  parsePositiveInteger,
} from "../env";
import {
  getPublicAuthState,
  isAuthTemporarilyDisabledForQa,
  isPublicAuthAvailable,
  sanitizeInternalNextPath,
} from "../auth-availability";
import {
  isSameOriginRequest,
  normalizeAllowedR2PdfUrl,
} from "../answer-sources";
import {
  buildPdfEmbedResponse,
  buildPdfTokenCookieHeader,
  getPdfTokenCookieName,
  isAllowedPdfContentType,
  isValidPdfContentRange,
  isValidPdfRangeHeader,
  issuePdfAccessToken,
  verifyPdfAccessToken,
} from "../pdf-access";
import { readBoundedJson, rejectLargeBody, requireSameOriginRead } from "../request-guards";
import { __testUtils as rateLimitTestUtils } from "../rate-limit";

const VALID_ANSWER_ID = "ans_a62f8f3a22e0ffcb";
const VALID_R2_URL = "https://pub-3476e7cc4efd44b58da659c67aad1348.r2.dev/drive_1wUYc24i2uslT_x0o5LBpG9lK6dSX7o-5.pdf";
const LONG_AUTH_SECRET = "auth_secret_for_tests_0123456789abcdef";
const LONG_PDF_SECRET = "pdf_secret_for_tests_0123456789abcdefg";

const ENV_KEYS = [
  "AUTH_SECRET",
  "PDF_TOKEN_SECRET",
  "NODE_ENV",
  "VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_ENV",
  "NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "R2_PUBLIC_URL",
  "R2_ALLOWED_PUBLIC_HOSTS",
  "PDF_TOKEN_TTL_SECONDS",
  "PDF_UPSTREAM_TIMEOUT_MS",
  "RATE_LIMIT_ANSWER_SOURCE_MAX",
  "UPSCAT_RUNTIME_TARGET",
  "CF_PAGES",
  "CF_WORKER_NAME",
  "NEXT_RUNTIME",
] as const;

function withEnv<T>(patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, run: () => T) {
  const original = new Map<string, string | undefined>();
  const env = process.env as Record<string, string | undefined>;
  for (const key of ENV_KEYS) original.set(key, env[key]);

  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    return run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

function signTokenBody(body: string) {
  return createHmac("sha256", LONG_PDF_SECRET).update(body).digest("hex");
}

function makeSignedToken(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signTokenBody(body)}`;
}

function makeUnsignedJwt(payload: unknown) {
  return [
    Buffer.from("{}", "utf8").toString("base64url"),
    Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"),
    "signature",
  ].join(".");
}

async function withEnvAsync<T>(patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, run: () => Promise<T>) {
  return withEnv(patch, run);
}

test("production secrets fail closed when missing or weak", () => {
  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: undefined,
    NEXT_PUBLIC_VERCEL_ENV: undefined,
    AUTH_SECRET: undefined,
    PDF_TOKEN_SECRET: undefined,
  }, () => {
    assert.equal(isProductionLikeRuntime(), true);
    assert.throws(() => getAuthSecret(), /AUTH_SECRET/);
  });

  withEnv({
    NODE_ENV: "production",
    AUTH_SECRET: LONG_AUTH_SECRET,
    PDF_TOKEN_SECRET: undefined,
  }, () => {
    assert.throws(() => getPdfTokenSecret(), /PDF_TOKEN_SECRET/);
  });

  withEnv({
    NODE_ENV: "production",
    AUTH_SECRET: "upscat-local-secret",
    PDF_TOKEN_SECRET: LONG_PDF_SECRET,
  }, () => {
    assert.throws(() => getAuthSecret(), /at least 32 characters|unsafe development placeholder/);
  });
});

test("vercel preview remains fail-open for known default R2 preview host validation", () => {
  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_VERCEL_ENV: "preview",
    R2_PUBLIC_URL: undefined,
    R2_ALLOWED_PUBLIC_HOSTS: undefined,
  }, () => {
    assert.equal(isProductionLikeRuntime(), false);
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL), VALID_R2_URL);
  });
});

test("temporary public auth disable keeps production no-signup flows open by default", () => {
  withEnv({
    NODE_ENV: "development",
    VERCEL_ENV: undefined,
    NEXT_PUBLIC_VERCEL_ENV: undefined,
    NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED: undefined,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
  }, () => {
    assert.equal(isAuthTemporarilyDisabledForQa(), true);
    assert.equal(isPublicAuthAvailable(), false);
    assert.equal(getPublicAuthState().mode, "qa-disabled");
  });

  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_VERCEL_ENV: "production",
    NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED: undefined,
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    SUPABASE_URL: undefined,
    SUPABASE_ANON_KEY: undefined,
  }, () => {
    assert.equal(isAuthTemporarilyDisabledForQa(), true);
    assert.equal(isPublicAuthAvailable(), false);
    assert.equal(getPublicAuthState().mode, "qa-disabled");
  });

  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_VERCEL_ENV: "production",
    NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED: "false",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
  }, () => {
    assert.equal(isAuthTemporarilyDisabledForQa(), false);
    assert.equal(isPublicAuthAvailable(), true);
    assert.equal(getPublicAuthState().mode, "configured");
  });

  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    NEXT_PUBLIC_VERCEL_ENV: "production",
    NEXT_PUBLIC_TEMPORARY_QA_AUTH_DISABLED: "false",
    NEXT_PUBLIC_SUPABASE_URL: undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
    SUPABASE_URL: undefined,
    SUPABASE_ANON_KEY: undefined,
  }, () => {
    assert.equal(isAuthTemporarilyDisabledForQa(), false);
    assert.equal(isPublicAuthAvailable(), false);
    assert.equal(getPublicAuthState().mode, "misconfigured-production");
  });
});

test("explicit Cloudflare target disables direct database rate limiting", () => {
  withEnv({
    UPSCAT_RUNTIME_TARGET: "cloudflare",
  }, () => {
    assert.equal(isCloudflareTarget(), true);
    assert.equal(rateLimitTestUtils.isWorkerRuntime(), true);
  });

  withEnv({
    UPSCAT_RUNTIME_TARGET: undefined,
    CF_PAGES: undefined,
    CF_WORKER_NAME: undefined,
    NEXT_RUNTIME: undefined,
  }, () => {
    assert.equal(isCloudflareTarget(), false);
  });
});

test("numeric env parsing rejects partial numbers and caps sensitive limits", () => {
  assert.equal(parsePositiveInteger("10abc", 60), 60);
  assert.equal(parsePositiveInteger("1e9", 60), 60);
  assert.equal(parsePositiveInteger("", 60), 60);
  assert.equal(parsePositiveInteger("0", 60), 60);
  assert.equal(parsePositiveInteger("999", 60, 300), 300);

  withEnv({
    PDF_TOKEN_TTL_SECONDS: "999999",
    PDF_UPSTREAM_TIMEOUT_MS: "999999",
    RATE_LIMIT_ANSWER_SOURCE_MAX: "7",
  }, () => {
    assert.equal(getPdfTokenTtlSeconds(), 300);
    assert.equal(getPdfUpstreamTimeoutMs(), 30_000);
    assert.equal(getAnswerSourceRateLimitMax(), 7);
  });
});

test("account next destinations are same-origin relative paths only", () => {
  assert.equal(sanitizeInternalNextPath("/pdf/ans_a62f8f3a22e0ffcb?page=4"), "/pdf/ans_a62f8f3a22e0ffcb?page=4");
  assert.equal(sanitizeInternalNextPath("//evil.example/path"), "/");
  assert.equal(sanitizeInternalNextPath("/\\evil.example/path"), "/");
  assert.equal(sanitizeInternalNextPath("/%2f%2fevil.example/path"), "/");
  assert.equal(sanitizeInternalNextPath("https://evil.example/path"), "/");
  assert.equal(sanitizeInternalNextPath("javascript:alert(1)"), "/");
});

test("PDF access tokens include strict purpose, version, nonce, and lifetime checks", () => {
  withEnv({
    NODE_ENV: "production",
    AUTH_SECRET: LONG_AUTH_SECRET,
    PDF_TOKEN_SECRET: LONG_PDF_SECRET,
  }, () => {
    const token = issuePdfAccessToken(VALID_ANSWER_ID);
    const [body, signature, extra] = token.split(".");
    assert.ok(body);
    assert.match(signature, /^[a-f0-9]{64}$/);
    assert.equal(extra, undefined);

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    assert.equal(payload.answerId, VALID_ANSWER_ID);
    assert.equal(payload.purpose, "pdf-source");
    assert.equal(payload.v, 1);
    assert.match(payload.nonce, /^[A-Za-z0-9_-]{16,64}$/);
    assert.equal(verifyPdfAccessToken(token, VALID_ANSWER_ID).ok, true);
    assert.equal(verifyPdfAccessToken(token, "ans_0000000000000000").ok, false);
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    assert.equal(verifyPdfAccessToken(`${body}.${tamperedSignature}`, VALID_ANSWER_ID).ok, false);

    const now = Math.floor(Date.now() / 1000);
    const legacyToken = makeSignedToken({
      answerId: VALID_ANSWER_ID,
      exp: now + 60,
      nonce: "legacy",
    });
    assert.equal(verifyPdfAccessToken(legacyToken, VALID_ANSWER_ID).ok, false);

    const expiredToken = makeSignedToken({
      answerId: VALID_ANSWER_ID,
      exp: now - 1,
      iat: now - 60,
      nonce: "nonce_nonce_nonce",
      purpose: "pdf-source",
      v: 1,
    });
    assert.equal(verifyPdfAccessToken(expiredToken, VALID_ANSWER_ID).ok, false);
  });
});

test("PDF access token cookie uses hardened browser flags", () => {
  withEnv({
    NODE_ENV: "production",
    VERCEL_ENV: undefined,
    NEXT_PUBLIC_VERCEL_ENV: undefined,
    AUTH_SECRET: LONG_AUTH_SECRET,
    PDF_TOKEN_SECRET: LONG_PDF_SECRET,
  }, () => {
    const token = issuePdfAccessToken(VALID_ANSWER_ID);
    const header = buildPdfTokenCookieHeader(VALID_ANSWER_ID, token);
    assert.match(header, new RegExp(`^upscat_pdf_${VALID_ANSWER_ID}=`));
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Lax/);
    assert.match(header, /Max-Age=\d+/);
    assert.match(header, /Secure/);
  });
});

test("PDF embed URLs no longer expose the access token in the address", async () => {
  await withEnvAsync({
    NODE_ENV: "production",
    AUTH_SECRET: LONG_AUTH_SECRET,
    PDF_TOKEN_SECRET: LONG_PDF_SECRET,
  }, async () => {
    const response = await buildPdfEmbedResponse(VALID_ANSWER_ID);
    assert.equal(response.ok, true);
    if (!response.ok) return;

    assert.ok(response.payload.viewerUrl.startsWith(`/pdf/${VALID_ANSWER_ID}?page=`));
    assert.ok(response.payload.embedUrl.startsWith(`/pdf/${VALID_ANSWER_ID}?page=`));
    assert.equal(response.payload.viewerUrl.includes("token="), false);
    assert.equal(response.payload.embedUrl.includes("token="), false);
    assert.equal(typeof response.payload.token, "string");
    assert.equal(getPdfTokenCookieName(VALID_ANSWER_ID), `upscat_pdf_${VALID_ANSWER_ID}`);
  });
});

test("same-origin request guard combines Origin/Referer with Fetch Metadata", () => {
  assert.equal(
    isSameOriginRequest(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { origin: "https://upscat.local" },
    })),
    true,
  );
  assert.equal(
    isSameOriginRequest(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    })),
    false,
  );
  assert.equal(
    isSameOriginRequest(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    })),
    false,
  );
  assert.equal(
    isSameOriginRequest(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { "sec-fetch-site": "none" },
    })),
    false,
  );
  assert.equal(
    isSameOriginRequest(new NextRequest("https://upscat.local/api/answer-source/ans_a62f8f3a22e0ffcb", {
      method: "GET",
      headers: { "sec-fetch-site": "none" },
    })),
    true,
  );
});

test("same-origin read guard requires browser same-origin signals for public JSON GETs", async () => {
  assert.equal(
    requireSameOriginRead(new NextRequest("https://upscat.local/api/search?q=polity", {
      method: "GET",
      headers: { referer: "https://upscat.local/browse" },
    })),
    null,
  );

  assert.equal(
    requireSameOriginRead(new NextRequest("https://upscat.local/api/search?q=polity", {
      method: "GET",
      headers: { "sec-fetch-site": "same-origin" },
    })),
    null,
  );

  const blocked = requireSameOriginRead(new NextRequest("https://upscat.local/api/search?q=polity", {
    method: "GET",
  }));
  assert.ok(blocked instanceof Response);
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: "Same-origin browser requests are required." });

  const crossSite = requireSameOriginRead(new NextRequest("https://upscat.local/api/search?q=polity", {
    method: "GET",
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
  }));
  assert.ok(crossSite instanceof Response);
  assert.equal(crossSite.status, 403);
});

test("R2 PDF URL validation only allows HTTPS PDF objects on expected R2 hosts", () => {
  withEnv({
    R2_PUBLIC_URL: undefined,
    R2_ALLOWED_PUBLIC_HOSTS: undefined,
  }, () => {
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL), VALID_R2_URL);
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL.replace("https://", "http://")), null);
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL.replace(".pdf", ".txt")), null);
    assert.equal(normalizeAllowedR2PdfUrl(`${VALID_R2_URL}?download=1`), null);
    assert.equal(normalizeAllowedR2PdfUrl(`${VALID_R2_URL}#page=1`), null);
    assert.equal(normalizeAllowedR2PdfUrl("https://evil.r2.dev/file.pdf"), null);
    assert.equal(normalizeAllowedR2PdfUrl("https://user:pass@pub-3476e7cc4efd44b58da659c67aad1348.r2.dev/file.pdf"), null);
    assert.equal(normalizeAllowedR2PdfUrl("https://pub-00000000000000000000000000000000.r2.dev/file.pdf"), null);
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL.replace(".pdf", "%2Fsecret.pdf")), null);
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL.replace(".pdf", "%5Csecret.pdf")), null);
    assert.equal(normalizeAllowedR2PdfUrl(VALID_R2_URL.replace(".pdf", "%00.pdf")), null);
  });
});

test("PDF proxy byte range and response metadata validation rejects unsafe upstream behavior", () => {
  assert.equal(isValidPdfRangeHeader("bytes=0-99"), true);
  assert.equal(isValidPdfRangeHeader("bytes=500-"), false);
  assert.equal(isValidPdfRangeHeader("bytes=0-"), false);
  assert.equal(isValidPdfRangeHeader("bytes=-500"), true);
  assert.equal(isValidPdfRangeHeader("bytes=100-1"), false);
  assert.equal(isValidPdfRangeHeader("bytes=0-1,3-4"), false);
  assert.equal(isValidPdfRangeHeader("bytes=-"), false);
  assert.equal(isValidPdfRangeHeader("bytes=9999999999999999-"), false);
  assert.equal(isValidPdfRangeHeader("bytes=-9999999999999999"), false);
  assert.equal(isValidPdfRangeHeader("bytes=-0"), false);
  assert.equal(isValidPdfRangeHeader("bytes=0-9007199254740991"), false);
  assert.equal(isValidPdfRangeHeader(`bytes=0-${32 * 1024 * 1024 - 1}`), true);
  assert.equal(isValidPdfRangeHeader(`bytes=0-${32 * 1024 * 1024}`), false);

  assert.equal(isValidPdfContentRange("bytes 0-99/100"), true);
  assert.equal(isValidPdfContentRange("bytes 0-99/*"), true);
  assert.equal(isValidPdfContentRange("bytes 100-0/100"), false);
  assert.equal(isValidPdfContentRange("bytes 100-200/150"), false);
  assert.equal(isValidPdfContentRange("items 0-99/100"), false);

  assert.equal(isAllowedPdfContentType("application/pdf"), true);
  assert.equal(isAllowedPdfContentType("application/pdf; charset=binary"), true);
  assert.equal(isAllowedPdfContentType("application/octet-stream"), true);
  assert.equal(isAllowedPdfContentType("text/html"), false);
  assert.equal(isAllowedPdfContentType(null), false);
});

test("request body size guard validates exact content length before parsing JSON", () => {
  assert.equal(
    rejectLargeBody(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { "content-length": "1024" },
    }), 1024),
    null,
  );
  assert.equal(
    rejectLargeBody(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { "content-length": "1025" },
    }), 1024)?.status,
    413,
  );
  assert.equal(
    rejectLargeBody(new NextRequest("https://upscat.local/api/answer-source", {
      method: "POST",
      headers: { "content-length": "10abc" },
    }), 1024)?.status,
    400,
  );
});

test("bounded JSON reader enforces byte limits even without Content-Length", async () => {
  const oversized = new NextRequest("https://upscat.local/api/answer-source", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://upscat.local",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ answerId: VALID_ANSWER_ID, padding: "x".repeat(2048) }),
  });

  const oversizedResult = await readBoundedJson(oversized, 1024);
  assert.equal(oversizedResult.ok, false);
  if (!oversizedResult.ok) assert.equal(oversizedResult.response.status, 413);

  const valid = new NextRequest("https://upscat.local/api/answer-source", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://upscat.local",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify({ answerId: VALID_ANSWER_ID }),
  });

  const validResult = await readBoundedJson<{ answerId?: string }>(valid, 1024);
  assert.equal(validResult.ok, true);
  if (validResult.ok) assert.equal(validResult.value.answerId, VALID_ANSWER_ID);
});
