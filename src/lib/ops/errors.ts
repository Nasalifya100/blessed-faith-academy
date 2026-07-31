/**
 * Normalized operational error categories for server actions and APIs.
 * Never forward raw Postgres / Supabase internals to end users.
 */

export const OPS_ERROR_CATEGORIES = [
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "REVISION_CONFLICT",
  "RESOURCE_NOT_FOUND",
  "DEPENDENCY_UNAVAILABLE",
  "RATE_LIMITED",
  "OPERATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type OpsErrorCategory = (typeof OPS_ERROR_CATEGORIES)[number];

export type NormalizedOpsError = {
  category: OpsErrorCategory;
  message: string;
  /** Safe public code for clients; never a SQLSTATE. */
  code: OpsErrorCategory;
  /** Opaque incident id for operator tracing. */
  incidentId: string;
};

const SQLISH =
  /\b(relation|column|constraint|violates|permission denied for|PGRST|SQLSTATE|function .* does not exist|postgres|supabase)\b/i;

const DEFAULT_MESSAGES: Record<OpsErrorCategory, string> = {
  AUTH_REQUIRED: "Your session has expired. Please sign in again.",
  PERMISSION_DENIED: "You are not authorized to perform this action.",
  VALIDATION_FAILED: "Please check the form and try again.",
  REVISION_CONFLICT:
    "This record was updated elsewhere. Reload and try again.",
  RESOURCE_NOT_FOUND: "The requested record could not be found.",
  DEPENDENCY_UNAVAILABLE:
    "A required service is temporarily unavailable. Please try again shortly.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  OPERATION_FAILED: "The operation could not be completed. Please try again.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
};

export function createIncidentId(prefix = "bfa"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

export function isSensitiveSqlLeak(text: string): boolean {
  return SQLISH.test(text);
}

/**
 * Map a raw error string into a safe, categorized response.
 * Prefer passing an explicit category when the caller already knows it.
 */
export function normalizeOpsError(
  raw: unknown,
  options?: {
    category?: OpsErrorCategory;
    message?: string;
    incidentId?: string;
  },
): NormalizedOpsError {
  const incidentId = options?.incidentId ?? createIncidentId();
  const text =
    typeof raw === "string"
      ? raw.trim()
      : raw instanceof Error
        ? raw.message.trim()
        : raw &&
            typeof raw === "object" &&
            "message" in raw &&
            typeof (raw as { message: unknown }).message === "string"
          ? String((raw as { message: string }).message).trim()
          : "";

  let category: OpsErrorCategory = options?.category ?? "INTERNAL_ERROR";

  if (!options?.category && text) {
    if (/not authenticated|session has expired|sign in again/i.test(text)) {
      category = "AUTH_REQUIRED";
    } else if (
      /not authorized|not authorised|permission denied|forbidden/i.test(text)
    ) {
      category = "PERMISSION_DENIED";
    } else if (/rate.?limit|too many requests/i.test(text)) {
      category = "RATE_LIMITED";
    } else if (/revision conflict|updated by someone else/i.test(text)) {
      category = "REVISION_CONFLICT";
    } else if (/not found|does not exist/i.test(text) && !SQLISH.test(text)) {
      category = "RESOURCE_NOT_FOUND";
    } else if (/invalid|validation|required|must be/i.test(text)) {
      category = "VALIDATION_FAILED";
    } else if (
      /unavailable|timeout|fetch failed|network|ECONNREFUSED/i.test(text)
    ) {
      category = "DEPENDENCY_UNAVAILABLE";
    } else if (!SQLISH.test(text)) {
      category = "OPERATION_FAILED";
    }
  }

  let message = options?.message ?? DEFAULT_MESSAGES[category];
  if (
    options?.message == null &&
    text &&
    !SQLISH.test(text) &&
    category !== "INTERNAL_ERROR" &&
    text.length <= 180
  ) {
    message = text;
  }

  return {
    category,
    code: category,
    message,
    incidentId,
  };
}

/** Safe user-facing string including incident id for support. */
export function formatOpsErrorForUser(error: NormalizedOpsError): string {
  return `${error.message} (ref: ${error.incidentId})`;
}
