/**
 * Upload policy helpers for future storage features.
 * No upload pipeline is live yet; these guards must be used when one is added.
 */

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MiB

export type UploadValidationResult =
  | { ok: true; safeFileName: string; extension: string }
  | { ok: false; reason: string };

const UNSAFE_NAME = /(\.\.|[/\\]|\0)/;
const UNSAFE_PATH = /(\.\.|\0|\\)/;

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx).toLowerCase();
}

export function isAllowedImageMime(
  mime: string | null | undefined,
): mime is (typeof ALLOWED_IMAGE_MIME_TYPES)[number] {
  if (!mime) return false;
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(
    mime.toLowerCase().trim(),
  );
}

export function validateImageUpload(input: {
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  schoolId: string;
  /** Optional controlled basename without extension. */
  controlledBase?: string;
}): UploadValidationResult {
  if (
    !input.schoolId ||
    UNSAFE_NAME.test(input.schoolId) ||
    input.schoolId.includes("/")
  ) {
    return { ok: false, reason: "Invalid school scope." };
  }
  if (UNSAFE_NAME.test(input.originalFileName)) {
    return { ok: false, reason: "Invalid file name." };
  }
  if (!isAllowedImageMime(input.mimeType)) {
    return { ok: false, reason: "File type is not allowed." };
  }
  const extension = extensionOf(input.originalFileName);
  if (
    !(ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(extension) ||
    extension === ""
  ) {
    return { ok: false, reason: "File extension is not allowed." };
  }
  if (
    input.sizeBytes <= 0 ||
    !Number.isFinite(input.sizeBytes) ||
    input.sizeBytes > MAX_IMAGE_BYTES
  ) {
    return { ok: false, reason: "File exceeds the maximum allowed size." };
  }

  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `u${Date.now().toString(36)}`;
  const base =
    input.controlledBase && !UNSAFE_NAME.test(input.controlledBase)
      ? input.controlledBase.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40)
      : rand;
  const safeFileName = `${input.schoolId}/${base || rand}${extension}`;

  return { ok: true, safeFileName, extension };
}

/** Paths must stay under school-scoped prefixes; never expose private bucket roots. */
export function assertSchoolScopedStoragePath(
  path: string,
  schoolId: string,
): boolean {
  if (!path || !schoolId) return false;
  if (UNSAFE_PATH.test(path) || UNSAFE_PATH.test(schoolId)) return false;
  if (schoolId.includes("/")) return false;
  const prefix = `${schoolId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return rest.length > 0 && !rest.includes("..");
}
