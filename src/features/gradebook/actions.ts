"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canEnterGradebookMarks,
  canLockGradebook,
  canOpenGradebook,
  canReopenGradebook,
  hasGradebookCapability,
} from "@/features/gradebook/permissions";
import {
  lockGradebookSchema,
  openGradebookSchema,
  reopenGradebookSchema,
  saveGradebookDraftSchema,
  submitGradebookSchema,
} from "@/features/gradebook/schemas";
import { normalizeGradebookError } from "@/features/gradebook/errors";
import {
  mapOpenExamGradebookResponse,
  mapRevisionStatusResponse,
  mapSaveDraftResponse,
  mapSubmitResponse,
} from "@/features/gradebook/mappers";
import type { OpenExamGradebookResponse } from "@/features/gradebook/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SESSION_ERROR = "Your session has expired. Please sign in again.";
const FORBIDDEN = "You are not authorized to use the gradebook.";

function revalidateGradebook(gradebookId?: string) {
  revalidatePath("/dashboard/gradebook");
  if (gradebookId) {
    revalidatePath(`/dashboard/gradebook/${gradebookId}`);
    revalidatePath(`/dashboard/gradebook/${gradebookId}/preview`);
  }
}

async function requireGradebookOpen(): Promise<
  { ok: true; role: string } | { error: string }
> {
  const current = await getCurrentUser();
  if (!current) return { error: SESSION_ERROR };
  if (!current.profile?.is_active) return { error: FORBIDDEN };
  if (!canOpenGradebook(current.profile.role)) return { error: FORBIDDEN };
  return { ok: true, role: current.profile.role };
}

export type OpenGradebookActionResult =
  | { error: null; data: OpenExamGradebookResponse }
  | { error: string; code?: string };

export async function openOrGetExamGradebookAction(
  input: unknown,
): Promise<OpenGradebookActionResult> {
  const gate = await requireGradebookOpen();
  if ("error" in gate) return { error: gate.error };

  const parsed = openGradebookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid exam or class.",
    };
  }

  if (
    !canEnterGradebookMarks(gate.role) &&
    !hasGradebookCapability(gate.role, "GRADEBOOK_VIEW_ALL")
  ) {
    return { error: FORBIDDEN };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("open_or_get_exam_gradebook", {
    p_exam_id: parsed.data.exam_id,
    p_class_id: parsed.data.class_id,
  });

  if (error) {
    const normalized = normalizeGradebookError(error.message);
    return { error: normalized.message, code: normalized.code };
  }

  const mapped = mapOpenExamGradebookResponse(data);
  if (!mapped) {
    return { error: "Could not read the gradebook response." };
  }

  revalidateGradebook(mapped.gradebook.id);
  return { error: null, data: mapped };
}

export type SaveDraftActionResult =
  | {
      error: null;
      revision: number;
      saved_count: number;
      status: string;
    }
  | { error: string; code?: string };

export async function saveExamGradebookDraftAction(
  input: unknown,
): Promise<SaveDraftActionResult> {
  const gate = await requireGradebookOpen();
  if ("error" in gate) return { error: gate.error };
  if (!canEnterGradebookMarks(gate.role)) {
    return { error: "You are not authorized to save marks." };
  }

  const parsed = saveGradebookDraftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid draft payload.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("save_exam_gradebook_draft", {
    p_gradebook_id: parsed.data.gradebook_id,
    p_expected_revision: parsed.data.expected_revision,
    p_rows: parsed.data.rows,
  });

  if (error) {
    const normalized = normalizeGradebookError(error.message);
    return { error: normalized.message, code: normalized.code };
  }

  const mapped = mapSaveDraftResponse(data);
  if (!mapped) {
    return { error: "Could not read the save response." };
  }

  revalidateGradebook(mapped.gradebook_id);
  return {
    error: null,
    revision: mapped.revision,
    saved_count: mapped.saved_count,
    status: mapped.status,
  };
}

export type SubmitActionResult =
  | {
      error: null;
      revision: number;
      status: string;
      roster_count: number;
    }
  | { error: string; code?: string };

export async function submitExamGradebookAction(
  input: unknown,
): Promise<SubmitActionResult> {
  const gate = await requireGradebookOpen();
  if ("error" in gate) return { error: gate.error };
  if (!canEnterGradebookMarks(gate.role)) {
    return { error: "You are not authorized to submit this gradebook." };
  }

  const parsed = submitGradebookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid submit request.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("submit_exam_gradebook", {
    p_gradebook_id: parsed.data.gradebook_id,
    p_expected_revision: parsed.data.expected_revision,
  });

  if (error) {
    const normalized = normalizeGradebookError(error.message);
    return { error: normalized.message, code: normalized.code };
  }

  const mapped = mapSubmitResponse(data);
  if (!mapped) {
    return { error: "Could not read the submit response." };
  }

  revalidateGradebook(mapped.gradebook_id);
  return {
    error: null,
    revision: mapped.revision,
    status: mapped.status,
    roster_count: mapped.roster_count,
  };
}

export type ReopenActionResult =
  | { error: null; revision: number; status: string }
  | { error: string; code?: string };

export async function reopenExamGradebookAction(
  input: unknown,
): Promise<ReopenActionResult> {
  const gate = await requireGradebookOpen();
  if ("error" in gate) return { error: gate.error };
  if (!canReopenGradebook(gate.role)) {
    return { error: "You are not authorized to reopen gradebooks." };
  }

  const parsed = reopenGradebookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "A reopening reason is required.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("reopen_exam_gradebook", {
    p_gradebook_id: parsed.data.gradebook_id,
    p_reason: parsed.data.reason,
    p_expected_revision: parsed.data.expected_revision,
  });

  if (error) {
    const normalized = normalizeGradebookError(error.message);
    return { error: normalized.message, code: normalized.code };
  }

  const row = mapRevisionStatusResponse(data);
  if (!row) {
    return { error: "Could not read the reopen response." };
  }

  revalidateGradebook(row.gradebook_id);
  return { error: null, revision: row.revision, status: row.status };
}

export type LockActionResult =
  | { error: null; revision: number; status: string }
  | { error: string; code?: string };

export async function lockExamGradebookAction(
  input: unknown,
): Promise<LockActionResult> {
  const gate = await requireGradebookOpen();
  if ("error" in gate) return { error: gate.error };
  if (!canLockGradebook(gate.role)) {
    return { error: "You are not authorized to lock gradebooks." };
  }

  const parsed = lockGradebookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid lock request.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("lock_exam_gradebook", {
    p_gradebook_id: parsed.data.gradebook_id,
    p_expected_revision: parsed.data.expected_revision,
  });

  if (error) {
    const normalized = normalizeGradebookError(error.message);
    return { error: normalized.message, code: normalized.code };
  }

  const row = mapRevisionStatusResponse(data);
  if (!row) {
    return { error: "Could not read the lock response." };
  }

  revalidateGradebook(row.gradebook_id);
  return { error: null, revision: row.revision, status: row.status };
}
