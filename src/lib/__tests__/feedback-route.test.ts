import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/feedback/route";

const ENV_KEYS = ["RESEND_API_KEY", "FEEDBACK_FROM_EMAIL"] as const;

function withEnv<T>(patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, run: () => Promise<T> | T) {
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

function feedbackRequest(formData: FormData, ip: string) {
  return new NextRequest("https://upscat.click/api/feedback", {
    method: "POST",
    headers: {
      origin: "https://upscat.click",
      "x-forwarded-for": ip,
      "user-agent": `feedback-route-test-${ip}`,
    },
    body: formData,
  });
}

test("feedback route rejects empty feedback", async () => {
  await withEnv({ RESEND_API_KEY: undefined }, async () => {
    const formData = new FormData();
    formData.set("message", "   ");

    const response = await POST(feedbackRequest(formData, "192.0.2.10"));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /short note/i);
  });
});

test("feedback route rejects unsupported screenshot types", async () => {
  await withEnv({ RESEND_API_KEY: undefined }, async () => {
    const formData = new FormData();
    formData.set("message", "The PDF controls overlap on my phone.");
    formData.set("screenshot", new File(["hello"], "notes.txt", { type: "text/plain" }));

    const response = await POST(feedbackRequest(formData, "192.0.2.11"));
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.match(payload.error, /png|jpg|webp|gif/i);
  });
});

test("feedback route reports missing Resend configuration after valid input", async () => {
  await withEnv({ RESEND_API_KEY: undefined }, async () => {
    const formData = new FormData();
    formData.set("message", "Please add a larger PDF zoom button.");
    formData.set("replyEmail", "reader@example.com");
    formData.set("pageUrl", "https://upscat.click/gs1");
    formData.set("screenshot", new File([new Uint8Array([137, 80, 78, 71])], "screen.png", { type: "image/png" }));

    const response = await POST(feedbackRequest(formData, "192.0.2.12"));
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.match(payload.error, /RESEND_API_KEY/i);
  });
});

test("feedback route rejects cross-site submissions", async () => {
  const formData = new FormData();
  formData.set("message", "Cross-site attempt");

  const response = await POST(new NextRequest("https://upscat.click/api/feedback", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "x-forwarded-for": "192.0.2.13",
    },
    body: formData,
  }));

  assert.equal(response.status, 403);
});
