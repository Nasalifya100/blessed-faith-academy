import type { ResultEntryStatus } from "./schemas";

export type LocalRecoveryPayload = {
  gradebookId: string;
  revision: number;
  userId: string;
  savedAt: string;
  rows: Array<{
    student_id: string;
    entry_status: ResultEntryStatus | null;
    marks_text: string;
  }>;
};

export type RecoveryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  length?: number;
  key?(index: number): string | null;
};

/** User-scoped key so shared devices do not offer another teacher's draft. */
export function recoveryStorageKey(
  userId: string,
  gradebookId: string,
  revision: number,
): string {
  return `bfa:gradebook-draft:u${userId}:g${gradebookId}:r${revision}`;
}

export function recoveryPrefix(userId: string, gradebookId: string): string {
  return `bfa:gradebook-draft:u${userId}:g${gradebookId}:`;
}

export function readLocalRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  gradebookId: string,
  revision: number,
): LocalRecoveryPayload | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(
      recoveryStorageKey(userId, gradebookId, revision),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalRecoveryPayload;
    if (
      !parsed ||
      parsed.gradebookId !== gradebookId ||
      parsed.revision !== revision ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.rows)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Detect recovery for this user+gradebook at a different revision. */
export function findStaleLocalRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  gradebookId: string,
  currentRevision: number,
): LocalRecoveryPayload | null {
  if (!storage || !userId || typeof storage.length !== "number" || !storage.key) {
    return null;
  }
  try {
    const prefix = recoveryPrefix(userId, gradebookId);
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as LocalRecoveryPayload;
      if (
        parsed?.gradebookId === gradebookId &&
        parsed.userId === userId &&
        typeof parsed.revision === "number" &&
        parsed.revision !== currentRevision &&
        Array.isArray(parsed.rows)
      ) {
        return parsed;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function writeLocalRecovery(
  storage: RecoveryStorage | null | undefined,
  payload: LocalRecoveryPayload,
): boolean {
  if (!storage || !payload.userId) return false;
  try {
    storage.setItem(
      recoveryStorageKey(payload.userId, payload.gradebookId, payload.revision),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearLocalRecovery(
  storage: RecoveryStorage | null | undefined,
  userId: string,
  gradebookId: string,
  revision?: number,
): void {
  if (!storage || !userId) return;
  try {
    if (typeof revision === "number") {
      storage.removeItem(recoveryStorageKey(userId, gradebookId, revision));
      return;
    }
    if (typeof storage.length === "number" && typeof storage.key === "function") {
      const prefix = recoveryPrefix(userId, gradebookId);
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    }
  } catch {
    // ignore unavailable storage
  }
}

export function buildRecoveryPayload(
  userId: string,
  gradebookId: string,
  revision: number,
  rows: Array<{
    student_id: string;
    entry_status: ResultEntryStatus | null;
    marks_text: string;
  }>,
): LocalRecoveryPayload {
  return {
    userId,
    gradebookId,
    revision,
    savedAt: new Date().toISOString(),
    rows: rows.map((r) => ({
      student_id: r.student_id,
      entry_status: r.entry_status,
      marks_text: r.marks_text,
    })),
  };
}
