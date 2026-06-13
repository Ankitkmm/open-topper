import { Resend } from "resend";
import { type NextRequest } from "next/server";
import { getEnv, getFeedbackRateLimitMax, getRateLimitWindowMs } from "@/lib/env";
import { FOUNDER_EMAIL, SITE_NAME } from "@/lib/marketing";
import { checkRateLimit } from "@/lib/rate-limit";

const FEEDBACK_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const MAX_MESSAGE_LENGTH = 4000;
const MAX_EMAIL_LENGTH = 254;
const MAX_PAGE_URL_LENGTH = 2048;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_FORM_BYTES = 6 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DEFAULT_FEEDBACK_FROM = `${SITE_NAME} Feedback <onboarding@resend.dev>`;

export async function POST(req: NextRequest) {
  const originError = rejectCrossSiteRequest(req);
  if (originError) return originError;

  const contentLength = Number.parseInt(req.headers.get("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
    return jsonError("Feedback is too large. Attach one image up to 5 MB.", 413);
  }

  const limit = await checkRateLimit(req, {
    scope: "feedback",
    max: getFeedbackRateLimitMax(),
    windowMs: getRateLimitWindowMs(),
  });
  if (!limit.ok) {
    return Response.json({ error: "Too many feedback submissions. Please slow down." }, {
      status: 429,
      headers: {
        ...FEEDBACK_HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      },
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Invalid feedback request.", 400);
  }

  const message = String(form.get("message") || "").trim();
  const replyEmail = String(form.get("replyEmail") || "").trim().toLowerCase();
  const pageUrl = normalizePageUrl(String(form.get("pageUrl") || ""));
  const screenshots = form.getAll("screenshot").filter(isNonEmptyFile);

  if (!message) return jsonError("Write a short note before sending feedback.", 400);
  if (message.length > MAX_MESSAGE_LENGTH) return jsonError(`Feedback must be under ${MAX_MESSAGE_LENGTH} characters.`, 400);
  if (replyEmail && !isValidEmail(replyEmail)) return jsonError("Enter a valid reply email or leave it blank.", 400);
  if (replyEmail.length > MAX_EMAIL_LENGTH) return jsonError("Reply email is too long.", 400);
  if (screenshots.length > 1) return jsonError("Attach only one screenshot.", 400);

  const screenshot = screenshots[0] || null;
  if (screenshot) {
    if (!ALLOWED_IMAGE_TYPES.has(screenshot.type)) return jsonError("Screenshot must be a PNG, JPG, WebP, or GIF image.", 400);
    if (screenshot.size > MAX_SCREENSHOT_BYTES) return jsonError("Screenshot must be 5 MB or smaller.", 400);
  }

  const apiKey = getEnv("RESEND_API_KEY");
  if (!apiKey) {
    return jsonError("Feedback email is not configured yet. Please set RESEND_API_KEY.", 503);
  }

  const attachment = screenshot ? await toAttachment(screenshot) : null;
  const resend = new Resend(apiKey);
  const subject = `[${SITE_NAME}] Feedback from ${replyEmail || "anonymous user"}`;
  const text = buildTextEmail({ message, replyEmail, pageUrl, userAgent: req.headers.get("user-agent") || "Unknown" });

  const result = await resend.emails.send({
    from: getEnv("FEEDBACK_FROM_EMAIL", DEFAULT_FEEDBACK_FROM),
    to: FOUNDER_EMAIL,
    subject,
    text,
    html: buildHtmlEmail({ message, replyEmail, pageUrl, userAgent: req.headers.get("user-agent") || "Unknown" }),
    replyTo: replyEmail || undefined,
    attachments: attachment ? [attachment] : undefined,
    tags: [{ name: "category", value: "feedback" }],
  });

  if (result.error) {
    console.error("[feedback] Resend failed", result.error);
    return jsonError("Feedback could not be sent. Please try again later.", 502);
  }

  return Response.json({ ok: true }, { headers: FEEDBACK_HEADERS });
}

export async function GET() {
  const headers = new Headers(FEEDBACK_HEADERS);
  headers.set("Allow", "POST");
  return Response.json({ error: "Use the feedback button to send a message." }, { status: 405, headers });
}

function isNonEmptyFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File && value.size > 0;
}

async function toAttachment(file: File) {
  return {
    filename: sanitizeFilename(file.name || "upscat-feedback-screenshot"),
    content: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  };
}

function sanitizeFilename(filename: string) {
  const clean = filename
    .replace(/[/\\]/g, " ")
    .replace(/[^\w .()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || "upscat-feedback-screenshot.png";
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= MAX_EMAIL_LENGTH;
}

function normalizePageUrl(value: string) {
  const clean = value.trim();
  if (!clean) return "";
  if (clean.length > MAX_PAGE_URL_LENGTH) return clean.slice(0, MAX_PAGE_URL_LENGTH);
  try {
    const url = new URL(clean);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function rejectCrossSiteRequest(req: NextRequest) {
  const expected = req.nextUrl.origin;
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  if (origin && origin !== expected) {
    return jsonError("Feedback must be sent from UPSCat.", 403);
  }
  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expected) return jsonError("Feedback must be sent from UPSCat.", 403);
    } catch {
      return jsonError("Feedback must be sent from UPSCat.", 403);
    }
  }
  return null;
}

function buildTextEmail({ message, replyEmail, pageUrl, userAgent }: { message: string; replyEmail: string; pageUrl: string; userAgent: string }) {
  return [
    "New UPSCat feedback",
    "",
    `Reply email: ${replyEmail || "Not provided"}`,
    `Page: ${pageUrl || "Not provided"}`,
    `User agent: ${userAgent}`,
    "",
    "Message:",
    message,
  ].join("\n");
}

function buildHtmlEmail({ message, replyEmail, pageUrl, userAgent }: { message: string; replyEmail: string; pageUrl: string; userAgent: string }) {
  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.6; color: #292520;">
      <h1 style="font-size: 20px;">New UPSCat feedback</h1>
      <p><strong>Reply email:</strong> ${escapeHtml(replyEmail || "Not provided")}</p>
      <p><strong>Page:</strong> ${pageUrl ? `<a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a>` : "Not provided"}</p>
      <p><strong>User agent:</strong> ${escapeHtml(userAgent)}</p>
      <hr />
      <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status, headers: FEEDBACK_HEADERS });
}
