/**
 * Feedback validation utility.
 *
 * Validates payloads submitted to POST /api/feedback.
 * Schema: { page_path: string, category: string, message: string }
 *
 * The canonical table definition lives in:
 *   supabase/migrations/20260615_feedback.sql
 */

export const VALID_CATEGORIES = [
  "bug",
  "suggestion",
  "content",
  "other",
] as const;

export type FeedbackCategory = (typeof VALID_CATEGORIES)[number];

export interface FeedbackPayload {
  page_path: string;
  category: FeedbackCategory;
  message: string;
}

type ValidationResult =
  | { valid: true; data: FeedbackPayload }
  | { valid: false; error: string };

export function validateFeedbackPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const obj = body as Record<string, unknown>;

  // page_path — required, non-empty string
  if (typeof obj.page_path !== "string" || obj.page_path.trim() === "") {
    return { valid: false, error: "page_path is required and must be a non-empty string" };
  }

  // category — required, must be a valid enum value
  if (
    typeof obj.category !== "string" ||
    !VALID_CATEGORIES.includes(obj.category as FeedbackCategory)
  ) {
    return {
      valid: false,
      error: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
    };
  }

  // message — required, 1-5000 chars
  if (typeof obj.message !== "string") {
    return { valid: false, error: "message is required and must be a string" };
  }
  if (obj.message.length < 1 || obj.message.length > 5000) {
    return { valid: false, error: "message must be between 1 and 5000 characters" };
  }

  return {
    valid: true,
    data: {
      page_path: obj.page_path.trim(),
      category: obj.category as FeedbackCategory,
      message: obj.message,
    },
  };
}
