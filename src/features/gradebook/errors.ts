/**
 * Normalize Stage 1 gradebook RPC errors for UI display.
 * Never forward raw SQL / constraint text to end users.
 */

export type GradebookErrorCode =
  | "REVISION_CONFLICT"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "NOT_EDITABLE"
  | "MARKS_WINDOW"
  | "EXAM_NOT_READY"
  | "INCOMPLETE"
  | "ROSTER_DRIFT"
  | "CROSS_CLASS_CONFLICT"
  | "VALIDATION"
  | "REOPEN_REASON"
  | "LOCK_DENIED"
  | "GENERIC";

export type NormalizedGradebookError = {
  code: GradebookErrorCode;
  message: string;
};

const SQLISH =
  /\b(relation|column|constraint|violates|permission denied for|PGRST|SQLSTATE|function .* does not exist)\b/i;

export function normalizeGradebookError(
  raw: string | null | undefined,
): NormalizedGradebookError {
  const text = (raw ?? "").trim();
  if (!text) {
    return {
      code: "GENERIC",
      message: "Something went wrong. Please try again.",
    };
  }

  if (/revision conflict/i.test(text) || /updated by someone else/i.test(text)) {
    return {
      code: "REVISION_CONFLICT",
      message:
        "This gradebook was updated elsewhere. Refresh the page before continuing. Your unsaved local changes are kept until you choose.",
    };
  }

  if (/not authorized|not authorised/i.test(text)) {
    return {
      code: "UNAUTHORIZED",
      message: "You are not authorized to perform this gradebook action.",
    };
  }

  if (/gradebook not found|exam not found|class not found/i.test(text)) {
    return {
      code: "NOT_FOUND",
      message: "That gradebook or exam could not be found.",
    };
  }

  if (/submitted or locked|cannot be edited|only draft or reopened/i.test(text)) {
    return {
      code: "NOT_EDITABLE",
      message: "This gradebook is read-only. An authorised reopen is required before editing.",
    };
  }

  if (
    /marks entry is not available|marks-entry window|marks entry window/i.test(
      text,
    )
  ) {
    return {
      code: "MARKS_WINDOW",
      message:
        "Marks entry is not available for this exam yet. It must be Completed, and any configured marks-entry window must be open.",
    };
  }

  if (/requires Completed|not completed/i.test(text)) {
    return {
      code: "EXAM_NOT_READY",
      message: "Marks can only be entered for completed exams.",
    };
  }

  if (/incomplete gradebook|no eligible students/i.test(text)) {
    return {
      code: "INCOMPLETE",
      message:
        "Every eligible student needs a mark or status before submission.",
    };
  }

  if (
    /no longer eligible|roster/i.test(text) &&
    /refresh|remove|eligible/i.test(text)
  ) {
    return {
      code: "ROSTER_DRIFT",
      message:
        "The class roster changed since your draft. Return to the gradebook, review the updated roster, then save and submit again.",
    };
  }

  if (/another class gradebook|already has a submitted result/i.test(text)) {
    return {
      code: "CROSS_CLASS_CONFLICT",
      message:
        "One or more students already have a submitted result for this exam in another class.",
    };
  }

  if (/reopening reason|reason is required/i.test(text)) {
    return {
      code: "REOPEN_REASON",
      message: "A clear reopening reason is required.",
    };
  }

  if (/only submitted gradebooks can be locked|must be resubmitted/i.test(text)) {
    return {
      code: "LOCK_DENIED",
      message:
        "Only submitted gradebooks can be locked. Resubmit a reopened gradebook first.",
    };
  }

  if (
    /duplicate student|invalid entry_status|marks cannot|scored entries|finite number|eligible roster/i.test(
      text,
    )
  ) {
    return {
      code: "VALIDATION",
      message: "Please fix invalid marks or statuses and try again.",
    };
  }

  if (SQLISH.test(text) || text.length > 220) {
    return {
      code: "GENERIC",
      message: "Something went wrong saving the gradebook. Please try again.",
    };
  }

  return { code: "GENERIC", message: text };
}
